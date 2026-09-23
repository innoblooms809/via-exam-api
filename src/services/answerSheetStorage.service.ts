/**
 * Answer-sheet upload, replace, delete and read.
 *
 * Split out of scanner.service.ts because storage is its own concern: every
 * function here has to keep three things in step — the database row, the
 * Cloudinary asset and the temporary file on disk — and get that right on the
 * failure paths as well as the happy one.
 *
 * Two rules hold throughout:
 *   • A Cloudinary asset is destroyed only AFTER the database change commits.
 *     Losing a row is recoverable; deleting a student's paper is not.
 *   • Temp files are released in a finally block, always.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";

import Scanner from "../modals/Scanner.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import Exam from "../modals/Exam.modal";
import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import {
  ANSWER_SHEET_LIMITS,
  answerSheetLimitSummary,
  formatBytes,
} from "../config/uploadLimits";
import {
  destroyAnswerSheet,
  removeTempFile,
  signedAnswerSheetUrl,
  uploadAnswerSheet,
} from "../utils/answerSheetStorage";
import { requireSheetAccess } from "./evaluationAccess.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SheetOutcome = "saved" | "replaced" | "duplicate" | "rejected" | "failed";

export interface SheetResult {
  fileName: string;
  rollNo: string;
  outcome: SheetOutcome;
  sheetId: string | null;
  reason: string | null;
  bytes: number;
}

// How many sheets travel to Cloudinary at once. Four keeps a batch moving
// without opening so many sockets that a school's uplink collapses.
const UPLOAD_CONCURRENCY = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rollNoFromFileName = (fileName: string): string =>
  String(fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .trim();

/** sheetId collisions are cheap to avoid and expensive to debug. */
const generateSheetId = async (taken: Set<string>): Promise<string> => {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = `AS${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
    if (taken.has(candidate)) continue;
    const exists = await Scanner.findOne({
      where: { sheetId: candidate },
      attributes: ["sheetId"],
    });
    if (!exists) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique sheet id.");
};

/** Runs tasks with a fixed worker pool, preserving result order. */
const runPooled = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
};

const isTruthyFlag = (value: unknown): boolean =>
  value === true || value === "true" || value === "1" || value === 1;

// ─── UPLOAD (batch) ───────────────────────────────────────────────────────────

export const uploadSheets = async (
  body: {
    classId: string;
    section: string;
    subjectId: string;
    examType: string;
    replace?: unknown;
    overwrite?: unknown;
  },
  files: Express.Multer.File[],
  uploadedBy: any,
): Promise<any> => {
  const cleanup = async () =>
    Promise.all((files ?? []).map((f) => removeTempFile(f?.path)));

  try {
    const instituteId = uploadedBy?.instituteId;
    if (!instituteId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this user.",
      };
    }

    if (!files || files.length === 0) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "No files were received. Select at least one answer sheet.",
      };
    }

    const missing = (["classId", "section", "subjectId", "examType"] as const).filter(
      (key) => !String((body as any)?.[key] ?? "").trim(),
    );
    if (missing.length > 0) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Missing exam context: ${missing.join(", ")}. Reopen the upload screen and pick the class, section, subject and exam.`,
      };
    }

    // Belt and braces: the middleware caps this too, but the service must not
    // depend on being called through it.
    if (files.length > ANSWER_SHEET_LIMITS.maxFilesPerRequest) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Too many files in one batch. ${answerSheetLimitSummary()}`,
      };
    }

    const totalBytes = files.reduce((sum, f) => sum + (f?.size ?? 0), 0);
    if (totalBytes > ANSWER_SHEET_LIMITS.maxRequestBytes) {
      return {
        error: true,
        statusCode: httpStatus.REQUEST_ENTITY_TOO_LARGE,
        message: `This batch is ${formatBytes(totalBytes)}. ${answerSheetLimitSummary()}`,
      };
    }

    const replaceExisting = isTruthyFlag(body.replace) || isTruthyFlag(body.overwrite);

    const matchingExam = await Exam.findOne({
      where: {
        instituteId,
        classId: body.classId,
        subjectId: body.subjectId,
        examType: body.examType,
        isDeleted: false,
      },
    });

    // One query instead of one per file.
    const rollNos = files.map((f) => rollNoFromFileName(f.originalname)).filter(Boolean);
    const existingRows = rollNos.length
      ? await Scanner.findAll({
          where: {
            instituteId,
            classId: body.classId,
            section: body.section,
            subjectId: body.subjectId,
            examType: body.examType,
            rollNo: { [Op.in]: rollNos },
            isDeleted: false,
          },
        })
      : [];
    const existingByRoll = new Map(existingRows.map((r) => [String(r.rollNo), r]));

    const takenSheetIds = new Set<string>();
    const seenInBatch = new Map<string, string>();
    // Assets replaced during this batch, destroyed only after every row commits.
    const supersededAssets: { publicId: string | null; resourceType: string | null }[] = [];

    const results = await runPooled(files, UPLOAD_CONCURRENCY, async (file): Promise<SheetResult> => {
      const fileName = file.originalname;
      const rollNo = rollNoFromFileName(fileName);
      const base: SheetResult = {
        fileName,
        rollNo,
        outcome: "rejected",
        sheetId: null,
        reason: null,
        bytes: file.size ?? 0,
      };

      if (!rollNo) {
        return { ...base, reason: "The file name is empty, so no roll number could be read from it." };
      }
      if (!/^\d{1,32}$/.test(rollNo)) {
        return {
          ...base,
          reason: `"${fileName}" is not named after a roll number. Rename it to the student's roll number, for example 101.pdf.`,
        };
      }

      const duplicateOf = seenInBatch.get(rollNo);
      if (duplicateOf) {
        return {
          ...base,
          outcome: "duplicate",
          reason: `Roll number ${rollNo} also appears in this batch as "${duplicateOf}". Upload one sheet per student.`,
        };
      }
      seenInBatch.set(rollNo, fileName);

      const existing = existingByRoll.get(rollNo);
      if (existing && !replaceExisting) {
        return {
          ...base,
          outcome: "duplicate",
          sheetId: existing.sheetId,
          reason: `Roll number ${rollNo} already has a sheet for this exam. Use Replace if you want to overwrite it.`,
        };
      }

      const sheetId = existing ? existing.sheetId : await generateSheetId(takenSheetIds);

      let stored = null as Awaited<ReturnType<typeof uploadAnswerSheet>> | null;
      try {
        stored = await uploadAnswerSheet({
          filePath: file.path,
          originalName: fileName,
          mimeType: file.mimetype,
          instituteId,
          sheetId,
        });

        if (existing) {
          // Keep the same row and sheetId so anything already linked to this
          // sheet (evaluations, assignments) still points at the right student.
          const previous = {
            publicId: existing.filePublicId,
            resourceType: existing.fileResourceType,
          };

          await sequelize.transaction(async (t) => {
            await existing.update(
              {
                fileName,
                fileUrl: stored!.url,
                filePublicId: stored!.publicId,
                fileResourceType: stored!.resourceType,
                fileMimeType: file.mimetype,
                fileSize: file.size ?? stored!.bytes,
                fileBuffer: null, // a replaced legacy sheet sheds its blob
                status: "Pending",
                uploadedBy: uploadedBy.userId,
              },
              { transaction: t },
            );

            // The old evaluation belongs to the old scan.
            await AIEvaluation.destroy({ where: { sheetId }, transaction: t });
          });

          // Only now is it safe to drop the old asset, and only if it changed.
          if (previous.publicId && previous.publicId !== stored.publicId) {
            supersededAssets.push(previous);
          }

          return { ...base, outcome: "replaced", sheetId };
        }

        await Scanner.create({
          sheetId,
          instituteId,
          examId: matchingExam ? matchingExam.examId : undefined,
          classId: body.classId,
          section: body.section,
          subjectId: body.subjectId,
          examType: body.examType,
          rollNo,
          fileName,
          fileUrl: stored.url,
          filePublicId: stored.publicId,
          fileResourceType: stored.resourceType,
          fileMimeType: file.mimetype,
          fileSize: file.size ?? stored.bytes,
          uploadedBy: uploadedBy.userId,
          status: "Pending",
        });

        return { ...base, outcome: "saved", sheetId };
      } catch (err: any) {
        // The row never landed, so the asset just uploaded is an orphan.
        if (stored?.publicId) {
          await destroyAnswerSheet(stored.publicId, stored.resourceType, `rollback for roll ${rollNo}`);
        }

        const isUnique = err?.name === "SequelizeUniqueConstraintError";
        logger.error(`[AnswerSheets] Roll ${rollNo} failed: ${err?.message || err}`);
        return {
          ...base,
          outcome: isUnique ? "duplicate" : "failed",
          reason: isUnique
            ? `Roll number ${rollNo} already has a sheet for this exam.`
            : `Could not store this sheet: ${err?.message ?? "unknown error"}`,
        };
      }
    });

    // Every row is committed; the assets they replaced are now unreachable.
    for (const asset of supersededAssets) {
      await destroyAnswerSheet(asset.publicId, asset.resourceType, "replaced sheet");
    }

    const counts = {
      saved: results.filter((r) => r.outcome === "saved").length,
      replaced: results.filter((r) => r.outcome === "replaced").length,
      duplicate: results.filter((r) => r.outcome === "duplicate").length,
      rejected: results.filter((r) => r.outcome === "rejected").length,
      failed: results.filter((r) => r.outcome === "failed").length,
    };
    const stored = counts.saved + counts.replaced;
    const notStored = results.length - stored;

    return {
      error: false,
      statusCode: stored > 0 ? httpStatus.CREATED : httpStatus.OK,
      message:
        stored === 0
          ? "No sheets were stored. Every file in this batch was rejected."
          : notStored === 0
            ? `${stored} sheet${stored === 1 ? "" : "s"} stored successfully.`
            : `${stored} of ${results.length} sheets stored. ${notStored} need attention.`,
      data: { counts, results, limits: ANSWER_SHEET_LIMITS },
    };
  } catch (e: any) {
    logger.error(`[AnswerSheets] Batch upload failed: ${e?.message || e}`);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e?.message ?? e}`,
    };
  } finally {
    await cleanup();
  }
};

// ─── REPLACE (one sheet, by id) ───────────────────────────────────────────────

export const replaceSheet = async (
  sheetId: string,
  file: Express.Multer.File | undefined,
  requestedBy: any,
): Promise<any> => {
  try {
    if (!file) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "No replacement file was received.",
      };
    }

    const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Sheet not found." };
    }
    if (sheet.instituteId !== requestedBy?.instituteId) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Access denied." };
    }

    const previous = {
      publicId: sheet.filePublicId,
      resourceType: sheet.fileResourceType,
    };

    const stored = await uploadAnswerSheet({
      filePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      instituteId: sheet.instituteId,
      sheetId: sheet.sheetId,
    });

    try {
      await sequelize.transaction(async (t) => {
        await sheet.update(
          {
            fileName: file.originalname,
            fileUrl: stored.url,
            filePublicId: stored.publicId,
            fileResourceType: stored.resourceType,
            fileMimeType: file.mimetype,
            fileSize: file.size ?? stored.bytes,
            fileBuffer: null,
            status: "Pending",
            uploadedBy: requestedBy.userId,
          },
          { transaction: t },
        );

        // The previous evaluation was produced from the scan being replaced.
        await AIEvaluation.destroy({ where: { sheetId: sheet.sheetId }, transaction: t });
      });
    } catch (err: any) {
      await destroyAnswerSheet(stored.publicId, stored.resourceType, `rollback replacing ${sheetId}`);
      throw err;
    }

    if (previous.publicId && previous.publicId !== stored.publicId) {
      await destroyAnswerSheet(previous.publicId, previous.resourceType, `replaced ${sheetId}`);
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Sheet for roll number ${sheet.rollNo} replaced. Any earlier evaluation was cleared.`,
      data: { sheetId: sheet.sheetId, rollNo: sheet.rollNo, fileName: file.originalname },
    };
  } catch (e: any) {
    logger.error(`[AnswerSheets] Replace ${sheetId} failed: ${e?.message || e}`);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Could not replace this sheet: ${e?.message ?? e}`,
    };
  } finally {
    await removeTempFile(file?.path);
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const deleteSheet = async (sheetId: string, requestedBy: any): Promise<any> => {
  try {
    const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Sheet not found." };
    }
    if (sheet.instituteId !== requestedBy?.instituteId) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Access denied." };
    }

    const asset = { publicId: sheet.filePublicId, resourceType: sheet.fileResourceType };
    const rollNo = sheet.rollNo;

    await sequelize.transaction(async (t) => {
      // Soft delete keeps the audit trail; the bytes are what actually go.
      await sheet.update({ isDeleted: true, fileBuffer: null }, { transaction: t });
      await AIEvaluation.destroy({ where: { sheetId }, transaction: t });
    });

    // Committed — the asset can no longer be reached through the app.
    await destroyAnswerSheet(asset.publicId, asset.resourceType, `deleted sheet ${sheetId}`);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Sheet for roll number ${rollNo} deleted.`,
      data: { sheetId, rollNo },
    };
  } catch (e: any) {
    logger.error(`[AnswerSheets] Delete ${sheetId} failed: ${e?.message || e}`);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Could not delete this sheet: ${e?.message ?? e}`,
    };
  }
};

// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * Returns either a short-lived Cloudinary URL to redirect to, or — for sheets
 * uploaded before the move to Cloudinary — the stored bytes. Keeping the
 * fallback means the migration can run at its own pace without breaking
 * anything already in the system.
 */
export const getSheetFile = async (sheetId: string, requestedBy: any): Promise<any> => {
  try {
    const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Sheet not found." };
    }
    if (sheet.instituteId !== requestedBy?.instituteId) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Access denied." };
    }

    let access = "full";
    try {
      access = (await requireSheetAccess(requestedBy, sheetId)).access;
    } catch (err: any) {
      return {
        error: true,
        statusCode: err?.statusCode || httpStatus.FORBIDDEN,
        message: err?.message || "Access denied.",
      };
    }

    const ext = String(sheet.fileName ?? "").match(/\.[a-z0-9]{1,6}$/i)?.[0]?.toLowerCase() ?? "";
    // A teacher who only evaluates this paper must not learn whose it is.
    const fileName = access === "masked" ? `answer-sheet${ext}` : sheet.fileName;

    if (sheet.filePublicId) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "File located.",
        data: {
          redirectUrl: signedAnswerSheetUrl(
            sheet.filePublicId,
            sheet.fileResourceType || "raw",
          ),
          mimeType: sheet.fileMimeType,
          fileName,
        },
      };
    }

    if (sheet.fileUrl) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "File located.",
        data: { redirectUrl: sheet.fileUrl, mimeType: sheet.fileMimeType, fileName },
      };
    }

    if (sheet.fileBuffer) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "File fetched from legacy storage.",
        data: { buffer: sheet.fileBuffer, mimeType: sheet.fileMimeType, fileName },
      };
    }

    return {
      error: true,
      statusCode: httpStatus.NOT_FOUND,
      message: "This sheet has no stored file. It may need to be uploaded again.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e?.message ?? e}`,
    };
  }
};

export default { uploadSheets, replaceSheet, deleteSheet, getSheetFile };
