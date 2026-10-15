/**
 * The exam workflow after the question paper is approved:
 *
 *   admin assigns a SCANNER ─► scanner uploads sheets / marks ABSENT ─► scanner completes (100%)
 *   admin assigns an EVALUATOR (in parallel) ─► evaluator evaluates 100% ─► marks reviewed
 *   admin PUBLISHES results ─► students see them ─► a student may ask for ONE recheck
 *   admin assigns the recheck (same evaluator or another teacher) ─► teacher completes it
 *
 * Every multi-row change runs in one transaction and locks the row it decides
 * on (SELECT … FOR UPDATE), so two admins clicking at once can't publish twice
 * or leave two active scanners. Notifications are written in the same
 * transaction; their push is sent after commit (see Notification.afterCreate).
 */

import { gradeOn, settingsOf } from "../academic/instituteSettings.service";
import type { GradeBand } from "../../models/InstituteSettings.model";
import { logMarksChange } from "../academic/marks.service";
import { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import httpStatus from "http-status";
import { Op, Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import RecheckRequest from "../../models/RecheckRequest.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import Subject from "../../models/Subject.model";
import ExamScannerAssignment, { SCAN_STATUS } from "../../models/ExamScannerAssignment.model";
import ExamAttendance, { ATTENDANCE_STATUS } from "../../models/ExamAttendance.model";
import StudentResult, { RESULT_STATUS } from "../../models/StudentResult.model";
import ApiError from "../../utils/ApiError";
import { newId } from "../../utils/idGenerator";
import { refreshExamStatus } from "./exam.service";
import { EXAM_INCLUDES, buildRoster, loadExam } from "./examRoster.service";
import { maskName } from "../evaluation/evaluationAccess.service";
import { examLabel, instituteAdminIds, notifyAll, preview } from "../notification/notifyPeople";
import TeacherProfile from "../../models/TeacherProfile.model";
import { specialisesIn } from "../../utils/specialization";
import { subjectTeacherIn } from "../academic/sessionSetup.service";
import { checkExamEvaluated } from "./examProgress";
import { assertCrossCheckDone, crossCheckStates } from "./crossCheck.service";

// ─── Small helpers ───────────────────────────────────────────────────────────

const clean = (v: unknown) => String(v ?? "").trim();
const roleKey = (user: any) => String(user?.role?.role ?? "").toUpperCase().replace(/[\s_-]+/g, "");
const isAdmin = (user: any) => ["ADMIN", "INSTITUTEADMIN", "SUPERADMIN"].includes(roleKey(user));
const round2 = (n: number) => Math.round(n * 100) / 100;

export const PAPER_APPROVED_STATUSES = ["Approved", "Live", "Completed"];

const paging = (query: any, defaultLimit = 10) => {
  const page = Math.max(1, parseInt(String(query?.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query?.limit ?? defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
};
const pageInfo = (total: number, page: number, limit: number) => ({ total, page, limit, totalPages: Math.ceil(total / limit) });

const requireExam = async (instituteId: string, examId: string) => {
  const exam = await loadExam(instituteId, examId);
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
  return exam;
};

/** The paper must be approved before sheets can be scanned or evaluated. */
const isPaperApproved = async (exam: any) => {
  if (PAPER_APPROVED_STATUSES.includes(exam.status)) return true;
  const refreshed = await refreshExamStatus(exam.examId);
  return Boolean(refreshed && PAPER_APPROVED_STATUSES.includes(refreshed));
};

const publishedCount = (examId: string, transaction?: Transaction) =>
  StudentResult.count({ where: { examId, isDeleted: false }, transaction });

const activeScanner = (examId: string, transaction?: Transaction, lock = false) =>
  ExamScannerAssignment.findOne({ where: { examId, isActive: true }, transaction, ...(lock ? { lock: Transaction.LOCK.UPDATE } : {}) });

const activeEvaluator = (examId: string, transaction?: Transaction) =>
  EvaluationAssignment.findOne({ where: { examId, isActive: true }, transaction });

// ─── Stage of an exam (one word for lists and badges) ────────────────────────

export type ExamStage =
  | "PAPER_PENDING"
  | "READY_TO_SCAN"
  | "SCANNING"
  | "EVALUATING"
  | "CROSS_CHECK"
  | "REVIEWED"
  | "PUBLISHED";

const stageOf = (args: {
  paperApproved: boolean;
  scanner: ExamScannerAssignment | null;
  evaluator: EvaluationAssignment | null;
  published: boolean;
  scanDone: boolean;
  /** The school cross-checks, and this exam's cross-check isn't done. */
  crossCheckWaiting?: boolean;
}): ExamStage => {
  if (args.published) return "PUBLISHED";
  if (!args.paperApproved) return "PAPER_PENDING";
  if (args.evaluator?.reviewedAt) return args.crossCheckWaiting ? "CROSS_CHECK" : "REVIEWED";
  if (args.scanDone) return "EVALUATING";
  if (args.scanner) return "SCANNING";
  return "READY_TO_SCAN";
};

/** Whether scanning is finished: the assigned scanner completed it, or — for exams
 *  without a scanner assignment — every student already has a sheet or is absent. */
const scanFinished = (scanner: ExamScannerAssignment | null, pending: number, total: number) =>
  scanner ? scanner.status === SCAN_STATUS.COMPLETED : total > 0 && pending === 0;

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — pipeline overview
// ═════════════════════════════════════════════════════════════════════════════

/** One page of the institute's exams with where each one is in the workflow. */
const listPipeline = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const { page, limit, offset } = paging(query, 10);
  const where: any = { instituteId, isDeleted: false };
  if (clean(query?.examType)) where.examType = clean(query.examType);
  if (clean(query?.sessionId)) where.sessionId = clean(query.sessionId);
  if (clean(query?.classId)) where.classId = clean(query.classId);

  const search = clean(query?.search);
  const include: any[] = EXAM_INCLUDES.map((inc) => ({ ...inc }));
  if (search) {
    const like = { [Op.iLike]: `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` };
    where[Op.or] = [
      { examType: like },
      { "$subject.subjectName$": like },
      { "$class.className$": like },
    ];
  }

  const { rows: exams, count } = await Exam.findAndCountAll({
    where,
    include,
    order: [["createdAt", "DESC"]],
    limit,
    offset,
    distinct: true,
    subQuery: false,
  });

  const examIds = exams.map((e) => e.examId);
  const [scanners, evaluators, published] = examIds.length
    ? await Promise.all([
        ExamScannerAssignment.findAll({ where: { examId: { [Op.in]: examIds }, isActive: true } }),
        EvaluationAssignment.findAll({ where: { examId: { [Op.in]: examIds }, isActive: true } }),
        StudentResult.findAll({
          where: { examId: { [Op.in]: examIds }, isDeleted: false },
          attributes: ["examId", [sequelize.fn("MIN", sequelize.col("publishedAt")), "publishedAt"]],
          group: ["examId"],
          raw: true,
        }) as unknown as Promise<{ examId: string; publishedAt: Date }[]>,
      ])
    : [[], [], []];
  const scannerByExam = new Map(scanners.map((s) => [s.examId, s]));
  const evaluatorByExam = new Map(evaluators.map((e) => [e.examId, e]));
  const publishedByExam = new Map(published.map((p) => [p.examId, p.publishedAt]));
  const crossCheck = await crossCheckStates(instituteId, examIds);

  const people = Array.from(new Set([...scanners.map((s) => s.scannerId), ...evaluators.map((e) => e.teacherId)]));
  const names = people.length
    ? new Map((await UserModal.findAll({ where: { userId: { [Op.in]: people } }, attributes: ["userId", "userName"] })).map((u) => [u.userId, u.userName]))
    : new Map<string, string>();

  const rows = await Promise.all(
    exams.map(async (exam: any) => {
      const roster = await buildRoster(exam);
      const scanner = scannerByExam.get(exam.examId) ?? null;
      const evaluator = evaluatorByExam.get(exam.examId) ?? null;
      const paperApproved = PAPER_APPROVED_STATUSES.includes(exam.status);
      const publishedAt = publishedByExam.get(exam.examId) ?? null;
      const scanDone = scanFinished(scanner, roster.counts.pending, roster.counts.total);
      const check = crossCheck.byExam.get(exam.examId);
      const crossCheckWaiting = crossCheck.required && Boolean(evaluator?.reviewedAt) && !publishedAt && (!check || check.pending > 0);
      return {
        examId: exam.examId,
        examType: exam.examType,
        examDate: exam.examDate,
        examTime: exam.examTime ?? null,
        status: exam.status,
        sessionId: exam.sessionId,
        classId: exam.classId,
        sectionId: exam.sectionId ?? null,
        subjectId: exam.subjectId,
        teacherId: exam.teacherId,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        duration: exam.duration ?? null,
        instructions: exam.instructions ?? null,
        className: exam.class?.className ?? "",
        sectionName: exam.section?.sectionName ?? "",
        subjectName: exam.subject?.subjectName ?? "",
        sessionName: exam.session?.sessionName ?? "",
        paperSetter: exam.teacher?.userName ?? "",
        stage: stageOf({ paperApproved, scanner, evaluator, published: Boolean(publishedAt), scanDone, crossCheckWaiting }),
        // The school cross-checks: this exam's round (null until it starts).
        crossCheck: crossCheck.required
          ? { started: Boolean(check), total: check?.total ?? 0, pending: check?.pending ?? 0, changed: check?.changed ?? 0, checkerId: check?.checkerId ?? null }
          : null,
        counts: roster.counts,
        scanner: scanner
          ? { scannerId: scanner.scannerId, name: names.get(scanner.scannerId) ?? "", status: scanner.status, assignedAt: scanner.createdAt, completedAt: scanner.completedAt }
          : null,
        evaluator: evaluator
          ? { teacherId: evaluator.teacherId, name: names.get(evaluator.teacherId) ?? "", assignedAt: evaluator.createdAt, reviewedAt: evaluator.reviewedAt }
          : null,
        publishedAt,
        createdAt: exam.createdAt,
      };
    })
  );

  return { exams: rows, pagination: pageInfo(count, page, limit) };
};

/** Every step of one exam with its timestamp — the "process time" view. */
const getTimeline = async (user: any, examId: string) => {
  const exam = await requireExam(user.instituteId, examId);
  const [papers, scanners, evaluators, firstResult, rechecks] = await Promise.all([
    QuestionPaper.findAll({ where: { examId: exam.examId }, attributes: ["paperSet", "status", "submittedAt", "approvedAt", "createdAt"] }),
    ExamScannerAssignment.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
    EvaluationAssignment.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
    StudentResult.findOne({ where: { examId: exam.examId, isDeleted: false }, order: [["publishedAt", "ASC"]] }),
    RecheckRequest.count({ where: { examId: exam.examId } }),
  ]);
  const roster = await buildRoster(exam);
  const first = (dates: (Date | null | undefined)[]) =>
    dates.filter(Boolean).sort((a, b) => new Date(a as Date).getTime() - new Date(b as Date).getTime())[0] ?? null;
  const activeScan = scanners.find((s) => s.isActive) ?? null;
  const activeEval = evaluators.find((e) => e.isActive) ?? null;

  const steps = [
    { key: "CREATED", label: "Exam created and assigned to the subject teacher", at: exam.createdAt },
    { key: "PAPER_SUBMITTED", label: "Question paper and model answer submitted", at: first(papers.map((p) => p.submittedAt)) },
    { key: "PAPER_APPROVED", label: "Approved by admin", at: first(papers.map((p) => p.approvedAt)) },
    { key: "SCANNER_ASSIGNED", label: "Scanner assigned", at: activeScan?.createdAt ?? null },
    { key: "SCAN_COMPLETED", label: "All answer sheets uploaded / absentees marked", at: activeScan?.completedAt ?? null },
    { key: "EVALUATOR_ASSIGNED", label: "Evaluator assigned", at: activeEval?.createdAt ?? null },
    { key: "EVALUATION_REVIEWED", label: "Evaluation completed and reviewed", at: activeEval?.reviewedAt ?? null },
    { key: "RESULTS_PUBLISHED", label: "Results published to students", at: firstResult?.publishedAt ?? null },
  ];
  return {
    examId: exam.examId,
    label: examLabel(exam),
    status: exam.status,
    counts: roster.counts,
    rechecks,
    steps,
    history: {
      scanners: scanners.map((s) => ({ scannerId: s.scannerId, status: s.status, isActive: s.isActive, assignedAt: s.createdAt, completedAt: s.completedAt, unassignedAt: s.unassignedAt })),
      evaluators: evaluators.map((e) => ({ teacherId: e.teacherId, isActive: e.isActive, assignedAt: e.createdAt, reviewedAt: e.reviewedAt, unassignedAt: e.unassignedAt })),
    },
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — scanner assignment
// ═════════════════════════════════════════════════════════════════════════════

/** Active scanner accounts of the institute, with how many exams each is scanning. */
const listScanners = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const exam = await requireExam(instituteId, examId);
  const scannerRole = await Role.findOne({ where: { role: "SCANNER" }, attributes: ["id"] });
  const [scanners, load, current] = await Promise.all([
    scannerRole
      ? UserModal.findAll({
          where: { instituteId, roleId: scannerRole.id, status: 1, isDeleted: false },
          attributes: ["userId", "userName", "emailId"],
          order: [["userName", "ASC"]],
        })
      : [],
    ExamScannerAssignment.findAll({
      where: { instituteId, isActive: true, status: SCAN_STATUS.ASSIGNED },
      attributes: ["scannerId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      group: ["scannerId"],
      raw: true,
    }) as unknown as Promise<{ scannerId: string; count: string }[]>,
    activeScanner(exam.examId),
  ]);
  const loadById = new Map(load.map((l) => [l.scannerId, Number(l.count) || 0]));
  return {
    exam: { examId: exam.examId, label: examLabel(exam) },
    current: current ? { scannerId: current.scannerId, status: current.status, assignedAt: current.createdAt } : null,
    scanners: (scanners as any[])
      .map((s) => ({
        userId: s.userId,
        userName: s.userName,
        emailId: s.emailId,
        openExams: loadById.get(s.userId) ?? 0,
        isCurrent: current?.scannerId === s.userId,
      }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.openExams - b.openExams || a.userName.localeCompare(b.userName)),
  };
};

/**
 * Gives the exam's sheet upload to a scanner. Assigning the same scanner again
 * re-opens a completed scan (e.g. a late sheet turned up).
 */
const assignScanner = async (admin: any, examId: string, body: any) => {
  const instituteId = admin.instituteId;
  const scannerId = clean(body?.scannerId);
  const note = clean(body?.note).slice(0, 500) || null;
  if (!scannerId) throw new ApiError(httpStatus.BAD_REQUEST, "Choose a scanner.");

  const exam = await requireExam(instituteId, examId);
  if (!(await isPaperApproved(exam))) {
    throw new ApiError(httpStatus.BAD_REQUEST, "The question paper must be approved before answer sheets can be scanned.");
  }
  const scannerRole = await Role.findOne({ where: { role: "SCANNER" }, attributes: ["id"] });
  const scanner = await UserModal.findOne({
    where: { userId: scannerId, instituteId, roleId: scannerRole?.id ?? -1, status: 1, isDeleted: false },
    attributes: ["userId", "userName"],
  });
  if (!scanner) throw new ApiError(httpStatus.BAD_REQUEST, "That scanner account is not active in your institute.");

  let previousScannerId: string | null = null;
  let reopened = false;
  const result = await sequelize.transaction(async (t) => {
    // Lock the exam row so publish / assign can't interleave.
    await Exam.findOne({ where: { examId: exam.examId }, transaction: t, lock: t.LOCK.UPDATE });
    if (await publishedCount(exam.examId, t)) {
      throw new ApiError(httpStatus.CONFLICT, "Results of this exam are already published. Unpublish them first.");
    }
    const previous = await activeScanner(exam.examId, t, true);
    if (previous?.scannerId === scannerId) {
      reopened = previous.status === SCAN_STATUS.COMPLETED;
      await previous.update(
        { note, assignedBy: admin.userId, status: SCAN_STATUS.ASSIGNED, completedAt: null, completedBy: null },
        { transaction: t }
      );
      return previous;
    }
    if (previous) {
      previousScannerId = previous.scannerId;
      await previous.update({ isActive: false, unassignedAt: new Date() }, { transaction: t });
    }
    const created = await ExamScannerAssignment.create(
      { assignmentId: newId("scannerAssignment"), instituteId, examId: exam.examId, scannerId, assignedBy: admin.userId, note },
      { transaction: t }
    );

    const label = examLabel(exam);
    await notifyAll(
      [
        {
          instituteId,
          userId: scannerId,
          type: "SCAN_ASSIGNED",
          title: "Answer sheets to upload",
          message: `Upload the answer sheets of ${label}. Mark students without a sheet as absent, then mark the upload complete.`,
          referenceId: exam.examId,
        },
        ...(previousScannerId
          ? [{ instituteId, userId: previousScannerId, type: "SCAN_UNASSIGNED", title: "Scanning reassigned", message: `Uploading for ${label} was given to another scanner.`, referenceId: exam.examId }]
          : []),
      ],
      t
    );
    return created;
  });

  if (reopened) {
    await notifyAll([
      { instituteId, userId: scannerId, type: "SCAN_REOPENED", title: "Upload re-opened", message: `The admin re-opened uploading for ${examLabel(exam)}.`, referenceId: exam.examId },
    ]);
  }
  return { examId: exam.examId, scannerId: result.scannerId, status: result.status, assignedAt: result.createdAt };
};

const unassignScanner = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const exam = await requireExam(instituteId, examId);
  const scannerId = await sequelize.transaction(async (t) => {
    const active = await activeScanner(exam.examId, t, true);
    if (!active) throw new ApiError(httpStatus.NOT_FOUND, "No scanner is assigned to this exam.");
    await active.update({ isActive: false, unassignedAt: new Date() }, { transaction: t });
    await notifyAll(
      [{ instituteId, userId: active.scannerId, type: "SCAN_UNASSIGNED", title: "Scanning unassigned", message: `You no longer upload sheets for ${examLabel(exam)}.`, referenceId: exam.examId }],
      t
    );
    return active.scannerId;
  });
  return { examId: exam.examId, scannerId };
};

// ═════════════════════════════════════════════════════════════════════════════
// SCANNER — assigned exams, roster, absentees, completion
// ═════════════════════════════════════════════════════════════════════════════

/** The scanner's own active assignments (admins see every active one). */
const myScanExams = async (user: any, query: any) => {
  const instituteId = user.instituteId;
  const { page, limit, offset } = paging(query, 10);
  const where: any = { instituteId, isActive: true };
  if (!isAdmin(user)) where.scannerId = user.userId;
  const status = clean(query?.status).toUpperCase();
  if (status === SCAN_STATUS.ASSIGNED || status === SCAN_STATUS.COMPLETED) where.status = status;

  const { rows, count } = await ExamScannerAssignment.findAndCountAll({ where, order: [["status", "DESC"], ["createdAt", "DESC"]], limit, offset });
  const exams = rows.length
    ? await Exam.findAll({ where: { examId: { [Op.in]: rows.map((r) => r.examId) }, isDeleted: false }, include: EXAM_INCLUDES })
    : [];
  const examById = new Map(exams.map((e: any) => [e.examId, e]));

  const items = await Promise.all(
    rows.map(async (a) => {
      const exam: any = examById.get(a.examId);
      if (!exam) return null;
      const roster = await buildRoster(exam);
      return {
        examId: exam.examId,
        label: examLabel(exam),
        examType: exam.examType,
        examDate: exam.examDate,
        classId: exam.classId,
        className: exam.class?.className ?? "",
        sectionId: exam.sectionId,
        sectionName: exam.section?.sectionName ?? "",
        subjectId: exam.subjectId,
        subjectName: exam.subject?.subjectName ?? "",
        sessionName: exam.session?.sessionName ?? "",
        totalMarks: exam.totalMarks,
        scanStatus: a.status,
        assignedAt: a.createdAt,
        completedAt: a.completedAt,
        note: a.note,
        counts: roster.counts,
      };
    })
  );
  return { exams: items.filter(Boolean), pagination: pageInfo(count, page, limit) };
};

/** The scanner (or an admin) may work on this exam's sheets. */
const requireScanAccess = async (user: any, examId: string, { forWrite }: { forWrite: boolean }) => {
  const exam = await requireExam(user.instituteId, examId);
  const assignment = await activeScanner(exam.examId);
  if (!isAdmin(user)) {
    if (!assignment || assignment.scannerId !== user.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, "This exam is not assigned to you for scanning.");
    }
  }
  if (forWrite) {
    if (assignment?.status === SCAN_STATUS.COMPLETED) {
      throw new ApiError(httpStatus.CONFLICT, "Uploading for this exam is marked complete. Ask the admin to re-open it.");
    }
    if (await publishedCount(exam.examId)) {
      throw new ApiError(httpStatus.CONFLICT, "Results of this exam are already published.");
    }
  }
  return { exam, assignment };
};

const scanRoster = async (user: any, examId: string) => {
  const { exam, assignment } = await requireScanAccess(user, examId, { forWrite: false });
  const roster = await buildRoster(exam);
  return {
    exam: {
      examId: exam.examId,
      label: examLabel(exam),
      classId: exam.classId,
      className: exam.class?.className ?? "",
      sectionId: exam.sectionId,
      sectionName: exam.section?.sectionName ?? "",
      subjectId: exam.subjectId,
      subjectName: exam.subject?.subjectName ?? "",
      examType: exam.examType,
      sessionName: exam.session?.sessionName ?? "",
      scanStatus: assignment?.status ?? null,
      completedAt: assignment?.completedAt ?? null,
    },
    rows: roster.rows.map((r) => ({
      studentId: r.studentId,
      name: r.name,
      rollNo: r.rollNo,
      state: r.state,
      sheetId: r.sheetId,
      fileName: r.fileName,
      uploadedAt: r.uploadedAt,
      absentMarkedAt: r.absentMarkedAt,
      // Marks are for the admin; the scanner only needs to know a sheet is in.
      ...(isAdmin(user) ? { evaluationId: r.evaluationId, evaluationStatus: r.evaluationStatus, score: r.score } : {}),
    })),
    counts: roster.counts,
  };
};

/** Marks (absent=true) or un-marks students as absent. Students with a sheet can't be absent. */
const setAttendance = async (user: any, examId: string, body: any) => {
  const studentIds: string[] = Array.isArray(body?.studentIds) ? body.studentIds.map(clean).filter(Boolean) : [];
  const absent = body?.absent !== false && body?.absent !== "false";
  const note = clean(body?.note).slice(0, 500) || null;
  if (!studentIds.length) throw new ApiError(httpStatus.BAD_REQUEST, "Choose at least one student.");
  if (studentIds.length > 500) throw new ApiError(httpStatus.BAD_REQUEST, "Too many students in one request.");

  const { exam } = await requireScanAccess(user, examId, { forWrite: true });
  const roster = await buildRoster(exam);
  const byStudent = new Map(roster.rows.filter((r) => r.studentId).map((r) => [r.studentId as string, r]));

  const unknown = studentIds.filter((id) => !byStudent.has(id));
  if (unknown.length) throw new ApiError(httpStatus.BAD_REQUEST, `${unknown.length} of the chosen students don't sit this exam.`);
  const withSheet = studentIds.filter((id) => byStudent.get(id)?.state === "UPLOADED");
  if (absent && withSheet.length) {
    const rolls = withSheet.map((id) => byStudent.get(id)?.rollNo).join(", ");
    throw new ApiError(httpStatus.CONFLICT, `Roll ${rolls} already ${withSheet.length === 1 ? "has" : "have"} an uploaded sheet, so can't be marked absent.`);
  }

  const status = absent ? ATTENDANCE_STATUS.ABSENT : ATTENDANCE_STATUS.PRESENT;
  await sequelize.transaction(async (t) => {
    const existing = await ExamAttendance.findAll({
      where: { examId: exam.examId, studentId: { [Op.in]: studentIds } },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const existingByStudent = new Map(existing.map((e) => [e.studentId, e]));
    for (const studentId of studentIds) {
      const row = existingByStudent.get(studentId);
      if (row) {
        await row.update({ status, markedBy: user.userId, note }, { transaction: t });
      } else if (absent) {
        await ExamAttendance.create(
          {
            attendanceId: newId("attendance"),
            instituteId: exam.instituteId,
            examId: exam.examId,
            studentId,
            rollNo: byStudent.get(studentId)?.rollNo ?? "",
            status,
            markedBy: user.userId,
            note,
          },
          { transaction: t }
        );
      }
    }
  });

  return { examId: exam.examId, updated: studentIds.length, absent, counts: (await buildRoster(exam)).counts };
};

/** Scanner marks the upload done; allowed only when every student has a sheet or is absent. */
const completeScan = async (user: any, examId: string) => {
  const { exam } = await requireScanAccess(user, examId, { forWrite: true });
  const roster = await buildRoster(exam);
  if (roster.counts.total === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "This exam has no students and no uploaded sheets yet.");
  }
  if (roster.counts.pending > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `${roster.counts.pending} student${roster.counts.pending === 1 ? " has" : "s have"} neither a sheet nor an absent mark. Upload or mark them first.`
    );
  }

  const evaluator = await activeEvaluator(exam.examId);
  const completedAt = new Date();
  await sequelize.transaction(async (t) => {
    const assignment = await activeScanner(exam.examId, t, true);
    if (!assignment) throw new ApiError(httpStatus.CONFLICT, "No scanner is assigned to this exam.");
    if (assignment.status === SCAN_STATUS.COMPLETED) throw new ApiError(httpStatus.CONFLICT, "Uploading is already marked complete.");
    await assignment.update({ status: SCAN_STATUS.COMPLETED, completedAt, completedBy: user.userId }, { transaction: t });

    const label = examLabel(exam);
    const summary = `${roster.counts.uploaded} sheet${roster.counts.uploaded === 1 ? "" : "s"}, ${roster.counts.absent} absent`;
    const adminIds = [assignment.assignedBy, ...(await instituteAdminIds(exam.instituteId, t))];
    await notifyAll(
      [
        ...Array.from(new Set(adminIds)).map((userId) => ({
          instituteId: exam.instituteId,
          userId,
          type: "SCAN_COMPLETED",
          title: "Answer sheets uploaded",
          message: `Uploading for ${label} is complete (${summary}).`,
          referenceId: exam.examId,
        })),
        ...(evaluator
          ? [{ instituteId: exam.instituteId, userId: evaluator.teacherId, type: "SCAN_COMPLETED", title: "Sheets ready to evaluate", message: `All answer sheets of ${label} are uploaded (${summary}).`, referenceId: exam.examId }]
          : []),
      ],
      t
    );
  });
  // Sheets may all have their marks already (marked as they arrived): then that's 100% evaluated too.
  void checkExamEvaluated(exam.examId).catch(() => undefined);
  return { examId: exam.examId, scanStatus: SCAN_STATUS.COMPLETED, completedAt, counts: roster.counts };
};

/**
 * Called by the upload paths before a sheet of this exam is added, replaced or
 * deleted: only the assigned scanner (or an admin) may, and not once the scan
 * is complete or results are out. Exams without a scanner assignment keep the
 * old behaviour (any uploader of the institute).
 */
export const assertSheetWritable = async (user: any, examId: string | null | undefined) => {
  if (!examId) return;
  const exam = await Exam.findOne({ where: { examId, instituteId: user.instituteId, isDeleted: false }, attributes: ["examId", "status"] });
  if (!exam) return;
  // Students write the paper only after it is approved, so there is nothing to scan before.
  if (!(await isPaperApproved(exam))) {
    throw new ApiError(httpStatus.CONFLICT, "The question paper of this exam isn't approved yet, so answer sheets can't be uploaded.");
  }
  const assignment = await activeScanner(exam.examId);
  if (assignment) {
    if (!isAdmin(user) && assignment.scannerId !== user.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, "This exam is assigned to another scanner.");
    }
    if (assignment.status === SCAN_STATUS.COMPLETED) {
      throw new ApiError(httpStatus.CONFLICT, "Uploading for this exam is marked complete. Ask the admin to re-open it.");
    }
  } else if (!isAdmin(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, "This exam isn't assigned to you. Ask the admin to assign it to you under Exam Workflow.");
  }
  if (await publishedCount(exam.examId)) {
    throw new ApiError(httpStatus.CONFLICT, "Results of this exam are already published, so its sheets can't change.");
  }
};

/** A sheet arriving for a student marked absent proves they sat the exam. */
export const clearAbsentForRoll = async (examId: string | null | undefined, rollNo: string, userId: string) => {
  if (!examId || !rollNo) return;
  await ExamAttendance.update(
    { status: ATTENDANCE_STATUS.PRESENT, markedBy: userId },
    { where: { examId, rollNo: clean(rollNo), status: ATTENDANCE_STATUS.ABSENT } }
  ).catch(() => undefined);
};

// ═════════════════════════════════════════════════════════════════════════════
// EVALUATOR — the "100% evaluated" rule used when marking reviewed
// ═════════════════════════════════════════════════════════════════════════════

/** Throws unless scanning is finished and every uploaded sheet is evaluated. */
export const assertReadyForReview = async (instituteId: string, examId: string) => {
  const exam = await requireExam(instituteId, examId);
  const [roster, scanner] = await Promise.all([buildRoster(exam), activeScanner(exam.examId)]);
  const { counts } = roster;
  if (!scanFinished(scanner, counts.pending, counts.total)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      scanner
        ? "The scanner hasn't finished uploading this exam's answer sheets yet."
        : `${counts.pending} student${counts.pending === 1 ? " has" : "s have"} no answer sheet or absent mark yet.`
    );
  }
  if (counts.evaluated < counts.uploaded) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `${counts.uploaded - counts.evaluated} of ${counts.uploaded} answer sheets are not evaluated yet${
        counts.evaluationFailed ? ` (${counts.evaluationFailed} failed — re-run them)` : ""
      }. Evaluate every sheet before marking the exam reviewed.`
    );
  }
  if (await publishedCount(exam.examId)) {
    throw new ApiError(httpStatus.CONFLICT, "Results of this exam are already published.");
  }
  return { exam, counts };
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — publish / unpublish results
// ═════════════════════════════════════════════════════════════════════════════

/** A student's result from their marks; the grade comes from the school's bands (Marks & grading). */
const resultFor = (marks: number | null, totalMarks: number, passingMarks: number, scale: GradeBand[]) => {
  if (marks == null) return { percentage: null, grade: null, resultStatus: RESULT_STATUS.NOT_EVALUATED };
  const bounded = Math.max(0, Math.min(Number(marks), totalMarks));
  const percentage = totalMarks > 0 ? round2((bounded / totalMarks) * 100) : 0;
  return {
    marksObtained: round2(bounded),
    percentage,
    grade: gradeOn(scale, percentage),
    resultStatus: bounded >= passingMarks ? RESULT_STATUS.PASS : RESULT_STATUS.FAIL,
  };
};

const publishResults = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const exam = await requireExam(instituteId, examId);
  const evaluator = await activeEvaluator(exam.examId);
  if (!evaluator) throw new ApiError(httpStatus.CONFLICT, "Assign an evaluator first.");
  if (!evaluator.reviewedAt) throw new ApiError(httpStatus.CONFLICT, "The evaluator hasn't marked this exam as reviewed yet.");
  await assertCrossCheckDone(exam);

  const roster = await buildRoster(exam);
  const scanner = await activeScanner(exam.examId);
  if (!scanFinished(scanner, roster.counts.pending, roster.counts.total)) {
    throw new ApiError(httpStatus.CONFLICT, "Answer sheet upload isn't complete for this exam.");
  }
  const students = roster.rows.filter((r) => r.studentId);
  const notEvaluated = students.filter((r) => r.state === "UPLOADED" && r.evaluationStatus !== "Success");
  if (notEvaluated.length) {
    throw new ApiError(httpStatus.CONFLICT, `${notEvaluated.length} uploaded sheet${notEvaluated.length === 1 ? " is" : "s are"} not evaluated.`);
  }
  if (!students.length) throw new ApiError(httpStatus.BAD_REQUEST, "No enrolled students to publish results for.");

  const publishedAt = new Date();
  const { gradingScale } = await settingsOf(instituteId);
  const summary = await sequelize.transaction(async (t) => {
    await Exam.findOne({ where: { examId: exam.examId }, transaction: t, lock: t.LOCK.UPDATE });
    if (await publishedCount(exam.examId, t)) {
      throw new ApiError(httpStatus.CONFLICT, "Results of this exam are already published.");
    }

    const rows = students.map((r) => {
      const base = {
        resultId: newId("result"),
        instituteId,
        examId: exam.examId,
        studentId: r.studentId as string,
        rollNo: r.rollNo,
        classId: exam.classId,
        sectionId: exam.sectionId,
        sessionId: exam.sessionId,
        subjectId: exam.subjectId,
        examType: exam.examType,
        sheetId: r.sheetId,
        evaluationId: r.evaluationId,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        publishedAt,
        publishedBy: admin.userId,
      };
      if (r.state !== "UPLOADED") {
        return { ...base, marksObtained: null, percentage: null, grade: null, resultStatus: RESULT_STATUS.ABSENT };
      }
      return { ...base, ...resultFor(r.score, exam.totalMarks, exam.passingMarks, gradingScale) };
    });
    await StudentResult.bulkCreate(rows as any[], { transaction: t });
    await Exam.update({ status: "Completed" }, { where: { examId: exam.examId }, transaction: t });

    const label = examLabel(exam);
    await notifyAll(
      [
        ...rows.map((r) => ({
          instituteId,
          userId: r.studentId,
          type: "RESULT_PUBLISHED",
          title: "Result published",
          message: `Your result for ${label} is out.`,
          referenceId: exam.examId,
        })),
        { instituteId, userId: evaluator.teacherId, type: "RESULT_PUBLISHED", title: "Results published", message: `Results of ${label} were published.`, referenceId: exam.examId },
        { instituteId, userId: exam.teacherId, type: "RESULT_PUBLISHED", title: "Results published", message: `Results of ${label} were published.`, referenceId: exam.examId },
      ],
      t
    );

    return {
      published: rows.length,
      passed: rows.filter((r: any) => r.resultStatus === RESULT_STATUS.PASS).length,
      failed: rows.filter((r: any) => r.resultStatus === RESULT_STATUS.FAIL).length,
      absent: rows.filter((r: any) => r.resultStatus === RESULT_STATUS.ABSENT).length,
    };
  });

  return { examId: exam.examId, publishedAt, ...summary };
};

/** Withdraws published results (kept as soft-deleted rows). Not while a recheck is open. */
const unpublishResults = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const exam = await requireExam(instituteId, examId);
  const openRechecks = await RecheckRequest.count({ where: { examId: exam.examId, status: { [Op.in]: ["Pending", "Under Review"] } } });
  if (openRechecks) throw new ApiError(httpStatus.CONFLICT, `Resolve the ${openRechecks} open recheck request${openRechecks === 1 ? "" : "s"} first.`);

  const withdrawn = await sequelize.transaction(async (t) => {
    await Exam.findOne({ where: { examId: exam.examId }, transaction: t, lock: t.LOCK.UPDATE });
    const [count] = await StudentResult.update({ isDeleted: true }, { where: { examId: exam.examId, isDeleted: false }, transaction: t });
    if (!count) throw new ApiError(httpStatus.NOT_FOUND, "Results of this exam are not published.");
    await Exam.update({ status: "Approved" }, { where: { examId: exam.examId }, transaction: t });
    return count;
  });
  return { examId: exam.examId, withdrawn };
};

// ═════════════════════════════════════════════════════════════════════════════
// RESULTS — admin tables and the student's own results
// ═════════════════════════════════════════════════════════════════════════════

const toResultRow = (r: any, rank: number | null) => ({
  resultId: r.resultId,
  examId: r.examId,
  studentId: r.studentId,
  studentName: r.student?.userName ?? "",
  rollNo: r.rollNo,
  className: r.exam?.class?.className ?? "",
  sectionName: r.exam?.section?.sectionName ?? "",
  subjectName: r.subject?.subjectName ?? r.exam?.subject?.subjectName ?? "",
  sessionName: r.exam?.session?.sessionName ?? "",
  examType: r.examType,
  marksObtained: r.marksObtained == null ? null : Number(r.marksObtained),
  totalMarks: r.totalMarks,
  passingMarks: r.passingMarks,
  percentage: r.percentage == null ? null : Number(r.percentage),
  grade: r.grade,
  resultStatus: r.resultStatus,
  rank,
  publishedAt: r.publishedAt,
  revisedAt: r.revisedAt,
  revisionCount: r.revisionCount,
});

/** Published results across the institute, filterable, paged, with summary stats. */
const listResults = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const { page, limit, offset } = paging(query, 20);
  const where: any = { instituteId, isDeleted: false };
  for (const key of ["examId", "classId", "sectionId", "subjectId", "sessionId", "examType"]) {
    if (clean(query?.[key])) where[key] = clean(query[key]);
  }
  const status = clean(query?.resultStatus).toUpperCase();
  if ((Object.values(RESULT_STATUS) as string[]).includes(status)) where.resultStatus = status;

  const search = clean(query?.search);
  const studentWhere = search
    ? { userName: { [Op.iLike]: `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` } }
    : undefined;
  const include: any[] = [
    { model: UserModal, as: "student", attributes: ["userId", "userName"], required: Boolean(studentWhere), where: studentWhere },
    { model: Subject, as: "subject", attributes: ["subjectName"], required: false },
    { model: Exam, as: "exam", attributes: ["examId"], required: false, include: EXAM_INCLUDES.filter((i) => i.as !== "teacher") },
  ];

  const [{ rows, count }, stats] = await Promise.all([
    StudentResult.findAndCountAll({
      where,
      include,
      order: [["percentage", "DESC NULLS LAST"], ["rollNo", "ASC"]],
      limit,
      offset,
      distinct: true,
    }),
    StudentResult.findAll({
      where,
      include: studentWhere ? [{ model: UserModal, as: "student", attributes: [], where: studentWhere }] : [],
      attributes: [
        [sequelize.fn("COUNT", sequelize.col("StudentResult.id")), "total"],
        [sequelize.literal(`COUNT(*) FILTER (WHERE "StudentResult"."resultStatus" = 'PASS')`), "passed"],
        [sequelize.literal(`COUNT(*) FILTER (WHERE "StudentResult"."resultStatus" = 'FAIL')`), "failed"],
        [sequelize.literal(`COUNT(*) FILTER (WHERE "StudentResult"."resultStatus" = 'ABSENT')`), "absent"],
        [sequelize.fn("AVG", sequelize.col("StudentResult.percentage")), "averagePercentage"],
        [sequelize.fn("MAX", sequelize.col("StudentResult.percentage")), "topPercentage"],
      ],
      raw: true,
    }) as unknown as Promise<any[]>,
  ]);

  const s = stats[0] ?? {};
  return {
    results: rows.map((r, i) => toResultRow(r, where.examId ? offset + i + 1 : null)),
    summary: {
      total: Number(s.total) || 0,
      passed: Number(s.passed) || 0,
      failed: Number(s.failed) || 0,
      absent: Number(s.absent) || 0,
      passRate: Number(s.total) - Number(s.absent) > 0 ? round2((Number(s.passed) / (Number(s.total) - Number(s.absent))) * 100) : 0,
      averagePercentage: s.averagePercentage == null ? null : round2(Number(s.averagePercentage)),
      topPercentage: s.topPercentage == null ? null : round2(Number(s.topPercentage)),
    },
    pagination: pageInfo(count, page, limit),
  };
};

/** A student's own published results, grouped by session and exam type (Mid-Term, Final…). */
const myResults = async (student: any, query: any) => {
  const where: any = { studentId: student.userId, instituteId: student.instituteId, isDeleted: false };
  if (clean(query?.examType)) where.examType = clean(query.examType);
  if (clean(query?.sessionId)) where.sessionId = clean(query.sessionId);

  const rows: any[] = await StudentResult.findAll({
    where,
    include: [
      { model: Subject, as: "subject", attributes: ["subjectName"], required: false },
      { model: Exam, as: "exam", attributes: ["examId", "examDate"], required: false, include: EXAM_INCLUDES.filter((i) => i.as !== "teacher") },
    ],
    order: [["publishedAt", "DESC"]],
    limit: 500,
  });
  const rechecks = rows.length
    ? await RecheckRequest.findAll({
        where: { studentId: student.userId, examId: { [Op.in]: rows.map((r) => r.examId) } },
        attributes: ["requestId", "examId", "status", "createdAt", "completedAt"],
      })
    : [];
  const recheckByExam = new Map(rechecks.map((r) => [r.examId, r]));

  const groups = new Map<string, any>();
  for (const r of rows) {
    const sessionName = r.exam?.session?.sessionName ?? "";
    const key = `${r.sessionId}|${r.examType}`;
    if (!groups.has(key)) groups.set(key, { sessionId: r.sessionId, sessionName, examType: r.examType, subjects: [] as any[] });
    const recheck = recheckByExam.get(r.examId);
    groups.get(key).subjects.push({
      ...toResultRow(r, null),
      examDate: r.exam?.examDate ?? null,
      evaluationId: r.evaluationId,
      recheck: recheck ? { requestId: recheck.requestId, status: recheck.status, requestedAt: recheck.createdAt, completedAt: recheck.completedAt } : null,
      canRequestRecheck: !recheck && r.resultStatus !== RESULT_STATUS.ABSENT && Boolean(r.evaluationId),
    });
  }

  const { gradingScale } = await settingsOf(student.instituteId);
  const summarise = (subjects: any[]) => {
    const sat = subjects.filter((s) => s.resultStatus !== RESULT_STATUS.ABSENT);
    const obtained = sat.reduce((sum, s) => sum + (s.marksObtained ?? 0), 0);
    const total = sat.reduce((sum, s) => sum + (s.totalMarks ?? 0), 0);
    const percentage = total > 0 ? round2((obtained / total) * 100) : null;
    return {
      subjects: subjects.length,
      obtained: round2(obtained),
      total,
      percentage,
      grade: gradeOn(gradingScale, percentage),
      passed: sat.every((s) => s.resultStatus === RESULT_STATUS.PASS) && sat.length > 0,
    };
  };

  return {
    groups: [...groups.values()].map((g) => ({ ...g, summary: summarise(g.subjects) })),
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// RECHECK — one per student per exam
// ═════════════════════════════════════════════════════════════════════════════

/** Student asks for a recheck of a published result. Only one request per exam, ever. */
const createRecheck = async (student: any, body: any) => {
  const instituteId = student.instituteId;
  const reason = clean(body?.reason).slice(0, 1000) || null;
  let examId = clean(body?.examId);
  const evaluationId = clean(body?.evaluationId);

  if (!examId && evaluationId) {
    const ev = await AIEvaluation.findOne({ where: { evaluationId, studentId: student.userId }, attributes: ["examId"] });
    examId = ev?.examId ?? "";
  }
  if (!examId) throw new ApiError(httpStatus.BAD_REQUEST, "Choose the result you want rechecked.");

  const result = await StudentResult.findOne({ where: { examId, studentId: student.userId, instituteId, isDeleted: false } });
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, "There is no published result for this exam.");
  if (result.resultStatus === RESULT_STATUS.ABSENT || !result.evaluationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "A recheck needs an evaluated answer sheet.");
  }

  const exam = await requireExam(instituteId, examId);
  const created = await sequelize.transaction(async (t) => {
    // Serialise per student+exam so a double click can't create two requests.
    await StudentResult.findOne({ where: { id: result.id }, transaction: t, lock: t.LOCK.UPDATE });
    const existing = await RecheckRequest.findOne({ where: { studentId: student.userId, examId }, transaction: t });
    if (existing) throw new ApiError(httpStatus.CONFLICT, "You have already requested a recheck for this exam. Only one recheck is allowed.");

    const request = await RecheckRequest.create(
      {
        requestId: newId("recheck"),
        studentId: student.userId,
        instituteId,
        examId,
        evaluationId: result.evaluationId as string,
        subjectId: result.subjectId,
        reason,
        status: "Pending",
      },
      { transaction: t }
    );
    const adminIds = await instituteAdminIds(instituteId, t);
    await notifyAll(
      adminIds.map((userId) => ({
        instituteId,
        userId,
        type: "RECHECK_REQUESTED",
        title: "Recheck requested",
        message: `${student.userName ?? "A student"} asked for a recheck of ${examLabel(exam)}.`,
        referenceId: request.requestId,
      })),
      t
    );
    return request;
  });
  return { requestId: created.requestId, status: created.status, examId, requestedAt: created.createdAt };
};

const recheckRow = (r: any, exam: any, assignment: any, names: Map<string, string>, masked = false) => {
  const studentName = names.get(r.studentId) ?? "";
  return {
    requestId: r.requestId,
    examId: r.examId,
    label: exam ? examLabel(exam) : r.examId,
    examType: exam?.examType ?? "",
    subjectName: exam?.subject?.subjectName ?? "",
    className: exam?.class?.className ?? "",
    studentId: masked ? null : r.studentId,
    studentName: masked ? maskName(studentName) : studentName,
    reason: r.reason,
    status: r.status,
    requestedAt: r.createdAt,
    completedAt: r.completedAt,
    assignment: assignment
      ? {
          teacherId: assignment.teacherId,
          teacherName: names.get(assignment.teacherId) ?? "",
          assignedAt: assignment.assignedAt,
          previousScore: assignment.previousScore == null ? null : Number(assignment.previousScore),
          revisedScore: assignment.revisedScore == null ? null : Number(assignment.revisedScore),
          teacherNote: assignment.teacherNote,
          completedAt: assignment.completedAt,
        }
      : null,
  };
};

const decorateRechecks = async (requests: any[], masked = false) => {
  if (!requests.length) return [];
  const examIds = Array.from(new Set(requests.map((r) => r.examId)));
  const [exams, assignments] = await Promise.all([
    Exam.findAll({ where: { examId: { [Op.in]: examIds } }, include: EXAM_INCLUDES }),
    RecheckAssignment.findAll({ where: { requestId: { [Op.in]: requests.map((r) => r.requestId) } } }),
  ]);
  const examById = new Map(exams.map((e: any) => [e.examId, e]));
  const assignmentByRequest = new Map(assignments.map((a) => [a.requestId, a]));
  const userIds = Array.from(new Set([...requests.map((r) => r.studentId), ...assignments.map((a) => a.teacherId)]));
  const names = new Map((await UserModal.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ["userId", "userName"] })).map((u) => [u.userId, u.userName]));
  return requests.map((r) => recheckRow(r, examById.get(r.examId), assignmentByRequest.get(r.requestId), names, masked));
};

/** Admin: recheck requests of the institute. */
const listRechecks = async (admin: any, query: any) => {
  const { page, limit, offset } = paging(query, 10);
  const where: any = { instituteId: admin.instituteId };
  if (clean(query?.status)) where.status = clean(query.status);
  if (clean(query?.examId)) where.examId = clean(query.examId);
  const { rows, count } = await RecheckRequest.findAndCountAll({ where, order: [["createdAt", "DESC"]], limit, offset });
  const [pending, underReview, completed, rejected] = await Promise.all(
    ["Pending", "Under Review", "Completed", "Rejected"].map((status) => RecheckRequest.count({ where: { instituteId: admin.instituteId, status } }))
  );
  return { requests: await decorateRechecks(rows), summary: { pending, underReview, completed, rejected }, pagination: pageInfo(count, page, limit) };
};

/** Admin hands a recheck to the exam's evaluator (default) or another eligible teacher. */
const assignRecheck = async (admin: any, requestId: string, body: any) => {
  const instituteId = admin.instituteId;
  const request = await RecheckRequest.findOne({ where: { requestId: clean(requestId), instituteId } });
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, "Recheck request not found.");
  if (!["Pending", "Under Review"].includes(request.status)) {
    throw new ApiError(httpStatus.CONFLICT, `This request is already ${request.status.toLowerCase()}.`);
  }
  const exam = await requireExam(instituteId, request.examId);
  const evaluator = await activeEvaluator(exam.examId);
  const teacherId = clean(body?.teacherId) || evaluator?.teacherId || "";
  if (!teacherId) throw new ApiError(httpStatus.BAD_REQUEST, "Choose a teacher to recheck this answer sheet.");

  const teacherRole = await Role.findOne({ where: { role: "TEACHER" }, attributes: ["id"] });
  const teacher = await UserModal.findOne({
    where: { userId: teacherId, instituteId, roleId: teacherRole?.id ?? -1, status: 1, isDeleted: false },
    attributes: ["userId", "userName"],
  });
  if (!teacher) throw new ApiError(httpStatus.BAD_REQUEST, "That teacher is not active in your institute.");
  // Someone who knows the subject: the exam's evaluator, its subject teacher this session, or a teacher of it.
  const subjectName = exam.subject?.subjectName ?? "";
  const knowsSubject =
    teacher.userId === evaluator?.teacherId ||
    teacher.userId === (await subjectTeacherIn(exam.sessionId, exam.subjectId)) ||
    specialisesIn((await TeacherProfile.findOne({ where: { userId: teacher.userId, instituteId }, attributes: ["specialization"] }))?.specialization, subjectName) ||
    (await Subject.count({ where: { instituteId, teacherId: teacher.userId, isDeleted: false, subjectName: { [Op.iLike]: subjectName.replace(/[\\%_]/g, (ch: string) => `\\${ch}`) } } })) > 0;
  if (!knowsSubject) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${teacher.userName} doesn't teach ${subjectName}. Choose the exam's evaluator or another ${subjectName} teacher.`);
  }
  const evaluation = await AIEvaluation.findOne({ where: { evaluationId: request.evaluationId }, attributes: ["totalScore"] });

  const previousTeacher = await sequelize.transaction(async (t) => {
    const locked = await RecheckRequest.findOne({ where: { id: request.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!locked || !["Pending", "Under Review"].includes(locked.status)) throw new ApiError(httpStatus.CONFLICT, "This request was just updated. Reload and try again.");
    const existing = await RecheckAssignment.findOne({ where: { requestId: request.requestId }, transaction: t });
    const before = existing?.teacherId ?? null;
    if (existing) {
      await existing.update({ teacherId, assignedBy: admin.userId, assignedAt: new Date() }, { transaction: t });
    } else {
      await RecheckAssignment.create(
        {
          requestId: request.requestId,
          instituteId,
          examId: exam.examId,
          teacherId,
          assignedBy: admin.userId,
          assignedAt: new Date(),
          previousScore: evaluation?.totalScore ?? null,
        },
        { transaction: t }
      );
    }
    await locked.update({ status: "Under Review", reviewedAt: new Date() }, { transaction: t });
    const label = examLabel(exam);
    await notifyAll(
      [
        {
          instituteId,
          userId: teacherId,
          type: "RECHECK_ASSIGNED",
          title: "Recheck assigned",
          // The student's comment comes with it, so the teacher knows what to look at.
          message: `Re-evaluate one answer sheet of ${label}. The student's identity is hidden.${request.reason ? ` They wrote: “${preview(request.reason, 200)}”` : ""}`,
          referenceId: request.requestId,
        },
        { instituteId, userId: request.studentId, type: "RECHECK_UNDER_REVIEW", title: "Recheck under review", message: `Your recheck for ${label} is being reviewed.`, referenceId: request.requestId },
        ...(before && before !== teacherId
          ? [{ instituteId, userId: before, type: "RECHECK_UNASSIGNED", title: "Recheck reassigned", message: `A recheck of ${label} was given to another teacher.`, referenceId: request.requestId }]
          : []),
      ],
      t
    );
    return before;
  });
  return { requestId: request.requestId, teacherId, teacherName: teacher.userName, reassignedFrom: previousTeacher !== teacherId ? previousTeacher : null };
};

/** Admin turns a recheck down. */
const rejectRecheck = async (admin: any, requestId: string, body: any) => {
  const instituteId = admin.instituteId;
  const note = clean(body?.note).slice(0, 1000);
  if (!note) throw new ApiError(httpStatus.BAD_REQUEST, "Say why the recheck is rejected.");
  const request = await RecheckRequest.findOne({ where: { requestId: clean(requestId), instituteId } });
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, "Recheck request not found.");
  const exam = await requireExam(instituteId, request.examId);

  await sequelize.transaction(async (t) => {
    const locked = await RecheckRequest.findOne({ where: { id: request.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!locked || !["Pending", "Under Review"].includes(locked.status)) throw new ApiError(httpStatus.CONFLICT, `This request is already ${locked?.status?.toLowerCase() ?? "closed"}.`);
    await locked.update({ status: "Rejected", reviewedBy: admin.userId, reviewedAt: new Date(), completedAt: new Date() }, { transaction: t });
    await RecheckAssignment.update({ teacherNote: note, completedAt: new Date() }, { where: { requestId: request.requestId }, transaction: t });
    await notifyAll(
      [{ instituteId, userId: request.studentId, type: "RECHECK_REJECTED", title: "Recheck not accepted", message: `Your recheck for ${examLabel(exam)} was not accepted: ${note}`, referenceId: request.requestId }],
      t
    );
  });
  return { requestId: request.requestId, status: "Rejected" };
};

/** Teacher: rechecks assigned to me (student identity masked). */
const myRechecks = async (teacher: any, query: any) => {
  const { page, limit, offset } = paging(query, 10);
  const open = clean(query?.state) !== "done";
  const { rows, count } = await RecheckAssignment.findAndCountAll({
    where: { instituteId: teacher.instituteId, teacherId: teacher.userId, completedAt: open ? null : { [Op.ne]: null } },
    order: [["assignedAt", "DESC"]],
    limit,
    offset,
  });
  const requests = rows.length ? await RecheckRequest.findAll({ where: { requestId: { [Op.in]: rows.map((r) => r.requestId) } } }) : [];
  const evaluations = requests.length
    ? await AIEvaluation.findAll({ where: { evaluationId: { [Op.in]: requests.map((r) => r.evaluationId) } }, attributes: ["evaluationId", "sheetId", "totalScore"] })
    : [];
  const evalById = new Map(evaluations.map((e) => [e.evaluationId, e]));
  const decorated = await decorateRechecks(requests, true);
  return {
    requests: decorated.map((d: any) => {
      const req = requests.find((r) => r.requestId === d.requestId);
      const ev = req ? evalById.get(req.evaluationId) : undefined;
      return { ...d, sheetId: ev?.sheetId ?? null, currentScore: ev?.totalScore == null ? null : Number(ev.totalScore) };
    }),
    pagination: pageInfo(count, page, limit),
  };
};

/** Teacher finishes a recheck: new marks update the evaluation and the published result. */
const completeRecheck = async (teacher: any, requestId: string, body: any) => {
  const instituteId = teacher.instituteId;
  const note = clean(body?.note).slice(0, 1000) || null;
  const revised = Number(body?.revisedScore);
  const request = await RecheckRequest.findOne({ where: { requestId: clean(requestId), instituteId } });
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, "Recheck request not found.");
  const exam = await requireExam(instituteId, request.examId);
  if (!Number.isFinite(revised) || revised < 0 || revised > exam.totalMarks) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Marks must be between 0 and ${exam.totalMarks}.`);
  }

  const { gradingScale } = await settingsOf(instituteId);
  const outcome = await sequelize.transaction(async (t) => {
    const locked = await RecheckRequest.findOne({ where: { id: request.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!locked || locked.status !== "Under Review") throw new ApiError(httpStatus.CONFLICT, "This recheck is not open for review.");
    const assignment = await RecheckAssignment.findOne({ where: { requestId: request.requestId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!assignment || (assignment.teacherId !== teacher.userId && !isAdmin(teacher))) {
      throw new ApiError(httpStatus.FORBIDDEN, "This recheck is not assigned to you.");
    }

    const evaluation = await AIEvaluation.findOne({ where: { evaluationId: request.evaluationId }, transaction: t, lock: t.LOCK.UPDATE });
    const previous = evaluation?.totalScore == null ? null : Number(evaluation.totalScore);
    const marks = round2(revised);
    const changed = previous == null || Math.abs(previous - marks) >= 0.005;
    // Every change of a published mark says why (Marks & grading → Changes).
    if (changed && (note ?? "").length < 3) throw new ApiError(httpStatus.BAD_REQUEST, "Say why the marks change; the admin sees it with the change.");
    if (evaluation && changed) await evaluation.update({ totalScore: marks }, { transaction: t });

    const result = await StudentResult.findOne({ where: { examId: request.examId, studentId: request.studentId, isDeleted: false }, transaction: t, lock: t.LOCK.UPDATE });
    if (result && changed) {
      await result.update(
        { ...resultFor(marks, result.totalMarks, result.passingMarks, gradingScale), revisedAt: new Date(), revisionCount: result.revisionCount + 1 },
        { transaction: t }
      );
    }
    // Who changed the student's marks, from what, and why (Marks & grading → Changes).
    if (changed) {
      await logMarksChange(
        {
          instituteId,
          what: MARKS_CHANGE.STUDENT,
          source: MARKS_SOURCE.RECHECK,
          changedBy: teacher.userId,
          oldValue: previous,
          newValue: marks,
          reason: note ?? "Recheck",
          sessionId: exam.sessionId,
          examType: exam.examType,
          examId: exam.examId,
          subjectId: exam.subjectId,
          studentId: request.studentId,
          sheetId: evaluation?.sheetId ?? null,
        },
        t
      );
    }
    await assignment.update({ previousScore: assignment.previousScore ?? previous, revisedScore: marks, teacherNote: note, completedAt: new Date() }, { transaction: t });
    await locked.update({ status: "Completed", reviewedBy: teacher.userId, reviewedAt: new Date(), completedAt: new Date() }, { transaction: t });

    const label = examLabel(exam);
    const adminIds = [assignment.assignedBy, ...(await instituteAdminIds(instituteId, t))];
    await notifyAll(
      [
        {
          instituteId,
          userId: request.studentId,
          type: "RECHECK_COMPLETED",
          title: "Recheck completed",
          message: changed
            ? `Your recheck for ${label} is done. Marks changed from ${previous ?? "—"} to ${marks}.`
            : `Your recheck for ${label} is done. Your marks stay at ${marks}.`,
          referenceId: request.requestId,
        },
        ...Array.from(new Set(adminIds)).map((userId) => ({
          instituteId,
          userId,
          type: "RECHECK_COMPLETED",
          title: "Recheck completed",
          message: `A recheck of ${label} is done${changed ? ` (${previous ?? "—"} → ${marks})` : " (no change)"}.`,
          referenceId: request.requestId,
        })),
      ],
      t
    );
    return { previous, revised: marks, changed };
  });
  return { requestId: request.requestId, status: "Completed", ...outcome };
};


export default {
  listPipeline,
  getTimeline,
  listScanners,
  assignScanner,
  unassignScanner,
  myScanExams,
  scanRoster,
  setAttendance,
  completeScan,
  publishResults,
  unpublishResults,
  listResults,
  myResults,
  createRecheck,
  listRechecks,
  assignRecheck,
  rejectRecheck,
  myRechecks,
  completeRecheck,
};
