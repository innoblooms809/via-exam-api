// Who may see which student answer sheets, and whether names are masked.
//
//   Admin / super admin  → every sheet and its AI marks, real names, view only (never evaluates)
//   Scanner  → the scans they handle, view only
//   Teacher who teaches the subject of that class (Subject.teacherId)  → view only, real names,
//     except the exams they evaluate and the sheets they recheck or cross-check (those stay masked)
//   Teacher assigned by the admin to evaluate the exam  → names masked ("R**** S*****", roll "1**"), may evaluate,
//     even when they also teach the subject: marking is always blind
//   Teacher cross-checking a paper (open round)  → names masked, view only (the verdict changes marks)
//   Any other teacher (e.g. only set the question paper)  → no access
//
// Running AI evaluation or changing marks is allowed only for the assigned evaluator: an exam
// nobody is assigned to cannot be evaluated, and the admin views sheets and marks, never edits.
//
// Masking is applied here, on the server, so a masked teacher's browser never
// receives the real name or roll number.

import { Op } from "sequelize";
import httpStatus from "http-status";
import Subject from "../../models/Subject.model";
import Class from "../../models/Class.model";
import Exam from "../../models/Exam.model";
import Scanner from "../../models/Scanner.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import RecheckRequest from "../../models/RecheckRequest.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import { CrossCheckItem, CrossCheckRound } from "../../models/CrossCheck.model";
import ApiError from "../../utils/ApiError";

export type SheetAccess = "full" | "masked" | "none";

export const isTeacherRequester = (user: any): boolean =>
  String(user?.role?.role ?? user?.role ?? "").toUpperCase().includes("TEACH");

/** Scanners see names and personal details masked like the teacher panel, but keep roll numbers (they match physical sheets by roll). */
export const isScannerRequester = (user: any): boolean =>
  String(user?.role?.role ?? user?.role ?? "").toUpperCase().includes("SCAN");

export const isAdminRequester = (user: any): boolean => {
  const role = String(user?.role?.role ?? user?.role ?? "").toUpperCase().replace(/[\s_-]+/g, "");
  return role === "ADMIN" || role === "SUPERADMIN";
};

// ── Masking ──────────────────────────────────────────────────────────────────

/** "Rahul Kumar Sharma" → "R**** K**** S*****" */
export const maskName = (value: unknown): string => {
  const name = String(value ?? "").trim();
  if (!name) return "";
  return name
    .split(/\s+/)
    .map((word) => (word.length <= 1 ? "*" : `${word[0]}${"*".repeat(word.length - 1)}`))
    .join(" ");
};

/** "105" → "1**", "7" → "*" */
export const maskRoll = (value: unknown): string => {
  const roll = String(value ?? "").trim();
  if (!roll) return "";
  return roll.length <= 1 ? "*" : `${roll[0]}${"*".repeat(roll.length - 1)}`;
};

/** Internal ids ("IB806749") → "IB******" */
export const maskId = (value: unknown): string => {
  const id = String(value ?? "").trim();
  if (!id) return "";
  const keep = Math.min(2, id.length - 1);
  return `${id.slice(0, keep)}${"*".repeat(id.length - keep)}`;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Hides the student's name / roll number where they appear in free text (e.g. OCR of the sheet). */
export const maskInText = (text: unknown, words: unknown[]): string => {
  let out = String(text ?? "");
  const tokens = Array.from(
    new Set(
      words
        .flatMap((w) => String(w ?? "").split(/\s+/))
        .map((w) => w.trim())
        .filter((w) => w.length >= 2)
    )
  ).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const pattern = /^\d+$/.test(token) ? `\\b${escapeRegExp(token)}\\b` : escapeRegExp(token);
    out = out.replace(new RegExp(pattern, "gi"), (m) => maskName(m));
  }
  return out;
};

const fileExtension = (fileName: unknown) => {
  const match = String(fileName ?? "").match(/\.[a-z0-9]{1,6}$/i);
  return match ? match[0].toLowerCase() : "";
};

// ── Teacher scope ────────────────────────────────────────────────────────────

interface AssignedExamScope {
  examId: string;
  subjectId: string;
  examType: string;
  classKeys: Set<string>; // classId and className (sheets store either)
}

export interface TeacherScope {
  userId: string;
  instituteId: string;
  /** Subjects (per class) this teacher teaches → real data. */
  ownSubjectIds: Set<string>;
  /** Class ids / names this teacher teaches any subject in. */
  ownClassKeys: Set<string>;
  /** Exams this teacher was assigned to evaluate → masked data. */
  assignedExams: AssignedExamScope[];
  /** Sheets of open recheck requests the admin gave this teacher → masked data, evaluate. */
  recheckSheetIds: Set<string>;
  /**
   * Sheets of every recheck still with this teacher: open, or their decision awaiting the
   * admin's approval → masked data, view only once the decision is sent.
   */
  recheckViewSheetIds: Set<string>;
  /** Sheets in this teacher's open cross-check rounds → masked data, view only. */
  crossCheckSheetIds: Set<string>;
  /**
   * Every sheet this teacher rechecks or cross-checks (open or done): always masked, even
   * when they teach the subject, so a re-evaluation or second check stays blind.
   */
  blindSheetIds: Set<string>;
}

/**
 * Sheet ids behind the recheck requests assigned to this teacher that are still with them:
 * `open` while they re-evaluate (assignment not completed), `withTeacher` also while their
 * decision awaits the admin's approval (the same window recheckFor shows the recheck in).
 */
async function recheckSheetIdsOf(instituteId: string, teacherId: string): Promise<{ open: Set<string>; withTeacher: Set<string> }> {
  const ids = { open: new Set<string>(), withTeacher: new Set<string>() };
  const assignments = await RecheckAssignment.findAll({
    where: { instituteId, teacherId },
    attributes: ["requestId", "completedAt"],
  });
  if (!assignments.length) return ids;
  const requests = await RecheckRequest.findAll({
    where: { requestId: { [Op.in]: assignments.map((a) => a.requestId) }, status: { [Op.in]: ["Under Review", "Awaiting Approval"] } },
    attributes: ["requestId", "evaluationId"],
  });
  if (!requests.length) return ids;
  const evaluations = await AIEvaluation.findAll({
    where: { evaluationId: { [Op.in]: requests.map((r) => r.evaluationId) } },
    attributes: ["evaluationId", "sheetId"],
  });
  const sheetOf = new Map(evaluations.map((e) => [String(e.evaluationId), String(e.sheetId)]));
  const openRequests = new Set(assignments.filter((a) => !a.completedAt).map((a) => a.requestId));
  for (const r of requests) {
    const sheetId = sheetOf.get(String(r.evaluationId));
    if (!sheetId) continue;
    ids.withTeacher.add(sheetId);
    if (openRequests.has(r.requestId)) ids.open.add(sheetId);
  }
  return ids;
}

/** Every sheet of a recheck given to this teacher or a cross-check round they hold, open or done. */
async function blindSheetIdsOf(instituteId: string, teacherId: string): Promise<Set<string>> {
  const [assignments, rounds] = await Promise.all([
    RecheckAssignment.findAll({ where: { instituteId, teacherId }, attributes: ["requestId"] }),
    CrossCheckRound.findAll({ where: { instituteId, checkerId: teacherId }, attributes: ["roundId"] }),
  ]);
  const [requests, items] = await Promise.all([
    assignments.length ? RecheckRequest.findAll({ where: { requestId: { [Op.in]: assignments.map((a) => a.requestId) } }, attributes: ["evaluationId"] }) : [],
    rounds.length ? CrossCheckItem.findAll({ where: { roundId: { [Op.in]: rounds.map((r) => r.roundId) } }, attributes: ["sheetId"] }) : [],
  ]);
  const evaluations = requests.length
    ? await AIEvaluation.findAll({ where: { evaluationId: { [Op.in]: requests.map((r) => r.evaluationId) } }, attributes: ["sheetId"] })
    : [];
  return new Set([...evaluations.map((e) => String(e.sheetId)), ...items.map((i) => String(i.sheetId))]);
}

/** Sheets in the open cross-check rounds this teacher checks. */
async function openCrossCheckSheetIds(instituteId: string, teacherId: string): Promise<Set<string>> {
  const rounds = await CrossCheckRound.findAll({ where: { instituteId, checkerId: teacherId, isActive: true, status: "open" }, attributes: ["roundId"] });
  if (!rounds.length) return new Set();
  const items = await CrossCheckItem.findAll({ where: { roundId: { [Op.in]: rounds.map((r) => r.roundId) } }, attributes: ["sheetId"] });
  return new Set(items.map((i) => String(i.sheetId)));
}

export async function getTeacherScope(user: any): Promise<TeacherScope> {
  const userId = String(user?.userId ?? "");
  const instituteId = String(user?.instituteId ?? "");

  const [subjects, assignments, rechecks, crossCheckSheetIds, blindSheetIds] = await Promise.all([
    Subject.findAll({
      where: { instituteId, teacherId: userId, isDeleted: false },
      attributes: ["subjectId", "classId"],
      include: [{ model: Class, as: "class", attributes: ["classId", "className"], required: false }],
    }),
    EvaluationAssignment.findAll({
      where: { instituteId, teacherId: userId, isActive: true },
      attributes: ["examId"],
    }),
    recheckSheetIdsOf(instituteId, userId),
    openCrossCheckSheetIds(instituteId, userId),
    blindSheetIdsOf(instituteId, userId),
  ]);

  const exams = assignments.length
    ? await Exam.findAll({
        where: { examId: { [Op.in]: assignments.map((a) => a.examId) }, isDeleted: false },
        attributes: ["examId", "subjectId", "examType", "classId"],
        include: [{ model: Class, as: "class", attributes: ["classId", "className"], required: false }],
      })
    : [];

  const ownClassKeys = new Set<string>();
  subjects.forEach((s: any) => {
    if (s.classId) ownClassKeys.add(String(s.classId));
    if (s.class?.className) ownClassKeys.add(String(s.class.className));
  });

  return {
    userId,
    instituteId,
    ownSubjectIds: new Set(subjects.map((s: any) => String(s.subjectId))),
    ownClassKeys,
    recheckSheetIds: rechecks.open,
    recheckViewSheetIds: rechecks.withTeacher,
    crossCheckSheetIds,
    blindSheetIds,
    assignedExams: exams.map((e: any) => ({
      examId: String(e.examId),
      subjectId: String(e.subjectId),
      examType: String(e.examType),
      classKeys: new Set([e.classId, e.class?.className].filter(Boolean).map(String)),
    })),
  };
}

type SheetLike = { subjectId?: unknown; classId?: unknown; examType?: unknown; examId?: unknown; sheetId?: unknown };

const isRecheckSheet = (scope: TeacherScope, sheet: SheetLike) =>
  Boolean(sheet.sheetId) && scope.recheckSheetIds.has(String(sheet.sheetId));

const isAssignedExam = (scope: TeacherScope, sheet: SheetLike) =>
  scope.assignedExams.some(
    (a) =>
      (sheet.examId && a.examId === String(sheet.examId)) ||
      (a.subjectId === String(sheet.subjectId ?? "") &&
        a.examType === String(sheet.examType ?? "") &&
        a.classKeys.has(String(sheet.classId ?? "")))
  );

export function accessForSheet(scope: TeacherScope, sheet: SheetLike): SheetAccess {
  const assigned = isAssignedExam(scope, sheet);
  // A sheet this teacher evaluates, rechecks or cross-checks is never shown with its owner's name or
  // roll, even when they teach the subject: marking stays blind.
  const blind = Boolean(sheet.sheetId) && scope.blindSheetIds.has(String(sheet.sheetId));
  if (scope.ownSubjectIds.has(String(sheet.subjectId ?? ""))) return assigned || blind ? "masked" : "full";
  const crossChecking = Boolean(sheet.sheetId) && scope.crossCheckSheetIds.has(String(sheet.sheetId));
  // A recheck stays viewable after the teacher sends their decision, until the admin settles it.
  const rechecking = Boolean(sheet.sheetId) && scope.recheckViewSheetIds.has(String(sheet.sheetId));
  return assigned || rechecking || crossChecking ? "masked" : "none";
}

/**
 * Is this teacher the admin-assigned evaluator of the sheet's exam? The teacher rechecking or
 * cross-checking the sheet also evaluates it, into their own draft (recheckDraft /
 * crossCheckDraft services).
 */
export function isAssignedEvaluator(scope: TeacherScope, sheet: SheetLike): boolean {
  if (isRecheckSheet(scope, sheet)) return true;
  if (sheet.sheetId && scope.crossCheckSheetIds.has(String(sheet.sheetId))) return true;
  return isAssignedExam(scope, sheet);
}

export function accessForExam(scope: TeacherScope, exam: { examId: string; subjectId: string }): SheetAccess {
  // The evaluator marks blind, even of a subject they teach.
  if (scope.assignedExams.some((a) => a.examId === exam.examId)) return "masked";
  return scope.ownSubjectIds.has(String(exam.subjectId)) ? "full" : "none";
}

/** Masks the identity fields of one sheet row (plain object). */
export function maskSheetRow<T extends Record<string, any>>(row: T, options: { keepRoll?: boolean } = {}): T {
  return {
    ...row,
    rollNo: options.keepRoll ? row.rollNo : maskRoll(row.rollNo),
    studentName: row.studentName ? maskName(row.studentName) : row.studentName,
    // Uploaded file names often carry the roll number or name.
    fileName: row.fileName ? `answer-sheet${fileExtension(row.fileName)}` : row.fileName,
    identityMasked: true,
  };
}

/** Filters a sheet list to what the requester may see, masking where needed. */
export async function scopeSheetRows<T extends Record<string, any>>(user: any, rows: T[]): Promise<T[]> {
  if (isScannerRequester(user)) return rows.map((row) => maskSheetRow(row, { keepRoll: true }));
  if (!isTeacherRequester(user)) return rows;
  const scope = await getTeacherScope(user);
  return rows.flatMap((row) => {
    const access = accessForSheet(scope, row);
    if (access === "none") return [];
    return [access === "masked" ? maskSheetRow(row) : { ...row, identityMasked: false }];
  });
}

/** Access level of the requester for one sheet; throws 403/404 when they have none. */
export async function requireSheetAccess(
  user: any,
  sheetId: string,
  options: { evaluate?: boolean } = {}
): Promise<{ access: SheetAccess; sheet: any; canEvaluate: boolean }> {
  const sheet: any = await Scanner.findOne({
    where: { sheetId, isDeleted: false },
    attributes: { exclude: ["fileBuffer"] },
  });
  if (!sheet) throw new ApiError(httpStatus.NOT_FOUND, "Answer sheet not found.");
  if (user?.instituteId && sheet.instituteId !== user.instituteId) {
    throw new ApiError(httpStatus.FORBIDDEN, "Access denied.");
  }
  if (!isTeacherRequester(user)) {
    // The admin sees every sheet and its AI marks; running AI evaluation and changing marks
    // are the assigned evaluator's work.
    if (isAdminRequester(user)) {
      if (options.evaluate) throw new ApiError(httpStatus.FORBIDDEN, "Only the evaluator assigned to this exam runs AI evaluation or changes marks. You can view the sheet and its marks.");
      return { access: "full", sheet, canEvaluate: false };
    }
    // Scanners may open the scans they handle; nobody but the assigned evaluator may
    // evaluate or change marks (students least of all).
    const role = String(user?.role?.role ?? user?.role ?? "").toUpperCase();
    if (role !== "SCANNER" || options.evaluate) {
      throw new ApiError(httpStatus.FORBIDDEN, "You do not have access to evaluate this answer sheet.");
    }
    return { access: "full", sheet, canEvaluate: false };
  }

  const scope = await getTeacherScope(user);
  const access = accessForSheet(scope, sheet);
  if (access === "none") {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "This answer sheet is not assigned to you. Only the class subject teacher or the assigned evaluator can open it."
    );
  }
  const canEvaluate = isAssignedEvaluator(scope, sheet);
  if (options.evaluate && !canEvaluate) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "This exam is not assigned to you for evaluation. You can view the answer sheets and reports, but only the evaluator assigned by the admin can run AI evaluation or change marks."
    );
  }
  return { access, sheet, canEvaluate };
}

const sheetAccessMiddleware = (evaluate: boolean) => async (req: any, res: any, next: any) => {
  const sheetId = String(req.params?.sheetId ?? req.body?.sheetId ?? "");
  if (!sheetId) return next();
  try {
    const { access, sheet, canEvaluate } = await requireSheetAccess(req.viaExamUser, sheetId, { evaluate });
    req.sheetAccess = access;
    req.accessSheet = sheet;
    req.canEvaluate = canEvaluate;
    return next();
  } catch (err: any) {
    const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
    return res.status(statusCode).json({ error: true, statusCode, message: err?.message || "Access check failed." });
  }
};

/** Express middleware: the sheet in req.body.sheetId / req.params.sheetId may be viewed. */
export const requireSheetAccessMiddleware = sheetAccessMiddleware(false);

/** Express middleware: the requester may run AI evaluation / change marks for this sheet. */
export const requireSheetEvaluateMiddleware = sheetAccessMiddleware(true);

// ── AI evaluation results ────────────────────────────────────────────────────

const OCR_TEXT_FIELDS = ["studentAnsOcr", "feedback"];

/** Hides who wrote the sheet in an AI evaluation record (name, ids, roll number in OCR text). */
export function maskEvaluationIdentity(data: any, sheet: any): any {
  const plain = typeof data?.toJSON === "function" ? data.toJSON() : { ...data };
  const realWords = [plain.studentName, sheet?.studentName, sheet?.rollNo];
  const masked: any = {
    ...plain,
    studentName: plain.studentName ? maskName(plain.studentName) : plain.studentName,
    studentId: maskId(plain.studentId),
    rollNo: sheet?.rollNo ? maskRoll(sheet.rollNo) : plain.rollNo,
    identityMasked: true,
  };
  OCR_TEXT_FIELDS.forEach((field) => {
    if (typeof masked[field] === "string") masked[field] = maskInText(masked[field], realWords);
  });
  return masked;
}

/** Filters / masks a list of AI evaluation records for the requester (by the sheet each belongs to). */
export async function scopeEvaluationRows(user: any, rows: any[]): Promise<any[]> {
  const sheetIds = Array.from(new Set(rows.map((r) => String(r?.sheetId ?? "")).filter(Boolean)));
  const sheets: any[] = sheetIds.length
    ? await Scanner.findAll({ where: { sheetId: { [Op.in]: sheetIds } }, attributes: { exclude: ["fileBuffer"] } })
    : [];
  const sheetById = new Map(sheets.map((s) => [s.sheetId, s]));
  // Evaluations of another institute's sheets are never returned.
  const sameInstitute = (row: any) => {
    const sheet = sheetById.get(String(row?.sheetId ?? ""));
    return Boolean(sheet) && (!user?.instituteId || sheet.instituteId === user.instituteId);
  };
  if (!isTeacherRequester(user)) return rows.filter(sameInstitute);

  const scope = await getTeacherScope(user);
  return rows.filter(sameInstitute).flatMap((row) => {
    const sheet = sheetById.get(String(row.sheetId));
    const access = accessForSheet(scope, sheet);
    if (access === "none") return [];
    return [access === "masked" ? maskEvaluationIdentity(row, sheet) : row];
  });
}

/** A student list entry with every identifying field hidden (roll number too, unless keepRoll). */
export function maskStudentRecord(s: any, options: { keepRoll?: boolean } = {}) {
  return {
    ...s,
    userId: maskId(s.userId),
    userName: maskName(s.userName),
    rollNumber: options.keepRoll || !s.rollNumber ? s.rollNumber : maskRoll(s.rollNumber),
    emailId: s.emailId ? "****" : s.emailId,
    phoneNumber: s.phoneNumber ? "****" : s.phoneNumber,
    fatherName: s.fatherName ? maskName(s.fatherName) : s.fatherName,
    dob: null,
    aadhar: null,
    address: null,
    profileUrl: null,
    identityMasked: true,
  };
}
