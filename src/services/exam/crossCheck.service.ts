/**
 * Cross-checking: a second teacher checks the marks of chosen answer sheets after the
 * exam's evaluator has confirmed them, before results are published.
 *
 *   The school's policy (Master Data → Cross-check policy): disabled · all answer sheets
 *   ("all") · score-based ("rules": below a percentage, at or above one, within some marks of
 *   the pass mark) · manual selection ("pick"); for every subject or only selected ones.
 *
 *   1. The evaluator marks the exam reviewed → it waits for its cross-check.
 *   2. The admin starts a round: the sheets the rule chooses (or the ones they pick) and a
 *      cross-checker who teaches the subject and isn't the evaluator. The checker is told.
 *   3. The checker confirms each sheet's marks, or changes them with a reason; changes go
 *      to the marks log (Marks & grading → Changes). On the evaluation screen they may also run
 *      the AI again and change question-wise marks: a draft on the item until their verdict
 *      (evaluation/crossCheckDraft.service), which then goes live question by question.
 *   4. The last sheet checked closes the round; the admins hear what changed, and results
 *      can be published.
 *
 * While the policy covers an exam's subject, results can't be published before its round is done
 * (assertCrossCheckDone), and only the cross-checker changes the marks of a sheet in an
 * open round (sheetHeldForCrossCheck).
 */

import httpStatus from "http-status";
import { Op, Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import StudentResult from "../../models/StudentResult.model";
import { CROSS_CHECK_ITEM_STATUS, CROSS_CHECK_REASON, CrossCheckItem, CrossCheckRound, type CrossCheckReason } from "../../models/CrossCheck.model";
import type { CrossCheckRule } from "../../models/InstituteSettings.model";
import { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import ApiError from "../../utils/ApiError";
import { newId } from "../../utils/idGenerator";
import { specialisesIn } from "../../utils/specialization";
import { crossCheckCovers, settingsOf } from "../academic/instituteSettings.service";
import { logMarksChange } from "../academic/marks.service";
import { subjectTeacherIn } from "../academic/sessionSetup.service";
import { EXAM_INCLUDES, buildRoster, type RosterRow } from "./examRoster.service";
import { examLabel, instituteAdminIds, notifyAll } from "../notification/notifyPeople";
import { questionChanges } from "../../utils/questionMarks";

const clean = (v: unknown) => String(v ?? "").trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (score: number, total: number) => (total > 0 ? round2((score / total) * 100) : 0);

/** Runs `fn` over `items`, at most `limit` at a time: each roster is a heavy set of queries. */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const maskName = (value: unknown) =>
  String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 1 ? "*" : `${w[0]}${"*".repeat(w.length - 1)}`))
    .join(" ");
const maskRoll = (value: unknown) => {
  const roll = clean(value);
  return roll.length <= 1 ? (roll ? "*" : "") : `${roll[0]}${"*".repeat(roll.length - 1)}`;
};

const REASON_TEXT: Record<CrossCheckReason, (rule: CrossCheckRule | null) => string> = {
  all: () => "Full review: all answer sheets",
  below: (r) => `Score below ${r?.below ?? "?"}%`,
  above: (r) => `Score at or above ${r?.above ?? "?"}%`,
  "near-pass": (r) => `Within ${r?.nearPass ?? "?"} marks of the pass mark`,
  picked: () => "Manually selected by the admin",
};

// ─── The rule, and what it chooses ────────────────────────────────────────────

const ruleOf = async (instituteId: string) => (await settingsOf(instituteId)).crossCheck;

/** Why a sheet is in the round, in words ("Below 33%"). */
export const reasonTextOf = (item: CrossCheckItem, round: CrossCheckRound) =>
  REASON_TEXT[item.reason]?.((round.rule as CrossCheckRule) ?? null) ?? item.reason;

/** The checker's draft, when they have re-evaluated (or the AI is at it). */
const draftOfItem = (item: CrossCheckItem) => {
  const d = item.draft;
  return d && (d.evaluations?.length || d.status === "Pending") ? d : null;
};

/** Sheets with marks (uploaded and evaluated). */
const markedRows = (rows: RosterRow[]) => rows.filter((r) => r.state === "UPLOADED" && r.sheetId && r.evaluationStatus === "Success" && r.score != null);

/** Why the rule sends a sheet to cross-checking, or null. */
const reasonFor = (row: RosterRow, exam: any, rule: CrossCheckRule): CrossCheckReason | null => {
  if (rule.mode === "all") return CROSS_CHECK_REASON.ALL;
  if (rule.mode !== "rules" || row.score == null) return null;
  const p = pct(Number(row.score), exam.totalMarks);
  if (rule.below != null && p < rule.below) return CROSS_CHECK_REASON.BELOW;
  if (rule.above != null && p >= rule.above) return CROSS_CHECK_REASON.ABOVE;
  if (rule.nearPass != null && Math.abs(Number(row.score) - exam.passingMarks) <= rule.nearPass) return CROSS_CHECK_REASON.NEAR_PASS;
  return null;
};

const loadExam = async (instituteId: string, examId: string) => {
  const exam: any = await Exam.findOne({ where: { examId: clean(examId), instituteId, isDeleted: false }, include: EXAM_INCLUDES });
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
  return exam;
};

const activeRound = (examId: string, transaction?: Transaction, lock = false) =>
  CrossCheckRound.findOne({ where: { examId, isActive: true }, transaction, ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}) });

const namesOf = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map<string, string>();
  const users = await UserModal.findAll({ where: { userId: { [Op.in]: list } }, attributes: ["userId", "userName"] });
  return new Map(users.map((u) => [u.userId, u.userName]));
};

// ─── State, for the exam list and the publish gate ────────────────────────────

export interface CrossCheckState {
  roundId: string;
  status: string;
  checkerId: string | null;
  total: number;
  pending: number;
  changed: number;
  startedAt: Date;
  completedAt: Date | null;
}

/** The policy, whether it covers a subject, and each exam's active round with its counts. */
export const crossCheckStates = async (instituteId: string, examIds: string[]) => {
  const rule = await ruleOf(instituteId);
  const covers = (subjectId: string | null | undefined) => crossCheckCovers(rule, subjectId);
  const byExam = new Map<string, CrossCheckState>();
  if (rule.mode === "off" || !examIds.length) return { covers, rule, byExam };
  const rounds = await CrossCheckRound.findAll({ where: { examId: { [Op.in]: examIds }, isActive: true } });
  const items = rounds.length ? await CrossCheckItem.findAll({ where: { roundId: { [Op.in]: rounds.map((r) => r.roundId) } }, attributes: ["roundId", "status"] }) : [];
  for (const r of rounds) {
    const mine = items.filter((i) => i.roundId === r.roundId);
    byExam.set(r.examId, {
      roundId: r.roundId,
      status: r.status,
      checkerId: r.checkerId,
      total: mine.length,
      pending: mine.filter((i) => i.status === CROSS_CHECK_ITEM_STATUS.PENDING).length,
      changed: mine.filter((i) => i.status === CROSS_CHECK_ITEM_STATUS.CHANGED).length,
      startedAt: r.createdAt,
      completedAt: r.completedAt,
    });
  }
  return { covers, rule, byExam };
};

/** Publishing waits for the cross-check while the policy covers the exam's subject. */
export const assertCrossCheckDone = async (exam: { instituteId: string; examId: string; subjectId: string }) => {
  const { covers, byExam } = await crossCheckStates(exam.instituteId, [exam.examId]);
  if (!covers(exam.subjectId)) return;
  const state = byExam.get(exam.examId);
  if (!state) {
    throw new ApiError(httpStatus.CONFLICT, "This exam requires a cross-check before results are published. Assign one under Exams → Evaluation → Cross-check.");
  }
  if (state.pending > 0) {
    throw new ApiError(httpStatus.CONFLICT, `The cross-check is in progress: ${state.total - state.pending} of ${plural(state.total, "answer sheet")} verified.`);
  }
};

/** A sheet in an open round: only its cross-checker (or an admin) changes its marks. */
export const sheetHeldForCrossCheck = async (sheetId: string) => {
  const item = await CrossCheckItem.findOne({ where: { sheetId, status: CROSS_CHECK_ITEM_STATUS.PENDING }, order: [["id", "DESC"]] });
  if (!item) return null;
  const round = await CrossCheckRound.findOne({ where: { roundId: item.roundId, isActive: true, status: "open" } });
  return round ? { item, round } : null;
};

/** The evaluator reopened the marks: the cross-check starts over once they confirm again. */
export const closeRoundForReopen = async (examId: string) => {
  const round = await activeRound(examId);
  if (!round) return;
  await round.update({ isActive: false });
  if (round.checkerId && round.status === "open") {
    const exam: any = await Exam.findOne({ where: { examId }, include: EXAM_INCLUDES });
    await notifyAll([
      {
        instituteId: round.instituteId,
        userId: round.checkerId,
        type: "CROSS_CHECK_UNASSIGNED",
        title: "Cross-check cancelled",
        message: `The evaluator reopened the marks of ${exam ? examLabel(exam) : "an exam"}, so its cross-check was cancelled. You will be notified if it is assigned again.`,
        referenceId: examId,
      },
    ]).catch(() => undefined);
  }
};

// ─── Who can cross-check ──────────────────────────────────────────────────────

/** Teachers of the subject (its teacher this session, or who teach it), not the exam's evaluator. */
const eligibleCheckers = async (exam: any, evaluatorId: string | null) => {
  const teacherRole = await Role.findOne({ where: { role: "TEACHER" }, attributes: ["id"] });
  const [teachers, subjectTeacher, open] = await Promise.all([
    UserModal.findAll({
      where: { instituteId: exam.instituteId, roleId: teacherRole?.id ?? -1, status: 1, isDeleted: false },
      attributes: ["userId", "userName"],
      include: [{ association: "teacherProfile", attributes: ["specialization"], required: false }],
      order: [["userName", "ASC"]],
    }),
    subjectTeacherIn(exam.sessionId, exam.subjectId),
    CrossCheckRound.findAll({ where: { instituteId: exam.instituteId, isActive: true, status: "open" }, attributes: ["checkerId"] }),
  ]);
  const subjectName = exam.subject?.subjectName ?? "";
  const load = new Map<string, number>();
  for (const r of open) if (r.checkerId) load.set(r.checkerId, (load.get(r.checkerId) ?? 0) + 1);
  return teachers
    .filter((t: any) => t.userId !== evaluatorId && (t.userId === subjectTeacher || specialisesIn(t.teacherProfile?.specialization, subjectName)))
    .map((t: any) => ({ userId: t.userId, userName: t.userName, isSubjectTeacher: t.userId === subjectTeacher, isPaperSetter: t.userId === exam.teacherId, openRounds: load.get(t.userId) ?? 0 }));
};

// ─── Admin: exams to cross-check ──────────────────────────────────────────────

const summaryOf = (round: CrossCheckRound | null, state: CrossCheckState | undefined, names: Map<string, string>) =>
  round && state
    ? {
        roundId: round.roundId,
        mode: round.mode,
        status: round.status,
        checker: round.checkerId ? { userId: round.checkerId, name: names.get(round.checkerId) ?? "" } : null,
        total: state.total,
        pending: state.pending,
        changed: state.changed,
        startedAt: round.createdAt,
        completedAt: round.completedAt,
      }
    : null;

/** Exams of covered subjects whose marks the evaluator confirmed, plus every exam with a round. */
const listExams = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const rule = await ruleOf(instituteId);
  const [reviewed, rounds] = await Promise.all([
    EvaluationAssignment.findAll({ where: { instituteId, isActive: true, reviewedAt: { [Op.ne]: null } }, attributes: ["examId", "teacherId", "reviewedAt"] }),
    CrossCheckRound.findAll({ where: { instituteId, isActive: true } }),
  ]);
  const examIds = [...new Set([...reviewed.map((r) => r.examId), ...rounds.map((r) => r.examId)])];
  if (!examIds.length) return { rule, exams: [] };
  const where: any = { instituteId, isDeleted: false, examId: { [Op.in]: examIds } };
  if (clean(query?.sessionId)) where.sessionId = clean(query.sessionId);
  const [all, published, { byExam }] = await Promise.all([
    Exam.findAll({ where, include: EXAM_INCLUDES, order: [["examDate", "DESC"]] }),
    StudentResult.findAll({ where: { examId: { [Op.in]: examIds }, isDeleted: false }, attributes: ["examId"], group: ["examId"], raw: true }) as unknown as Promise<{ examId: string }[]>,
    crossCheckStates(instituteId, examIds),
  ]);
  const publishedSet = new Set(published.map((p) => p.examId));
  const roundOf = new Map(rounds.map((r) => [r.examId, r]));
  // Exams of subjects outside the policy stay out, unless they already have a round.
  const exams = (all as any[]).filter((e) => roundOf.has(e.examId) || crossCheckCovers(rule, e.subjectId));
  const evaluatorOf = new Map(reviewed.map((r) => [r.examId, r]));
  const names = await namesOf([...reviewed.map((r) => r.teacherId), ...rounds.map((r) => r.checkerId)]);
  // Only exams that can still start need the "how many would be chosen" count, and the
  // rosters behind it are loaded a few at a time.
  const rows = await mapLimit(exams, 4, async (exam: any) => {
      const round = roundOf.get(exam.examId) ?? null;
      const evaluator = evaluatorOf.get(exam.examId);
      // How many sheets the rule would choose now (before a round starts).
      let wouldChoose: number | null = null;
      let marked = 0;
      if (!round && rule.mode !== "off" && !publishedSet.has(exam.examId)) {
        const rows = markedRows((await buildRoster(exam)).rows);
        marked = rows.length;
        wouldChoose = rule.mode === "pick" ? null : rows.filter((r) => reasonFor(r, exam, rule)).length;
      }
      return {
        examId: exam.examId,
        label: examLabel(exam),
        subjectId: exam.subjectId,
        subjectName: exam.subject?.subjectName ?? "",
        className: exam.class?.className ?? "",
        sectionName: exam.section?.sectionName ?? "",
        examType: exam.examType,
        sessionId: exam.sessionId,
        sessionName: exam.session?.sessionName ?? "",
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        evaluator: evaluator ? { userId: evaluator.teacherId, name: names.get(evaluator.teacherId) ?? "", reviewedAt: evaluator.reviewedAt } : null,
        published: publishedSet.has(exam.examId),
        markedSheets: marked,
        wouldChoose,
        round: summaryOf(round, byExam.get(exam.examId), names),
      };
  });
  return { rule, exams: rows };
};

/** One exam: the sheets with marks (what the rule chooses), its round and items, who can check. */
const examDetail = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const exam = await loadExam(instituteId, examId);
  const [rule, evaluator, round, roster] = await Promise.all([
    ruleOf(instituteId),
    EvaluationAssignment.findOne({ where: { examId: exam.examId, isActive: true } }),
    activeRound(exam.examId),
    buildRoster(exam),
  ]);
  const items = round ? await CrossCheckItem.findAll({ where: { roundId: round.roundId }, order: [["id", "ASC"]] }) : [];
  const rows = markedRows(roster.rows);
  const rowOf = new Map(rows.map((r) => [r.sheetId as string, r]));
  const names = await namesOf([evaluator?.teacherId, round?.checkerId, ...items.map((i) => i.checkedBy)]);
  const { byExam } = await crossCheckStates(instituteId, [exam.examId]);
  return {
    exam: {
      examId: exam.examId,
      label: examLabel(exam),
      subjectName: exam.subject?.subjectName ?? "",
      examType: exam.examType,
      sessionName: exam.session?.sessionName ?? "",
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      evaluator: evaluator ? { userId: evaluator.teacherId, name: names.get(evaluator.teacherId) ?? "", reviewedAt: evaluator.reviewedAt } : null,
    },
    rule,
    /** Whether the policy covers this exam's subject. */
    covered: crossCheckCovers(rule, exam.subjectId),
    sheets: rows.map((r) => ({
      sheetId: r.sheetId,
      studentId: r.studentId,
      name: r.name,
      rollNo: r.rollNo,
      marks: r.score,
      percentage: pct(Number(r.score), exam.totalMarks),
      chosenBy: rule.mode === "off" || rule.mode === "pick" ? null : reasonFor(r, exam, rule),
    })),
    round: summaryOf(round, byExam.get(exam.examId), names),
    items: items.map((i) => {
      const row = rowOf.get(i.sheetId);
      return {
        itemId: i.itemId,
        sheetId: i.sheetId,
        name: row?.name ?? "",
        rollNo: row?.rollNo ?? "",
        reason: i.reason,
        reasonText: REASON_TEXT[i.reason]?.((round?.rule as CrossCheckRule) ?? null) ?? i.reason,
        marksBefore: i.marksBefore,
        marksAfter: i.marksAfter,
        currentMarks: row?.score ?? null,
        status: i.status,
        note: i.note,
        checkedBy: i.checkedBy ? names.get(i.checkedBy) ?? "" : null,
        checkedAt: i.checkedAt,
      };
    }),
    checkers: await eligibleCheckers(exam, evaluator?.teacherId ?? null),
  };
};

/** { checkerId, sheetIds? } — sheetIds when the school picks papers itself. */
const startRound = async (admin: any, examId: string, body: any) => {
  const instituteId = admin.instituteId;
  const rule = await ruleOf(instituteId);
  if (rule.mode === "off") throw new ApiError(httpStatus.BAD_REQUEST, "Cross-check is disabled. Enable it in Master Data → Cross-check policy.");
  const exam = await loadExam(instituteId, examId);
  if (!crossCheckCovers(rule, exam.subjectId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${exam.subject?.subjectName ?? "This subject"} isn't covered by the cross-check policy. Add it in Master Data → Cross-check policy.`);
  }
  const evaluator = await EvaluationAssignment.findOne({ where: { examId: exam.examId, isActive: true } });
  if (!evaluator?.reviewedAt) throw new ApiError(httpStatus.CONFLICT, "The evaluator hasn't confirmed this exam's marks yet.");
  if (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false } })) {
    throw new ApiError(httpStatus.CONFLICT, "This exam's results are already published.");
  }

  const checkerId = clean(body?.checkerId);
  const checkers = await eligibleCheckers(exam, evaluator.teacherId);
  const checker = checkers.find((c) => c.userId === checkerId);
  if (!checker) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Choose a cross-checker who teaches ${exam.subject?.subjectName ?? "the subject"} and isn't the exam's evaluator.`);
  }

  const rows = markedRows((await buildRoster(exam)).rows);
  let chosen: { row: RosterRow; reason: CrossCheckReason }[];
  if (rule.mode === "pick") {
    const picked = new Set((Array.isArray(body?.sheetIds) ? body.sheetIds : []).map(clean).filter(Boolean));
    chosen = rows.filter((r) => picked.has(r.sheetId as string)).map((row) => ({ row, reason: CROSS_CHECK_REASON.PICKED }));
    if (!chosen.length) throw new ApiError(httpStatus.BAD_REQUEST, "Select at least one answer sheet to cross-check.");
    if (chosen.length !== picked.size) throw new ApiError(httpStatus.BAD_REQUEST, "Some selected answer sheets aren't evaluated sheets of this exam. Refresh and select again.");
  } else {
    chosen = rows.flatMap((row) => {
      const reason = reasonFor(row, exam, rule);
      return reason ? [{ row, reason }] : [];
    });
  }

  const round = await sequelize.transaction(async (t) => {
    await Exam.findOne({ where: { examId: exam.examId }, transaction: t, lock: t.LOCK.UPDATE });
    if (await activeRound(exam.examId, t, true)) {
      throw new ApiError(httpStatus.CONFLICT, "This exam's cross-check is already assigned. Reassign the cross-checker, or restart it.");
    }
    const created = await CrossCheckRound.create(
      {
        roundId: newId("crossCheckRound"),
        instituteId,
        examId: exam.examId,
        mode: rule.mode,
        rule: { below: rule.below, above: rule.above, nearPass: rule.nearPass },
        checkerId: checker.userId,
        assignedBy: admin.userId,
        // Nothing chosen: nothing to check, so the cross-check is done at once.
        status: chosen.length ? "open" : "done",
        completedAt: chosen.length ? null : new Date(),
      },
      { transaction: t }
    );
    if (chosen.length) {
      await CrossCheckItem.bulkCreate(
        chosen.map(({ row, reason }) => ({
          itemId: newId("crossCheckItem"),
          roundId: created.roundId,
          instituteId,
          examId: exam.examId,
          sheetId: row.sheetId as string,
          evaluationId: row.evaluationId,
          studentId: row.studentId,
          reason,
          marksBefore: row.score,
        })),
        { transaction: t }
      );
      await notifyAll(
        [
          {
            instituteId,
            userId: checker.userId,
            type: "CROSS_CHECK_ASSIGNED",
            title: "Cross-check assigned",
            message: `Verify the marks of ${plural(chosen.length, "answer sheet")} in ${examLabel(exam)}. Student identities are masked.`,
            referenceId: exam.examId,
          },
        ],
        t
      );
    }
    return created;
  });

  return {
    roundId: round.roundId,
    chosen: chosen.length,
    message: chosen.length
      ? `${plural(chosen.length, "answer sheet")} assigned to ${checker.userName} for cross-check.`
      : "No answer sheet meets the selection criteria, so no cross-check is required. Results can be published.",
  };
};

/** { checkerId } — another cross-checker takes over the unchecked papers. */
const changeChecker = async (admin: any, examId: string, body: any) => {
  const instituteId = admin.instituteId;
  const exam = await loadExam(instituteId, examId);
  const evaluator = await EvaluationAssignment.findOne({ where: { examId: exam.examId, isActive: true } });
  const checker = (await eligibleCheckers(exam, evaluator?.teacherId ?? null)).find((c) => c.userId === clean(body?.checkerId));
  if (!checker) throw new ApiError(httpStatus.BAD_REQUEST, `Choose a cross-checker who teaches ${exam.subject?.subjectName ?? "the subject"} and isn't the exam's evaluator.`);
  const previous = await sequelize.transaction(async (t) => {
    const round = await activeRound(exam.examId, t, true);
    if (!round) throw new ApiError(httpStatus.NOT_FOUND, "No cross-check is assigned for this exam.");
    if (round.status !== "open") throw new ApiError(httpStatus.CONFLICT, "This exam's cross-check is already completed.");
    const before = round.checkerId;
    if (before === checker.userId) return null;
    await round.update({ checkerId: checker.userId }, { transaction: t });
    const pending = await CrossCheckItem.count({ where: { roundId: round.roundId, status: CROSS_CHECK_ITEM_STATUS.PENDING }, transaction: t });
    await notifyAll(
      [
        {
          instituteId,
          userId: checker.userId,
          type: "CROSS_CHECK_ASSIGNED",
          title: "Cross-check assigned",
          message: `Verify the marks of ${plural(pending, "answer sheet")} in ${examLabel(exam)}. Student identities are masked.`,
          referenceId: exam.examId,
        },
        ...(before
          ? [{ instituteId, userId: before, type: "CROSS_CHECK_UNASSIGNED", title: "Cross-check reassigned", message: `The cross-check of ${examLabel(exam)} was reassigned to another teacher.`, referenceId: exam.examId }]
          : []),
      ],
      t
    );
    return before;
  });
  return { examId: exam.examId, checkerId: checker.userId, previous };
};

/** Starts the exam's cross-check over: the round closes (its record stays); marks already changed stay. */
const resetRound = async (admin: any, examId: string) => {
  const exam = await loadExam(admin.instituteId, examId);
  if (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false } })) {
    throw new ApiError(httpStatus.CONFLICT, "This exam's results are already published.");
  }
  const round = await activeRound(exam.examId);
  if (!round) throw new ApiError(httpStatus.NOT_FOUND, "No cross-check is assigned for this exam.");
  await round.update({ isActive: false });
  if (round.checkerId && round.status === "open") {
    await notifyAll([
      { instituteId: round.instituteId, userId: round.checkerId, type: "CROSS_CHECK_UNASSIGNED", title: "Cross-check cancelled", message: `The admin restarted the cross-check of ${examLabel(exam)}; your assignment was withdrawn.`, referenceId: exam.examId },
    ]).catch(() => undefined);
  }
  return { examId: exam.examId };
};

// ─── Cross-checker ────────────────────────────────────────────────────────────

/** My rounds: open ones to work on, or done ones. Student identities are hidden. */
const myRounds = async (teacher: any, query: any) => {
  const state = clean(query?.state) === "done" ? "done" : "open";
  const rounds = await CrossCheckRound.findAll({
    where: { instituteId: teacher.instituteId, checkerId: teacher.userId, isActive: true, status: state },
    order: [["createdAt", "DESC"]],
    limit: 50,
  });
  if (!rounds.length) return { rounds: [] };
  const [exams, items] = await Promise.all([
    Exam.findAll({ where: { examId: { [Op.in]: rounds.map((r) => r.examId) } }, include: EXAM_INCLUDES }),
    CrossCheckItem.findAll({ where: { roundId: { [Op.in]: rounds.map((r) => r.roundId) } }, order: [["id", "ASC"]] }),
  ]);
  const evaluations = items.length ? await AIEvaluation.findAll({ where: { sheetId: { [Op.in]: items.map((i) => i.sheetId) } }, attributes: ["sheetId", "totalScore", "evaluations"] }) : [];
  const scoreOf = new Map(evaluations.map((e: any) => [e.sheetId, e.totalScore == null ? null : Number(e.totalScore)]));
  const evaluationOf = new Map(evaluations.map((e: any) => [e.sheetId, e]));
  const examOf = new Map(exams.map((e: any) => [e.examId, e]));
  const rosters = new Map<string, Map<string, RosterRow>>();
  for (const exam of exams as any[]) rosters.set(exam.examId, new Map((await buildRoster(exam)).rows.filter((r) => r.sheetId).map((r) => [r.sheetId as string, r])));
  return {
    rounds: rounds.map((r) => {
      const exam: any = examOf.get(r.examId);
      const mine = items.filter((i) => i.roundId === r.roundId);
      return {
        roundId: r.roundId,
        examId: r.examId,
        label: exam ? examLabel(exam) : "",
        // For the teacher's session / exam / class / subject filters.
        sessionId: exam?.sessionId ?? null,
        sessionName: exam?.session?.sessionName ?? "",
        examType: exam?.examType ?? "",
        className: exam?.class?.className ?? "",
        sectionName: exam?.section?.sectionName ?? "",
        subjectName: exam?.subject?.subjectName ?? "",
        totalMarks: exam?.totalMarks ?? null,
        passingMarks: exam?.passingMarks ?? null,
        status: r.status,
        startedAt: r.createdAt,
        completedAt: r.completedAt,
        items: mine.map((i, n) => {
          const row = rosters.get(r.examId)?.get(i.sheetId);
          return {
            itemId: i.itemId,
            sheetId: i.sheetId,
            // Hidden like the evaluator's view: "Paper 3 · R**** S*****".
            paper: n + 1,
            name: maskName(row?.name),
            rollNo: maskRoll(row?.rollNo),
            reasonText: reasonTextOf(i, r),
            marksBefore: i.marksBefore,
            currentMarks: scoreOf.get(i.sheetId) ?? null,
            marksAfter: i.marksAfter,
            status: i.status,
            note: i.note,
            checkedAt: i.checkedAt,
            ...draftSummary(i, evaluationOf.get(i.sheetId)),
          };
        }),
      };
    }),
  };
};

/** The checker's re-evaluation of a pending sheet (from the evaluation screen), or what their verdict changed. */
const draftSummary = (item: CrossCheckItem, evaluation: any) => {
  if (item.status !== CROSS_CHECK_ITEM_STATUS.PENDING) return { draftScore: null, aiStatus: null, changes: item.changes ?? [] };
  const draft = draftOfItem(item);
  return {
    draftScore: draft?.totalScore ?? null,
    aiStatus: draft?.status ?? null,
    changes: draft?.evaluations?.length ? questionChanges(evaluation?.evaluations, draft.evaluations) : [],
  };
};

/**
 * { marks, note } — the cross-checker's verdict on one paper: the same marks, or new ones with a
 * reason. When they re-evaluated on the evaluation screen, the verdict is that draft (its
 * question-wise marks and total), and it goes live question by question.
 */
const checkItem = async (teacher: any, itemId: string, body: any) => {
  const note = clean(body?.note).slice(0, 1000);
  const outcome = await sequelize.transaction(async (t) => {
    const item = await CrossCheckItem.findOne({ where: { itemId: clean(itemId), instituteId: teacher.instituteId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!item) throw new ApiError(httpStatus.NOT_FOUND, "This answer sheet isn't part of a cross-check.");
    const round = await CrossCheckRound.findOne({ where: { roundId: item.roundId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!round?.isActive || round.status !== "open") throw new ApiError(httpStatus.CONFLICT, "This cross-check is closed.");
    if (round.checkerId !== teacher.userId) throw new ApiError(httpStatus.FORBIDDEN, "This answer sheet is assigned to another cross-checker.");
    if (item.status !== CROSS_CHECK_ITEM_STATUS.PENDING) throw new ApiError(httpStatus.CONFLICT, "You have already verified this answer sheet.");
    const exam: any = await Exam.findOne({ where: { examId: item.examId }, include: EXAM_INCLUDES, transaction: t });
    if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
    if (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false }, transaction: t })) {
      throw new ApiError(httpStatus.CONFLICT, "This exam's results are already published.");
    }
    const draft = draftOfItem(item);
    if (draft?.status === "Pending") throw new ApiError(httpStatus.CONFLICT, "The AI is still re-evaluating this sheet. Give your verdict once it has finished.");
    const marksIn = draft ? Number(draft.totalScore) : Number(body?.marks);
    if ((!draft && (body?.marks === undefined || body?.marks === null || body?.marks === "")) || !Number.isFinite(marksIn) || marksIn < 0 || marksIn > exam.totalMarks) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Marks must be between 0 and ${exam.totalMarks}.`);
    }
    const marks = round2(marksIn);
    const evaluation = await AIEvaluation.findOne({ where: { sheetId: item.sheetId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!evaluation) throw new ApiError(httpStatus.NOT_FOUND, "This answer sheet has no marks to verify.");
    const current = evaluation.totalScore == null ? null : Number(evaluation.totalScore);
    const before = item.marksBefore ?? current;
    const changes = draft ? questionChanges(evaluation.evaluations, draft.evaluations) : [];
    const changed = before == null || Math.abs(marks - before) >= 0.005 || changes.length > 0;
    if (changed && note.length < 3) throw new ApiError(httpStatus.BAD_REQUEST, "Give a reason for the revision; the admin and the evaluator can see it.");

    if (current == null || Math.abs(marks - current) >= 0.005 || changes.length) {
      await evaluation.update(
        draft ? { evaluations: draft.evaluations, totalScore: marks, feedback: draft.feedback ?? evaluation.feedback } : { totalScore: marks },
        { transaction: t }
      );
      await logMarksChange(
        {
          instituteId: exam.instituteId,
          what: MARKS_CHANGE.STUDENT,
          source: MARKS_SOURCE.CROSS_CHECK,
          changedBy: teacher.userId,
          oldValue: current,
          newValue: marks,
          details: changes,
          reason: note || "Cross-check",
          sessionId: exam.sessionId,
          examType: exam.examType,
          examId: exam.examId,
          subjectId: exam.subjectId,
          studentId: item.studentId,
          sheetId: item.sheetId,
        },
        t
      );
    }
    await item.update(
      {
        status: changed ? CROSS_CHECK_ITEM_STATUS.CHANGED : CROSS_CHECK_ITEM_STATUS.CONFIRMED,
        marksAfter: marks,
        note: note || null,
        changes: changes.length ? changes : null,
        checkedBy: teacher.userId,
        checkedAt: new Date(),
      },
      { transaction: t }
    );

    // The last paper closes the round; the admins (and the evaluator) hear what changed.
    const left = await CrossCheckItem.count({ where: { roundId: round.roundId, status: CROSS_CHECK_ITEM_STATUS.PENDING }, transaction: t });
    if (left === 0) {
      await round.update({ status: "done", completedAt: new Date() }, { transaction: t });
      const all = await CrossCheckItem.findAll({ where: { roundId: round.roundId }, attributes: ["status"], transaction: t });
      const changedCount = all.filter((i) => i.status === CROSS_CHECK_ITEM_STATUS.CHANGED).length;
      const label = examLabel(exam);
      const summary = `${plural(all.length, "answer sheet")} verified, ${changedCount ? plural(changedCount, "revision") : "no revisions"}`;
      const evaluator = await EvaluationAssignment.findOne({ where: { examId: exam.examId, isActive: true }, transaction: t });
      await notifyAll(
        [
          ...(await instituteAdminIds(exam.instituteId, t)).map((userId) => ({
            instituteId: exam.instituteId,
            userId,
            type: "CROSS_CHECK_DONE",
            title: "Cross-check completed",
            message: `The cross-check of ${label} is complete: ${summary}. Results can now be published.`,
            referenceId: exam.examId,
          })),
          ...(evaluator && evaluator.teacherId !== teacher.userId
            ? [{ instituteId: exam.instituteId, userId: evaluator.teacherId, type: "CROSS_CHECK_DONE", title: "Cross-check completed", message: `The cross-check of ${label} is complete: ${summary}.`, referenceId: exam.examId }]
            : []),
        ],
        t
      );
    }
    return { itemId: item.itemId, status: item.status, marks, roundDone: left === 0, left };
  });
  return outcome;
};

export default { listExams, examDetail, startRound, changeChecker, resetRound, myRounds, checkItem };
