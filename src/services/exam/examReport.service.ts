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
 * The query narrows and pages it:
 *   sectionId   one section of the exam ("" = students without a section; left out = all)
 *   filter      a quick filter (FILTER_KEYS), search  a name or roll number
 *   page, limit the page of rows to send (default 1 and 50; the CSV asks for up to 1000)
 *
 * Two passes, so a page costs the same whatever the class size:
 *   1. Light, over every student in view: the roster, the evaluations' status and marks, the
 *      cross-check items, results, rechecks, and a COUNT of each sheet's evaluator edits. That
 *      is enough for the totals, every filter's count, the search and the order.
 *   2. Full, over the page only: who uploaded, every marks change (with its per-question
 *      details) and the names of the people on those rows.
 *
 * `sections` always lists every section with its counts, so the page can offer the choice.
 * Names are not masked: the admin sees who is who.
 */

import httpStatus from "http-status";
import { Op, fn, col } from "sequelize";
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
import { EXAM_INCLUDES, buildRoster, sectionKey, type RosterRow } from "./examRoster.service";
import { reasonTextOf } from "./crossCheck.service";
import ExamWorkflowService from "./examWorkflow.service";

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const OPEN_RECHECK = ["Pending", "Under Review", "Awaiting Approval"];
const moved = (from: unknown, to: unknown) => to != null && from != null && Math.abs(Number(to) - Number(from)) >= 0.005;
const byRoll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

/** What a student's row needs to be counted, filtered and ordered, before its details are read. */
interface Facts {
  r: RosterRow;
  evaluation: AIEvaluation | null;
  edits: number;
  item: CrossCheckItem | null;
  request: RecheckRequest | null;
  result: StudentResult | null;
  marks: number | null;
}

/** The quick filters, as the page names them. */
export const FILTERS = {
  all: () => true,
  missing: (f: Facts) => f.r.state === "PENDING",
  absent: (f: Facts) => f.r.state === "ABSENT",
  poor: (f: Facts) => f.r.quality?.flag === "warn" || f.r.quality?.flag === "low",
  aiFailed: (f: Facts) => f.evaluation?.status === "Failed",
  edited: (f: Facts) => f.edits > 0,
  crossChecked: (f: Facts) => Boolean(f.item),
  recheck: (f: Facts) => Boolean(f.request),
  failed: (f: Facts) => f.result?.resultStatus === "FAIL",
} as const;
export type FilterKey = keyof typeof FILTERS;
export const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];

/** The section asked for: its key ("" = no section), or null for the whole exam. */
const sectionOf = (query: any): string | null =>
  query && Object.prototype.hasOwnProperty.call(query, "sectionId") ? sectionKey(query.sectionId) : null;

const pageOf = (query: any) => {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query?.limit, 10) || DEFAULT_LIMIT));
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  return { page, limit };
};

export async function examReport(admin: any, examId: string, query: any = {}) {
  const exam: any = await Exam.findOne({ where: { examId: String(examId ?? "").trim(), instituteId: admin.instituteId, isDeleted: false }, include: EXAM_INCLUDES });
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
  const only = sectionOf(query);
  const inScope = (sectionId: string | null | undefined) => only === null || sectionKey(sectionId) === only;
  const filter: FilterKey = FILTER_KEYS.includes(query?.filter) ? query.filter : "all";
  const search = String(query?.search ?? "").trim().toLowerCase();

  // ── Pass 1: light, over every student in view ──
  const [roster, timeline, scanners, evaluators, rounds, results, requests] = await Promise.all([
    buildRoster(exam, { sections: only === null ? null : [only || null] }),
    ExamWorkflowService.getTimeline(admin, exam.examId),
    ExamScannerAssignment.findAll({
      where: { examId: exam.examId },
      attributes: ["scannerId", "sectionId", "isActive", "createdAt", "completedAt", "unassignedAt"],
      order: [["createdAt", "ASC"]],
    }),
    EvaluationAssignment.findAll({
      where: { examId: exam.examId },
      attributes: ["teacherId", "sectionId", "isActive", "createdAt", "reviewedAt", "unassignedAt"],
      order: [["createdAt", "ASC"]],
    }),
    CrossCheckRound.findAll({ where: { examId: exam.examId }, order: [["createdAt", "ASC"]] }),
    StudentResult.findAll({
      where: { examId: exam.examId, isDeleted: false },
      attributes: ["sheetId", "evaluationId", "studentId", "marksObtained", "percentage", "grade", "resultStatus", "revisionCount"],
    }),
    RecheckRequest.findAll({ where: { examId: exam.examId }, attributes: ["requestId", "evaluationId", "status", "category", "createdAt"], order: [["createdAt", "ASC"]] }),
  ]);
  const sheetIds = roster.rows.map((r) => r.sheetId).filter(Boolean) as string[];
  const sheetsInView = new Set(sheetIds);
  const activeRound = rounds.find((r) => r.isActive) ?? null;
  const sectionNames = new Map(roster.sections.map((s) => [s.sectionId ?? "", s.sectionName]));
  const sectionNameOf = (sectionId: string | null) => sectionNames.get(sectionId ?? "") ?? "";
  const sectionOrder = new Map(roster.sections.map((s, i) => [sectionKey(s.sectionId), i]));
  const scannersInView = scanners.filter((s) => inScope(s.sectionId));
  const evaluatorsInView = evaluators.filter((e) => inScope(e.sectionId));
  const inSheets = { [Op.in]: sheetIds };

  const [evaluations, editCounts, items, assignments] = await Promise.all([
    sheetIds.length ? AIEvaluation.findAll({ where: { sheetId: inSheets }, attributes: ["sheetId", "evaluationId", "status", "totalScore", "error", "createdAt"] }) : [],
    sheetIds.length
      ? (MarksAudit.findAll({
          where: { sheetId: inSheets, what: MARKS_CHANGE.STUDENT, source: MARKS_SOURCE.EVALUATION },
          attributes: ["sheetId", [fn("COUNT", col("sheetId")), "edits"]],
          group: ["sheetId"],
          raw: true,
        }) as unknown as Promise<{ sheetId: string; edits: string | number }[]>)
      : [],
    activeRound && sheetIds.length
      ? CrossCheckItem.findAll({
          where: { roundId: activeRound.roundId, sheetId: inSheets },
          attributes: ["sheetId", "status", "reason", "marksBefore", "marksAfter", "changes", "note", "checkedAt"],
        })
      : [],
    requests.length ? RecheckAssignment.findAll({ where: { requestId: { [Op.in]: requests.map((r) => r.requestId) } }, attributes: ["requestId", "teacherId", "previousScore", "revisedScore", "changes"] }) : [],
  ]);

  const evaluationOf = new Map(evaluations.map((e) => [e.sheetId, e]));
  const sheetOfEvaluation = new Map(evaluations.map((e) => [e.evaluationId, e.sheetId]));
  const editsOf = new Map(editCounts.map((c) => [c.sheetId, Number(c.edits) || 0]));
  const itemOf = new Map(items.map((i) => [i.sheetId, i]));
  const assignmentOf = new Map(assignments.map((a) => [a.requestId, a]));
  const resultOf = new Map<string, StudentResult>();
  for (const r of results) {
    const key = r.sheetId ?? (r.evaluationId ? sheetOfEvaluation.get(r.evaluationId) : null);
    if (key) resultOf.set(key, r);
    resultOf.set(`student:${r.studentId}`, r);
  }
  // The claims on the sheets in view; the latest one per sheet.
  const requestsInView = requests.filter((r) => sheetsInView.has(sheetOfEvaluation.get(r.evaluationId) as string));
  const recheckOf = new Map<string, RecheckRequest>();
  for (const r of requestsInView) recheckOf.set(sheetOfEvaluation.get(r.evaluationId) as string, r);

  const facts: Facts[] = roster.rows.map((r) => {
    const evaluation = (r.sheetId ? evaluationOf.get(r.sheetId) : null) ?? null;
    return {
      r,
      evaluation,
      edits: r.sheetId ? (editsOf.get(r.sheetId) ?? 0) : 0,
      item: (r.sheetId ? itemOf.get(r.sheetId) : null) ?? null,
      request: (r.sheetId ? recheckOf.get(r.sheetId) : null) ?? null,
      result: (r.sheetId ? resultOf.get(r.sheetId) : null) ?? (r.studentId ? resultOf.get(`student:${r.studentId}`) : null) ?? null,
      marks: evaluation?.status === "Success" ? num(evaluation.totalScore) : null,
    };
  });

  // Totals and every filter's count, in one pass.
  const t = { evaluated: 0, evaluationFailed: 0, evaluationPending: 0, evaluatorEdited: 0, crossChecked: 0, crossCheckPending: 0, crossCheckRevised: 0, published: 0, passed: 0, failed: 0 };
  const filterCounts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0])) as Record<FilterKey, number>;
  let sum = 0;
  let marked = 0;
  let highest: number | null = null;
  let lowest: number | null = null;
  for (const f of facts) {
    for (const k of FILTER_KEYS) if (FILTERS[k](f)) filterCounts[k]++;
    const ai = f.evaluation?.status;
    if (ai === "Success") t.evaluated++;
    else if (ai === "Failed") t.evaluationFailed++;
    else if (f.r.state === "UPLOADED") t.evaluationPending++;
    if (f.edits) t.evaluatorEdited++;
    if (f.item) {
      if (f.item.status === CROSS_CHECK_ITEM_STATUS.PENDING) t.crossCheckPending++;
      else t.crossChecked++;
      if (f.item.status === CROSS_CHECK_ITEM_STATUS.CHANGED) t.crossCheckRevised++;
    }
    if (f.result) {
      t.published++;
      if (f.result.resultStatus === "PASS") t.passed++;
      else if (f.result.resultStatus === "FAIL") t.failed++;
    }
    if (f.marks != null) {
      marked++;
      sum += f.marks;
      highest = highest == null ? f.marks : Math.max(highest, f.marks);
      lowest = lowest == null ? f.marks : Math.min(lowest, f.marks);
    }
  }
  const summary = {
    students: facts.length,
    uploaded: roster.counts.uploaded,
    absent: roster.counts.absent,
    notUploaded: roster.counts.pending,
    poorScans: roster.counts.poorScans,
    ...t,
    rechecks: requestsInView.length,
    rechecksOpen: requestsInView.filter((r) => OPEN_RECHECK.includes(r.status)).length,
    rechecksChanged: requestsInView.filter((r) => {
      const a = assignmentOf.get(r.requestId);
      return r.status === "Completed" && moved(a?.previousScore, a?.revisedScore);
    }).length,
    average: marked ? num(sum / marked) : null,
    highest,
    lowest,
  };

  // Filter, search, order (section by section, then roll number), page.
  const test = FILTERS[filter];
  const matching = facts
    .filter((f) => test(f) && (!search || `${f.r.name} ${f.r.rollNo}`.toLowerCase().includes(search)))
    .sort(
      (a, b) =>
        (sectionOrder.get(sectionKey(a.r.sectionId)) ?? sectionOrder.size) - (sectionOrder.get(sectionKey(b.r.sectionId)) ?? sectionOrder.size) ||
        byRoll.compare(a.r.rollNo ?? "", b.r.rollNo ?? "") ||
        byRoll.compare(a.r.name ?? "", b.r.name ?? "")
    );
  const { limit } = pageOf(query);
  const totalPages = Math.max(1, Math.ceil(matching.length / limit));
  const page = Math.min(pageOf(query).page, totalPages);
  const onPage = matching.slice((page - 1) * limit, page * limit);

  // ── Pass 2: full, over the page only ──
  const pageSheets = onPage.map((f) => f.r.sheetId).filter(Boolean) as string[];
  const inPage = { [Op.in]: pageSheets };
  const [sheets, audits] = await Promise.all([
    pageSheets.length ? Scanner.findAll({ where: { sheetId: inPage }, attributes: ["sheetId", "uploadedBy"] }) : [],
    pageSheets.length
      ? MarksAudit.findAll({
          where: { sheetId: inPage, what: MARKS_CHANGE.STUDENT },
          attributes: ["sheetId", "source", "oldValue", "newValue", "details", "changedBy", "createdAt"],
          order: [["createdAt", "ASC"]],
        })
      : [],
  ]);
  const uploaderOf = new Map(sheets.map((s) => [s.sheetId, s.uploadedBy]));
  const auditsOf = new Map<string, MarksAudit[]>();
  for (const a of audits) {
    const list = auditsOf.get(a.sheetId as string);
    if (list) list.push(a);
    else auditsOf.set(a.sheetId as string, [a]);
  }

  const userIds = new Set<string>(
    [
      ...sheets.map((s) => s.uploadedBy),
      ...onPage.map((f) => f.r.absentMarkedBy),
      ...onPage.map((f) => (f.request ? assignmentOf.get(f.request.requestId)?.teacherId : null)),
      ...audits.map((a) => a.changedBy),
      ...scannersInView.map((s) => s.scannerId),
      ...evaluatorsInView.map((e) => e.teacherId),
      ...rounds.map((r) => r.checkerId),
    ].filter(Boolean) as string[]
  );
  const names = new Map(
    userIds.size ? (await UserModal.findAll({ where: { userId: { [Op.in]: [...userIds] } }, attributes: ["userId", "userName"] })).map((u) => [u.userId, u.userName]) : []
  );
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? "Someone") : null);

  const rows = onPage.map(({ r, evaluation, item, request, result, marks }) => {
    const sheetAudits = r.sheetId ? (auditsOf.get(r.sheetId) ?? []) : [];
    const evaluatorEdits = sheetAudits.filter((a) => a.source === MARKS_SOURCE.EVALUATION);
    const assignment = request ? assignmentOf.get(request.requestId) : null;
    // The AI's own marks: before anyone changed them.
    const firstChange = sheetAudits[0] ?? null;
    const aiMarks = evaluation?.status === "Success" || firstChange ? num(firstChange ? firstChange.oldValue : (item?.marksBefore ?? assignment?.previousScore ?? evaluation?.totalScore)) : null;
    const lastEdit = evaluatorEdits[evaluatorEdits.length - 1] ?? null;
    return {
      rollNo: r.rollNo,
      name: r.name,
      studentId: r.studentId,
      sectionId: r.sectionId,
      sectionName: r.sectionName,
      sheetId: r.sheetId,
      state: r.state,
      scan: {
        uploadedAt: r.uploadedAt,
        uploadedBy: nameOf(r.sheetId ? uploaderOf.get(r.sheetId) : null),
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
      marks,
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
    /** The section this report covers ("" = no section), or null for every section. */
    sectionId: only,
    /** Every section of the exam with its counts, whatever the report covers. */
    sections: roster.sections.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      students: s.counts.total,
      uploaded: s.counts.uploaded,
      absent: s.counts.absent,
      notUploaded: s.counts.pending,
      evaluated: s.counts.evaluated,
      poorScans: s.counts.poorScans,
    })),
    steps: timeline.steps,
    people: {
      scanners: scannersInView.map((s) => ({ name: nameOf(s.scannerId), section: sectionNameOf(s.sectionId), active: s.isActive, assignedAt: s.createdAt, completedAt: s.completedAt, unassignedAt: s.unassignedAt })),
      evaluators: evaluatorsInView.map((e) => ({ name: nameOf(e.teacherId), section: sectionNameOf(e.sectionId), active: e.isActive, assignedAt: e.createdAt, reviewedAt: e.reviewedAt, unassignedAt: e.unassignedAt })),
      crossCheckers: rounds.map((r) => ({ name: nameOf(r.checkerId), active: r.isActive, status: r.status, assignedAt: r.createdAt, completedAt: r.completedAt })),
    },
    summary,
    /** How many students in view each quick filter keeps (before the search). */
    filterCounts,
    /** The filter and search these rows answer. */
    filter,
    search,
    pagination: { total: matching.length, page, limit, totalPages },
    rows,
  };
}

export default { examReport };
