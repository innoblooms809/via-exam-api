/**
 * An exam's full report, for the admin: every student of the exam on one row, from scanning to
 * the published result and any recheck, with the exam's stages, the people who worked on it,
 * and totals over the class.
 *
 *   scanning      uploaded (by whom, when, scan quality) · absent (marked by) · not yet uploaded
 *   evaluation    the AI's marks · the evaluator's edits · marks now
 *   cross-check   chosen? verified or revised (from → to), by the cross-checker
 *   result        published marks, grade, pass / fail
 *   recheck       the latest claim, where it is, and what it changed
 *
 * Read in bulk from the rows each step already keeps (the same ones sheetHistory reads for a
 * single sheet), so an exam of 60 students is a handful of queries. Names are not masked: the
 * admin sees who is who.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import Exam from "../../models/Exam.model";
import Scanner from "../../models/Scanner.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";
import MarksAudit, { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import StudentResult from "../../models/StudentResult.model";
import RecheckRequest, { recheckCategoryLabel } from "../../models/RecheckRequest.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import { CROSS_CHECK_ITEM_STATUS, CrossCheckItem, CrossCheckRound } from "../../models/CrossCheck.model";
import UserModal from "../../models/User.model";
import ApiError from "../../utils/ApiError";
import { EXAM_INCLUDES, buildRoster } from "./examRoster.service";
import { reasonTextOf } from "./crossCheck.service";
import ExamWorkflowService from "./examWorkflow.service";

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const OPEN_RECHECK = ["Pending", "Under Review", "Awaiting Approval"];

export async function examReport(admin: any, examId: string) {
  const exam: any = await Exam.findOne({ where: { examId: String(examId ?? "").trim(), instituteId: admin.instituteId, isDeleted: false }, include: EXAM_INCLUDES });
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");

  const [roster, timeline, scanners, evaluators, rounds, results, requests] = await Promise.all([
    buildRoster(exam),
    ExamWorkflowService.getTimeline(admin, exam.examId),
    ExamScannerAssignment.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
    EvaluationAssignment.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
    CrossCheckRound.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
    StudentResult.findAll({ where: { examId: exam.examId, isDeleted: false } }),
    RecheckRequest.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
  ]);
  const sheetIds = roster.rows.map((r) => r.sheetId).filter(Boolean) as string[];
  const activeRound = rounds.find((r) => r.isActive) ?? null;

  const [sheets, evaluations, audits, items, assignments] = await Promise.all([
    sheetIds.length ? Scanner.findAll({ where: { sheetId: { [Op.in]: sheetIds } }, attributes: ["sheetId", "uploadedBy", "createdAt"] }) : [],
    sheetIds.length ? AIEvaluation.findAll({ where: { sheetId: { [Op.in]: sheetIds } }, attributes: ["sheetId", "evaluationId", "status", "totalScore", "error", "createdAt"] }) : [],
    sheetIds.length
      ? MarksAudit.findAll({ where: { sheetId: { [Op.in]: sheetIds }, what: MARKS_CHANGE.STUDENT }, order: [["createdAt", "ASC"]] })
      : [],
    activeRound ? CrossCheckItem.findAll({ where: { roundId: activeRound.roundId } }) : [],
    requests.length ? RecheckAssignment.findAll({ where: { requestId: { [Op.in]: requests.map((r) => r.requestId) } } }) : [],
  ]);

  const sheetOf = new Map(sheets.map((s) => [s.sheetId, s]));
  const evaluationOf = new Map(evaluations.map((e) => [e.sheetId, e]));
  const sheetOfEvaluation = new Map(evaluations.map((e) => [e.evaluationId, e.sheetId]));
  const itemOf = new Map(items.map((i) => [i.sheetId, i]));
  const assignmentOf = new Map(assignments.map((a) => [a.requestId, a]));
  const auditsOf = new Map<string, typeof audits>();
  for (const a of audits) auditsOf.set(a.sheetId as string, [...(auditsOf.get(a.sheetId as string) ?? []), a]);
  const resultOf = new Map<string, StudentResult>();
  for (const r of results) {
    const key = r.sheetId ?? (r.evaluationId ? sheetOfEvaluation.get(r.evaluationId) : null);
    if (key) resultOf.set(key, r);
    resultOf.set(`student:${r.studentId}`, r);
  }
  // The latest claim per sheet.
  const recheckOf = new Map<string, RecheckRequest>();
  for (const r of requests) {
    const sheetId = sheetOfEvaluation.get(r.evaluationId);
    if (sheetId) recheckOf.set(sheetId, r);
  }

  const userIds = new Set<string>(
    [
      ...sheets.map((s) => s.uploadedBy),
      ...roster.rows.map((r) => r.absentMarkedBy),
      ...scanners.flatMap((s) => [s.scannerId, s.assignedBy]),
      ...evaluators.flatMap((e) => [e.teacherId, e.assignedBy]),
      ...rounds.map((r) => r.checkerId),
      ...audits.map((a) => a.changedBy),
      ...assignments.map((a) => a.teacherId),
    ].filter(Boolean) as string[]
  );
  const names = new Map(
    userIds.size ? (await UserModal.findAll({ where: { userId: { [Op.in]: [...userIds] } }, attributes: ["userId", "userName"] })).map((u) => [u.userId, u.userName]) : []
  );
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? "Someone") : null);

  const rows = roster.rows.map((r) => {
    const sheet = r.sheetId ? sheetOf.get(r.sheetId) : null;
    const evaluation = r.sheetId ? evaluationOf.get(r.sheetId) : null;
    const sheetAudits = r.sheetId ? (auditsOf.get(r.sheetId) ?? []) : [];
    const evaluatorEdits = sheetAudits.filter((a) => a.source === MARKS_SOURCE.EVALUATION);
    const item = r.sheetId ? itemOf.get(r.sheetId) : null;
    const request = r.sheetId ? recheckOf.get(r.sheetId) : null;
    const assignment = request ? assignmentOf.get(request.requestId) : null;
    const result = (r.sheetId ? resultOf.get(r.sheetId) : null) ?? (r.studentId ? resultOf.get(`student:${r.studentId}`) : null) ?? null;
    // The AI's own marks: before anyone changed them.
    const firstChange = sheetAudits[0] ?? null;
    const aiMarks = evaluation?.status === "Success" || firstChange ? num(firstChange ? firstChange.oldValue : (item?.marksBefore ?? assignment?.previousScore ?? evaluation?.totalScore)) : null;
    const lastEdit = evaluatorEdits[evaluatorEdits.length - 1] ?? null;
    return {
      rollNo: r.rollNo,
      name: r.name,
      studentId: r.studentId,
      sheetId: r.sheetId,
      state: r.state,
      scan: {
        uploadedAt: r.uploadedAt,
        uploadedBy: nameOf(sheet?.uploadedBy),
        quality: r.quality?.flag ?? null,
        qualityReasons: r.quality?.reasons ?? [],
        absentMarkedBy: nameOf(r.absentMarkedBy),
        absentMarkedAt: r.absentMarkedAt,
      },
      ai: evaluation ? { status: evaluation.status, marks: aiMarks, error: evaluation.status === "Failed" ? evaluation.error : null, at: evaluation.createdAt } : null,
      evaluator: evaluatorEdits.length
        ? { edits: evaluatorEdits.length, questions: evaluatorEdits.reduce((n, a) => n + (a.details?.length ?? 0), 0), marks: num(lastEdit?.newValue), lastAt: lastEdit?.createdAt ?? null, by: nameOf(lastEdit?.changedBy) }
        : null,
      crossCheck: item
        ? {
            status: item.status,
            reason: reasonTextOf(item, activeRound!),
            before: num(item.marksBefore),
            after: item.status === CROSS_CHECK_ITEM_STATUS.PENDING ? null : num(item.marksAfter),
            questions: item.changes?.length ?? 0,
            note: item.note,
            at: item.checkedAt,
          }
        : null,
      marks: evaluation?.status === "Success" ? num(evaluation.totalScore) : null,
      result: result
        ? { marks: num(result.marksObtained), percentage: num(result.percentage), grade: result.grade, status: result.resultStatus, revisions: result.revisionCount ?? 0 }
        : null,
      recheck: request
        ? {
            requestId: request.requestId,
            status: request.status,
            category: recheckCategoryLabel(request.category),
            teacher: nameOf(assignment?.teacherId),
            before: num(assignment?.previousScore),
            after: num(assignment?.revisedScore),
            questions: assignment?.changes?.length ?? 0,
            at: request.createdAt,
          }
        : null,
    };
  });

  // ── Totals over the class ──
  const marked = rows.filter((r) => r.marks != null).map((r) => r.marks as number);
  const published = rows.filter((r) => r.result);
  const summary = {
    students: rows.length,
    uploaded: roster.counts.uploaded,
    absent: roster.counts.absent,
    notUploaded: roster.counts.pending,
    poorScans: roster.counts.poorScans,
    evaluated: rows.filter((r) => r.ai?.status === "Success").length,
    evaluationFailed: rows.filter((r) => r.ai?.status === "Failed").length,
    evaluationPending: rows.filter((r) => r.state === "UPLOADED" && r.ai?.status !== "Success" && r.ai?.status !== "Failed").length,
    evaluatorEdited: rows.filter((r) => r.evaluator).length,
    crossChecked: rows.filter((r) => r.crossCheck && r.crossCheck.status !== CROSS_CHECK_ITEM_STATUS.PENDING).length,
    crossCheckPending: rows.filter((r) => r.crossCheck?.status === CROSS_CHECK_ITEM_STATUS.PENDING).length,
    crossCheckRevised: rows.filter((r) => r.crossCheck?.status === CROSS_CHECK_ITEM_STATUS.CHANGED).length,
    published: published.length,
    passed: published.filter((r) => r.result?.status === "PASS").length,
    failed: published.filter((r) => r.result?.status === "FAIL").length,
    rechecks: requests.length,
    rechecksOpen: requests.filter((r) => OPEN_RECHECK.includes(r.status)).length,
    rechecksChanged: requests.filter((r) => r.status === "Completed" && assignmentOf.get(r.requestId)?.revisedScore != null && Math.abs(Number(assignmentOf.get(r.requestId)?.revisedScore) - Number(assignmentOf.get(r.requestId)?.previousScore)) >= 0.005).length,
    average: marked.length ? num(marked.reduce((a, b) => a + b, 0) / marked.length) : null,
    highest: marked.length ? Math.max(...marked) : null,
    lowest: marked.length ? Math.min(...marked) : null,
  };

  return {
    exam: {
      examId: exam.examId,
      label: timeline.label,
      subjectName: exam.subject?.subjectName ?? "",
      className: exam.class?.className ?? "",
      sectionName: exam.section?.sectionName ?? "",
      sessionName: exam.session?.sessionName ?? "",
      examType: exam.examType,
      examDate: exam.examDate ?? null,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      status: exam.status,
    },
    steps: timeline.steps,
    people: {
      scanners: scanners.map((s) => ({ name: nameOf(s.scannerId), active: s.isActive, assignedAt: s.createdAt, completedAt: s.completedAt, unassignedAt: s.unassignedAt })),
      evaluators: evaluators.map((e) => ({ name: nameOf(e.teacherId), active: e.isActive, assignedAt: e.createdAt, reviewedAt: e.reviewedAt, unassignedAt: e.unassignedAt })),
      crossCheckers: rounds.map((r) => ({ name: nameOf(r.checkerId), active: r.isActive, status: r.status, assignedAt: r.createdAt, completedAt: r.completedAt })),
    },
    summary,
    rows,
  };
}

export default { examReport };
