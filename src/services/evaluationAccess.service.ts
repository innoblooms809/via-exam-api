// Who may see which student answer sheets, and whether names are masked.
//
//   Admin / super admin / scanner / examiner  → everything, real names, may evaluate
//   Teacher who teaches the subject of that class (Subject.teacherId)  → view only, real names
//   Teacher assigned by the admin to evaluate the exam  → names masked ("R**** S*****", roll "1**"), may evaluate
//   Any other teacher (e.g. only set the question paper)  → no access
//
// Running AI evaluation or changing marks is allowed only for the assigned evaluator
// (and admins): an exam nobody is assigned to cannot be evaluated by a teacher.
//
// Masking is applied here, on the server, so a masked teacher's browser never
// receives the real name or roll number.

import { Op } from "sequelize";
import httpStatus from "http-status";
import Subject from "../modals/Subject.modal";
import Class from "../modals/Class.modal";
import Exam from "../modals/Exam.modal";
import Scanner from "../modals/Scanner.modal";
import EvaluationAssignment from "../modals/EvaluationAssignment.modal";
import ApiError from "../utils/ApiError";

export type SheetAccess = "full" | "masked" | "none";

export const isTeacherRequester = (user: any): boolean =>
  String(user?.role?.role ?? user?.role ?? "").toUpperCase().includes("TEACH");

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
}

export async function getTeacherScope(user: any): Promise<TeacherScope> {
  const userId = String(user?.userId ?? "");
  const instituteId = String(user?.instituteId ?? "");

  const [subjects, assignments] = await Promise.all([
    Subject.findAll({
      where: { instituteId, teacherId: userId, isDeleted: false },
      attributes: ["subjectId", "classId"],
      include: [{ model: Class, as: "class", attributes: ["classId", "className"], required: false }],
    }),
    EvaluationAssignment.findAll({
      where: { instituteId, teacherId: userId, isActive: true },
      attributes: ["examId"],
    }),
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
    assignedExams: exams.map((e: any) => ({
      examId: String(e.examId),
      subjectId: String(e.subjectId),
      examType: String(e.examType),
      classKeys: new Set([e.classId, e.class?.className].filter(Boolean).map(String)),
    })),
  };
}

type SheetLike = { subjectId?: unknown; classId?: unknown; examType?: unknown; examId?: unknown };

export function accessForSheet(scope: TeacherScope, sheet: SheetLike): SheetAccess {
  if (scope.ownSubjectIds.has(String(sheet.subjectId ?? ""))) return "full";
  const assigned = scope.assignedExams.some(
    (a) =>
      (sheet.examId && a.examId === String(sheet.examId)) ||
      (a.subjectId === String(sheet.subjectId ?? "") &&
        a.examType === String(sheet.examType ?? "") &&
        a.classKeys.has(String(sheet.classId ?? "")))
  );
  return assigned ? "masked" : "none";
}

/** Is this teacher the admin-assigned evaluator of the sheet's exam? */
export function isAssignedEvaluator(scope: TeacherScope, sheet: SheetLike): boolean {
  return scope.assignedExams.some(
    (a) =>
      (sheet.examId && a.examId === String(sheet.examId)) ||
      (a.subjectId === String(sheet.subjectId ?? "") &&
        a.examType === String(sheet.examType ?? "") &&
        a.classKeys.has(String(sheet.classId ?? "")))
  );
}

export function accessForExam(scope: TeacherScope, exam: { examId: string; subjectId: string }): SheetAccess {
  if (scope.ownSubjectIds.has(String(exam.subjectId))) return "full";
  return scope.assignedExams.some((a) => a.examId === exam.examId) ? "masked" : "none";
}

/** Masks the identity fields of one sheet row (plain object). */
export function maskSheetRow<T extends Record<string, any>>(row: T): T {
  return {
    ...row,
    rollNo: maskRoll(row.rollNo),
    studentName: row.studentName ? maskName(row.studentName) : row.studentName,
    // Uploaded file names often carry the roll number or name.
    fileName: row.fileName ? `answer-sheet${fileExtension(row.fileName)}` : row.fileName,
    identityMasked: true,
  };
}

/** Filters a sheet list to what the requester may see, masking where needed. */
export async function scopeSheetRows<T extends Record<string, any>>(user: any, rows: T[]): Promise<T[]> {
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
  if (!isTeacherRequester(user)) return { access: "full", sheet, canEvaluate: true };

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

/** A student list entry with every identifying field hidden. */
export function maskStudentRecord(s: any) {
  return {
    ...s,
    userId: maskId(s.userId),
    userName: maskName(s.userName),
    rollNumber: s.rollNumber ? maskRoll(s.rollNumber) : s.rollNumber,
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
