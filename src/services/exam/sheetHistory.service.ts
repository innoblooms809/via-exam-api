/**
 * One answer sheet's marks history, for the admin: everything that happened to its marks,
 * in order, with who did it.
 *
 *   uploaded → AI marked → evaluator's edits (question by question) → evaluator confirmed
 *   → cross-check (selected, verified or revised) → results published
 *   → recheck: the student's claim → assigned to a teacher → the teacher's decision
 *     (question by question) → sent back / approved by the admin, or turned down
 *
 * Read from the rows each step already keeps (MarksAudit, EvaluationAssignment,
 * CrossCheckItem, StudentResult, RecheckRequest, RecheckAssignment); nothing is stored twice.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import Scanner from "../../models/Scanner.model";
import Exam from "../../models/Exam.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import MarksAudit, { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import StudentResult from "../../models/StudentResult.model";
import RecheckRequest, { recheckCategoryLabel } from "../../models/RecheckRequest.model";
import RecheckAssignment, { type QuestionChange } from "../../models/RecheckAssignment.model";
import { CrossCheckItem, CrossCheckRound, CROSS_CHECK_ITEM_STATUS } from "../../models/CrossCheck.model";
import UserModal from "../../models/User.model";
import ApiError from "../../utils/ApiError";
import { EXAM_INCLUDES } from "./examRoster.service";
import { examLabel } from "../notification/notifyPeople";
import { studentForSheet } from "../student/enrollment.service";

export type HistoryKind =
  | "uploaded"
  | "ai"
  | "evaluator-assigned"
  | "evaluator-edit"
  | "evaluator-confirmed"
  | "cross-check-selected"
  | "cross-check-confirmed"
  | "cross-check-revised"
  | "published"
  | "recheck-claimed"
  | "recheck-assigned"
  | "recheck-returned"
  | "recheck-decided"
  | "recheck-approved"
  | "recheck-rejected";

export interface HistoryEvent {
  at: string;
  kind: HistoryKind;
  title: string;
  /** Who did it, and in what role ("Evaluator", "Recheck teacher", "Admin"…). */
  actor: string | null;
  role: string | null;
  marks?: { from: number | null; to: number | null } | null;
  changes?: QuestionChange[];
  /** Their words: a reason, a remark, the student's claim. */
  note?: string | null;
  /** A line of context ("Q3(b), Q5 · Marks not awarded for a correct answer"). */
  detail?: string | null;
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

const CROSS_CHECK_WHY: Record<string, string> = {
  all: "every answer sheet is cross-checked",
  below: "low score",
  above: "high score",
  "near-pass": "near the pass mark",
  picked: "picked by the admin",
};

export async function sheetHistory(admin: any, sheetId: string) {
  const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false }, attributes: { exclude: ["fileBuffer"] } });
  if (!sheet || sheet.instituteId !== admin?.instituteId) throw new ApiError(httpStatus.NOT_FOUND, "Answer sheet not found.");

  const [exam, evaluation, audits, items] = await Promise.all([
    sheet.examId ? (Exam.findOne({ where: { examId: sheet.examId }, include: EXAM_INCLUDES }) as Promise<any>) : null,
    AIEvaluation.findOne({ where: { sheetId } }),
    MarksAudit.findAll({ where: { sheetId, what: MARKS_CHANGE.STUDENT }, order: [["createdAt", "ASC"]] }),
    CrossCheckItem.findAll({ where: { sheetId }, order: [["createdAt", "ASC"]] }),
  ]);
  const [evaluator, rounds, requests, result, ownerId] = await Promise.all([
    exam ? EvaluationAssignment.findOne({ where: { examId: exam.examId }, order: [["isActive", "DESC"], ["createdAt", "DESC"]] }) : null,
    items.length ? CrossCheckRound.findAll({ where: { roundId: { [Op.in]: items.map((i) => i.roundId) } } }) : [],
    evaluation?.evaluationId ? RecheckRequest.findAll({ where: { evaluationId: evaluation.evaluationId }, order: [["createdAt", "ASC"]] }) : [],
    StudentResult.findOne({ where: { [Op.or]: [{ sheetId }, ...(evaluation?.evaluationId ? [{ evaluationId: evaluation.evaluationId }] : [])], isDeleted: false } }),
    exam ? studentForSheet(sheet as any) : null,
  ]);
  const assignments = requests.length ? await RecheckAssignment.findAll({ where: { requestId: { [Op.in]: requests.map((r) => r.requestId) } } }) : [];
  const assignmentOf = new Map(assignments.map((a) => [a.requestId, a]));
  const roundOf = new Map(rounds.map((r) => [r.roundId, r]));

  const userIds = new Set<string>(
    [
      sheet.uploadedBy,
      evaluator?.teacherId,
      evaluator?.assignedBy,
      evaluator?.reviewedBy,
      result?.publishedBy,
      result?.studentId,
      ownerId,
      ...audits.flatMap((a) => [a.changedBy, a.approvedBy]),
      ...items.map((i) => i.checkedBy),
      ...rounds.flatMap((r) => [r.checkerId, r.assignedBy]),
      ...requests.flatMap((r) => [r.studentId, r.reviewedBy]),
      ...assignments.flatMap((a) => [a.teacherId, a.assignedBy, a.approvedBy]),
    ].filter(Boolean) as string[]
  );
  const names = new Map(
    (await UserModal.findAll({ where: { userId: { [Op.in]: [...userIds] } }, attributes: ["userId", "userName"] })).map((u) => [u.userId, u.userName])
  );
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? "Someone") : null);

  const events: HistoryEvent[] = [];
  const add = (e: Omit<HistoryEvent, "at"> & { at: Date | string | null | undefined }) => {
    const at = iso(e.at);
    if (at) events.push({ ...e, at });
  };

  add({ at: sheet.createdAt, kind: "uploaded", title: "Answer sheet uploaded", actor: nameOf(sheet.uploadedBy), role: "Scanner", detail: sheet.fileName });

  // The AI's own marks: before the first change anyone made, else what the sheet has now.
  const firstChange = audits[0] ?? null;
  const recheckBefore = assignments.find((a) => a.previousScore != null)?.previousScore;
  const crossBefore = items.find((i) => i.marksBefore != null)?.marksBefore;
  const aiMarks = firstChange ? num(firstChange.oldValue) : num(crossBefore ?? recheckBefore ?? evaluation?.totalScore);
  if (evaluation) {
    add({
      at: evaluation.createdAt,
      kind: "ai",
      title: evaluation.status === "Failed" ? "AI evaluation failed" : "AI evaluated the sheet",
      actor: "AI",
      role: null,
      marks: evaluation.status === "Failed" ? null : { from: null, to: aiMarks },
      note: evaluation.status === "Failed" ? evaluation.error : null,
    });
  }

  if (evaluator) {
    add({ at: evaluator.createdAt, kind: "evaluator-assigned", title: `Evaluation given to ${nameOf(evaluator.teacherId)}`, actor: nameOf(evaluator.assignedBy), role: "Admin" });
  }

  for (const a of audits) {
    // Recheck and cross-check changes are told by their own steps below.
    if (a.source !== MARKS_SOURCE.EVALUATION) continue;
    add({
      at: a.createdAt,
      kind: "evaluator-edit",
      title: "Marks changed by the evaluator",
      actor: nameOf(a.changedBy),
      role: a.changedBy === evaluator?.teacherId ? "Evaluator" : "Teacher",
      marks: { from: num(a.oldValue), to: num(a.newValue) },
      changes: a.details ?? [],
      note: a.reason,
    });
  }

  if (evaluator?.reviewedAt) {
    add({ at: evaluator.reviewedAt, kind: "evaluator-confirmed", title: "Evaluator confirmed the exam's marks", actor: nameOf(evaluator.reviewedBy ?? evaluator.teacherId), role: "Evaluator" });
  }

  for (const item of items) {
    const round = roundOf.get(item.roundId);
    add({
      at: item.createdAt,
      kind: "cross-check-selected",
      title: `Selected for cross-check${round?.checkerId ? ` by ${nameOf(round.checkerId)}` : ""}`,
      actor: nameOf(round?.assignedBy),
      role: "Admin",
      detail: CROSS_CHECK_WHY[item.reason] ? `Why: ${CROSS_CHECK_WHY[item.reason]}` : null,
      marks: { from: null, to: num(item.marksBefore) },
    });
    if (item.status === CROSS_CHECK_ITEM_STATUS.PENDING) continue;
    const revised = item.status === CROSS_CHECK_ITEM_STATUS.CHANGED;
    add({
      at: item.checkedAt,
      kind: revised ? "cross-check-revised" : "cross-check-confirmed",
      title: revised ? "Cross-checker revised the marks" : "Cross-checker confirmed the marks",
      actor: nameOf(item.checkedBy),
      role: "Cross-checker",
      marks: { from: num(item.marksBefore), to: num(item.marksAfter) },
      changes: item.changes ?? [],
      note: item.note,
    });
  }

  if (result) {
    // What was published: before the first recheck changed it.
    const recheckAudit = audits.find((a) => a.source === MARKS_SOURCE.RECHECK);
    const publishedMarks = recheckAudit ? num(recheckAudit.oldValue) : num(result.marksObtained);
    add({
      at: result.publishedAt,
      kind: "published",
      title: "Results published",
      actor: nameOf(result.publishedBy),
      role: "Admin",
      marks: { from: null, to: publishedMarks },
    });
  }

  for (const request of requests) {
    const assignment = assignmentOf.get(request.requestId);
    const about = (request.questions ?? []).map((q) => q.label).join(", ");
    add({
      at: request.createdAt,
      kind: "recheck-claimed",
      title: "Student asked for a recheck",
      actor: nameOf(request.studentId),
      role: "Student",
      detail: [recheckCategoryLabel(request.category), about ? `About ${about}` : "The whole paper"].filter(Boolean).join(" · "),
      note: request.reason,
    });
    if (assignment) {
      add({
        at: assignment.assignedAt,
        kind: "recheck-assigned",
        title: `Recheck given to ${nameOf(assignment.teacherId)}`,
        actor: nameOf(assignment.assignedBy),
        role: "Admin",
      });
      if (assignment.returnedAt) {
        add({ at: assignment.returnedAt, kind: "recheck-returned", title: "Admin sent the recheck decision back", actor: nameOf(request.reviewedBy) ?? "Admin", role: "Admin", note: assignment.returnNote });
      }
      if (assignment.completedAt && assignment.revisedScore != null) {
        const from = num(assignment.previousScore);
        const to = num(assignment.revisedScore);
        const same = from != null && to != null && Math.abs(from - to) < 0.005 && !(assignment.changes ?? []).length;
        add({
          at: assignment.completedAt,
          kind: "recheck-decided",
          title: same ? "Recheck teacher kept the marks" : "Recheck teacher changed the marks",
          actor: nameOf(assignment.teacherId),
          role: "Recheck teacher",
          marks: { from, to },
          changes: assignment.changes ?? [],
          note: assignment.teacherNote,
          detail: request.status === "Awaiting Approval" ? "Waiting for the admin's approval" : null,
        });
      }
      if (assignment.approvedAt) {
        add({
          at: assignment.approvedAt,
          kind: "recheck-approved",
          title: "Admin approved the recheck: the result is updated",
          actor: nameOf(assignment.approvedBy),
          role: "Admin",
          marks: { from: num(assignment.previousScore), to: num(assignment.revisedScore) },
        });
      }
    }
    if (request.status === "Rejected") {
      add({ at: request.reviewedAt ?? request.updatedAt, kind: "recheck-rejected", title: "Admin turned the recheck down", actor: nameOf(request.reviewedBy), role: "Admin", note: request.decisionNote });
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at));

  const openRecheck = requests.find((r) => ["Pending", "Under Review", "Awaiting Approval"].includes(r.status));
  return {
    sheet: {
      sheetId: sheet.sheetId,
      rollNo: sheet.rollNo,
      studentName: nameOf(result?.studentId ?? ownerId) ?? sheet.studentName ?? null,
      exam: exam ? examLabel(exam) : null,
      sessionName: exam?.session?.sessionName ?? null,
      totalMarks: exam?.totalMarks == null ? null : Number(exam.totalMarks),
    },
    summary: {
      evaluator: nameOf(evaluator?.teacherId),
      aiMarks,
      publishedMarks: events.find((e) => e.kind === "published")?.marks?.to ?? null,
      currentMarks: num(evaluation?.totalScore),
      recheck: openRecheck ? { status: openRecheck.status, teacher: nameOf(assignmentOf.get(openRecheck.requestId)?.teacherId) } : null,
    },
    events,
  };
}

export default { sheetHistory };
