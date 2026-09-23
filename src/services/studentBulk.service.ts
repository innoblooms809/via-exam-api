import httpStatus from "http-status";
import { Op } from "sequelize";

import UserModal from "../modals/User.modal";
import StudentProfile from "../modals/Student.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import Class from "../modals/Class.modal";
import Section from "../modals/Section.modal";
import Session from "../modals/Session.modal";

import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";
import { sequelize } from "../config/sequelize";
import {
  MAX_BULK_ROWS,
  bulkStudentRowSchema,
  FIELD_LABELS,
} from "../validations/student.validation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BulkErrorType =
  | "validation" // the cell contents are wrong
  | "reference" // class / section / session does not exist in this institute
  | "duplicate" // clashes with the DB or with another row in the same file
  | "server"; // unexpected failure while saving

export interface BulkRowError {
  rowNumber: number; // spreadsheet row the admin sees
  field: string | null; // machine field name
  fieldLabel: string | null; // column heading the admin sees
  reason: string;
  type: BulkErrorType;
  rollNumber: string;
  name: string;
  email: string;
  /** Pre-formatted single line, handy for logs and CSV exports. */
  message: string;
}

export interface BulkRowSuccess {
  rowNumber: number;
  userId: string;
  name: string;
  email: string;
  mobile: string;
  rollNumber: string;
  className: string;
  sectionName: string;
  session: string;
  /** Only present when the server generated the password for this student. */
  generatedPassword: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const norm = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const asString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

/**
 * Class names are typed by humans into a spreadsheet, so "10", "Class 10",
 * "class  10" and "CLASS 10" all have to resolve to the same class.
 */
const classKeys = (className: string): string[] => {
  const base = norm(className);
  if (!base) return [];
  const keys = new Set<string>([base]);
  if (base.startsWith("class ")) keys.add(base.slice(6).trim());
  else keys.add(`class ${base}`);
  return [...keys].filter(Boolean);
};

const rollKeyOf = (
  rollNumber: string,
  className: string,
  sectionId: string,
  session: string,
): string =>
  `${norm(rollNumber)}::${norm(className)}::${norm(sectionId)}::${norm(session)}`;

const buildError = (
  rowNumber: number,
  row: any,
  type: BulkErrorType,
  reason: string,
  field: string | null = null,
): BulkRowError => {
  const fieldLabel = field ? FIELD_LABELS[field] ?? field : null;
  const name = `${asString(row?.firstName)} ${asString(row?.lastName)}`.trim();
  return {
    rowNumber,
    field,
    fieldLabel,
    reason,
    type,
    rollNumber: asString(row?.rollNumber),
    name,
    email: asString(row?.email),
    message: fieldLabel
      ? `Row ${rowNumber} · ${fieldLabel}: ${reason}`
      : `Row ${rowNumber}: ${reason}`,
  };
};

/**
 * User ids in this system are "IB" followed by six digits.
 *
 * RegHelper.generateUserId() fills those six digits from the current
 * millisecond plus two random ones, which is fine one student at a time but
 * collapses in a loop: a synchronous burst sees the same millisecond and can
 * therefore only produce a hundred distinct values. The same six-digit shape
 * is kept here, drawn uniformly so a thousand-row upload has a pool to work
 * from, and every candidate is still cleared against the database.
 */
const drawUserId = (): string =>
  `IB${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;

const allocateUserIds = async (count: number): Promise<string[]> => {
  const free: string[] = [];
  const rejected = new Set<string>();

  for (let round = 0; round < 10 && free.length < count; round++) {
    const needed = count - free.length;
    const candidates = new Set<string>();

    // Over-draw so a round that loses candidates to the database still makes
    // progress, and cap the attempts so a saturated id space cannot spin.
    const wanted = needed + Math.ceil(needed * 0.2) + 25;
    const drawLimit = wanted * 50;
    for (let i = 0; i < drawLimit && candidates.size < wanted; i++) {
      const id = drawUserId();
      if (!rejected.has(id)) candidates.add(id);
    }
    if (candidates.size === 0) break;

    const taken = await UserModal.findAll({
      where: { userId: { [Op.in]: [...candidates] } },
      attributes: ["userId"],
    });
    for (const row of taken as any[]) {
      candidates.delete(row.userId);
      rejected.add(row.userId);
    }

    for (const id of candidates) {
      if (free.length >= count) break;
      free.push(id);
      rejected.add(id); // never hand the same id out twice in one run
    }
  }

  if (free.length < count) {
    throw new Error(
      "Could not allocate enough unique student IDs. Please upload a smaller batch and try again.",
    );
  }
  return free;
};

// ─── Bulk create ──────────────────────────────────────────────────────────────

const bulkCreateStudents = async (students: any[], createdBy: any): Promise<any> => {
  try {
    // 1 ── Envelope checks ────────────────────────────────────────────────────
    if (!Array.isArray(students)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Invalid payload: students must be an array of rows.",
      };
    }
    if (students.length === 0) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "The uploaded file contains no student rows.",
      };
    }
    if (students.length > MAX_BULK_ROWS) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `You can upload a maximum of ${MAX_BULK_ROWS} students at a time. Please split the file.`,
      };
    }

    const instituteId = createdBy?.instituteId;
    if (!instituteId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this admin.",
      };
    }

    // 2 ── Institute / role preconditions ─────────────────────────────────────
    const institute = await Institute.findOne({
      where: { instituteId, isDeleted: false, status: 1 },
    });
    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found or inactive.",
      };
    }

    const studentRole = await Role.findOne({ where: { role: "STUDENT" } });
    if (!studentRole) {
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "STUDENT role not found. Please seed roles.",
      };
    }

    // 3 ── Prefetch reference data once (avoids N+1 lookups per row) ──────────
    const [classRows, sectionRows, sessionRows] = await Promise.all([
      Class.findAll({ where: { instituteId, isDeleted: false } }),
      Section.findAll({ where: { instituteId, isDeleted: false } }),
      Session.findAll({ where: { instituteId, isDeleted: false } }),
    ]);

    if (classRows.length === 0) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message:
          "No classes have been configured for this institute. Add classes before uploading students.",
      };
    }
    if (sessionRows.length === 0) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message:
          "No academic sessions have been configured for this institute. Add a session before uploading students.",
      };
    }

    const classByKey = new Map<string, any>();
    for (const c of classRows) {
      classByKey.set(norm(c.classId), c);
      for (const key of classKeys(c.className)) classByKey.set(key, c);
    }

    const sectionById = new Map<string, any>();
    const sectionByClassAndName = new Map<string, any>();
    for (const s of sectionRows) {
      sectionById.set(norm(s.sectionId), s);
      sectionByClassAndName.set(`${norm(s.classId)}::${norm(s.sectionName)}`, s);
    }

    const sessionByName = new Map<string, any>();
    for (const s of sessionRows) {
      sessionByName.set(norm(s.sessionName), s);
      sessionByName.set(norm(s.sessionId), s);
    }

    const availableClasses = classRows.map((c: any) => c.className).join(", ");
    const availableSessions = sessionRows.map((s: any) => s.sessionName).join(", ");

    // 4 ── Prefetch the existing identities this upload could collide with ────
    const candidateEmails = students.map((s) => norm(s?.email)).filter(Boolean);
    const candidateMobiles = students.map((s) => asString(s?.mobile)).filter(Boolean);
    const candidateRolls = students.map((s) => asString(s?.rollNumber)).filter(Boolean);

    const userOrClauses: any[] = [];
    if (candidateEmails.length) userOrClauses.push({ emailId: { [Op.in]: candidateEmails } });
    if (candidateMobiles.length) userOrClauses.push({ phoneNumber: { [Op.in]: candidateMobiles } });

    const [existingUsers, existingProfiles] = await Promise.all([
      userOrClauses.length
        ? UserModal.findAll({
            where: { [Op.or]: userOrClauses },
            attributes: ["userId", "emailId", "phoneNumber"],
          })
        : Promise.resolve([] as any[]),
      candidateRolls.length
        ? StudentProfile.findAll({
            where: { instituteId, rollNumber: { [Op.in]: candidateRolls } },
            attributes: ["rollNumber", "className", "sectionId", "session"],
          })
        : Promise.resolve([] as any[]),
    ]);

    const dbEmails = new Set(existingUsers.map((u: any) => norm(u.emailId)));
    const dbMobiles = new Set(existingUsers.map((u: any) => asString(u.phoneNumber)));
    const dbRollKeys = new Set(
      existingProfiles.map((p: any) =>
        rollKeyOf(p.rollNumber, p.className, p.sectionId, p.session),
      ),
    );

    // 5 ── Walk the rows ──────────────────────────────────────────────────────
    const errors: BulkRowError[] = [];
    const successes: BulkRowSuccess[] = [];

    // One pool for the whole batch, sized to the worst case where every row
    // turns out to be insertable.
    const userIdPool = await allocateUserIds(students.length);
    let nextUserId = 0;

    // Rows written earlier in this run are not part of the snapshot taken
    // above, so in-file collisions are tracked in memory as well.
    const seenEmails = new Map<string, number>();
    const seenMobiles = new Map<string, number>();
    const seenRollKeys = new Map<string, number>();

    for (let i = 0; i < students.length; i++) {
      const raw = students[i] ?? {};
      // The client sends the real spreadsheet row so every message points at
      // the line the admin is actually looking at; fall back to array order.
      const rowNumber = Number.isFinite(Number(raw.rowNumber))
        ? Number(raw.rowNumber)
        : i + 1;

      // 5a ── Field-level validation ──────────────────────────────────────────
      const { value: row, error: joiError } = bulkStudentRowSchema.validate(raw, {
        abortEarly: false,
        convert: true,
      });

      if (joiError) {
        for (const detail of joiError.details) {
          const field = String(detail.path?.[0] ?? "");
          errors.push(
            buildError(rowNumber, raw, "validation", detail.message, field || null),
          );
        }
        continue;
      }

      // 5b ── Reference resolution: class, then section, then session ─────────
      const classRecord = classByKey.get(norm(row.className));
      if (!classRecord) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "reference",
            `Class "${asString(raw.className)}" does not exist in this institute. Available classes: ${availableClasses}.`,
            "className",
          ),
        );
        continue;
      }

      const sectionRecord =
        sectionByClassAndName.get(`${norm(classRecord.classId)}::${norm(row.sectionId)}`) ??
        sectionById.get(norm(row.sectionId));

      if (!sectionRecord) {
        const optionsForClass = sectionRows
          .filter((s: any) => norm(s.classId) === norm(classRecord.classId))
          .map((s: any) => s.sectionName)
          .join(", ");
        errors.push(
          buildError(
            rowNumber,
            raw,
            "reference",
            optionsForClass
              ? `Section "${asString(raw.sectionId)}" does not exist in ${classRecord.className}. Available sections: ${optionsForClass}.`
              : `No sections have been configured for ${classRecord.className}.`,
            "sectionId",
          ),
        );
        continue;
      }

      if (norm(sectionRecord.classId) !== norm(classRecord.classId)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "reference",
            `Section "${sectionRecord.sectionName}" does not belong to ${classRecord.className}.`,
            "sectionId",
          ),
        );
        continue;
      }

      const sessionRecord = sessionByName.get(norm(row.session));
      if (!sessionRecord) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "reference",
            `Session "${asString(raw.session)}" does not exist in this institute. Available sessions: ${availableSessions}.`,
            "session",
          ),
        );
        continue;
      }

      // Store canonical values so the uniqueness keys line up with the ones
      // written by the single-student form.
      const className: string = classRecord.className;
      const sectionId: string = sectionRecord.sectionId;
      const sessionName: string = sessionRecord.sessionName;

      const emailKey = norm(row.email);
      const mobileKey = asString(row.mobile);
      const rollKey = rollKeyOf(row.rollNumber, className, sectionId, sessionName);

      // 5c ── Duplicates inside the uploaded file ─────────────────────────────
      if (seenEmails.has(emailKey)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "duplicate",
            `Email "${row.email}" is already used on row ${seenEmails.get(emailKey)} of this file.`,
            "email",
          ),
        );
        continue;
      }
      if (seenMobiles.has(mobileKey)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "duplicate",
            `Mobile number "${row.mobile}" is already used on row ${seenMobiles.get(mobileKey)} of this file.`,
            "mobile",
          ),
        );
        continue;
      }
      if (seenRollKeys.has(rollKey)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "duplicate",
            `Roll number "${row.rollNumber}" for ${className} section ${sectionRecord.sectionName} (${sessionName}) is already used on row ${seenRollKeys.get(rollKey)} of this file.`,
            "rollNumber",
          ),
        );
        continue;
      }

      // 5d ── Duplicates already in the database ──────────────────────────────
      if (dbEmails.has(emailKey)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "duplicate",
            `Email "${row.email}" is already registered to another user.`,
            "email",
          ),
        );
        continue;
      }
      if (dbMobiles.has(mobileKey)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "duplicate",
            `Mobile number "${row.mobile}" is already registered to another user.`,
            "mobile",
          ),
        );
        continue;
      }
      if (dbRollKeys.has(rollKey)) {
        errors.push(
          buildError(
            rowNumber,
            raw,
            "duplicate",
            `Roll number "${row.rollNumber}" already exists in ${className} section ${sectionRecord.sectionName} for session ${sessionName}.`,
            "rollNumber",
          ),
        );
        continue;
      }

      // 5e ── Persist the row in its own transaction ──────────────────────────
      // One transaction per row is deliberate: on Postgres a single failed
      // statement poisons the surrounding transaction, so a shared transaction
      // would let one bad row take down every row after it.
      const t = await sequelize.transaction();
      try {
        const generated = !asString(row.password);
        const plainPassword = asString(row.password) || (await RegHelper.generatePassword());
        const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
        const userId = userIdPool[nextUserId];

        const newUser = await UserModal.create(
          {
            userId,
            userName: `${row.firstName} ${row.lastName}`.trim(),
            emailId: row.email,
            phoneNumber: row.mobile,
            password: encryptedPassword,
            roleId: studentRole.id,
            instituteId,
            status: 1,
          },
          { transaction: t },
        );

        await StudentProfile.create(
          {
            userId: newUser.userId,
            instituteId,
            classId: classRecord.classId,
            rollNumber: row.rollNumber,
            className,
            sectionId,
            session: sessionName,
            fatherName: asString(row.fatherName) || "Not provided",
            gender: row.gender,
            dob: new Date(row.dob),
            aadhar: asString(row.aadhar) || "000000000000",
            address: asString(row.address) || "Not provided",
            profileUrl: null,
            isActive: true,
          },
          { transaction: t },
        );

        await t.commit();
        nextUserId++; // only consume the id once the row is safely committed

        seenEmails.set(emailKey, rowNumber);
        seenMobiles.set(mobileKey, rowNumber);
        seenRollKeys.set(rollKey, rowNumber);

        successes.push({
          rowNumber,
          userId: newUser.userId,
          name: `${row.firstName} ${row.lastName}`.trim(),
          email: row.email,
          mobile: row.mobile,
          rollNumber: row.rollNumber,
          className,
          sectionName: sectionRecord.sectionName,
          session: sessionName,
          generatedPassword: generated ? plainPassword : null,
        });
      } catch (err: any) {
        try {
          await t.rollback();
        } catch {
          /* transaction already resolved */
        }
        const isUnique = err?.name === "SequelizeUniqueConstraintError";
        errors.push(
          buildError(
            rowNumber,
            raw,
            isUnique ? "duplicate" : "server",
            isUnique
              ? "This student clashes with an existing record (email, mobile or roll number)."
              : `Could not save this student: ${err?.message ?? "unknown error"}`,
          ),
        );
      }
    }

    // 6 ── Summarise ──────────────────────────────────────────────────────────
    const created = successes.length;
    const failedRows = new Set(errors.map((e) => e.rowNumber)).size;

    const counts = {
      validation: errors.filter((e) => e.type === "validation").length,
      duplicate: errors.filter((e) => e.type === "duplicate").length,
      reference: errors.filter((e) => e.type === "reference").length,
      server: errors.filter((e) => e.type === "server").length,
    };

    const message =
      created === 0
        ? "No students were saved. Every row was rejected, see the row-level details."
        : failedRows === 0
          ? `All ${created} students were saved successfully.`
          : `${created} of ${students.length} students were saved. ${failedRows} row(s) were rejected, see the row-level details.`;

    return {
      error: false,
      statusCode: created > 0 ? httpStatus.CREATED : httpStatus.OK,
      message,
      data: {
        totalRows: students.length,
        created,
        failed: failedRows,
        counts,
        successes,
        errors,
        // Legacy field, kept so any older client keeps working.
        skipped: failedRows,
      },
    };
  } catch (e: any) {
    console.error("bulkCreateStudents failed:", e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e?.message ?? e}`,
    };
  }
};

export default { bulkCreateStudents };
