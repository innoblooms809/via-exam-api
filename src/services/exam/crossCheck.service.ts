/**
 * Cross-checking: a second teacher checks the marks of chosen answer sheets after the
 * exam's evaluator has confirmed them, before results are published.
 *
 *   The school's rule (Master Data → Cross-checking): off · every sheet ("all") · sheets by
 *   marks ("rules": below a percentage, at or above one, within some marks of the pass mark)
 *   · sheets the admin picks ("pick").
 *
 *   1. The evaluator marks the exam reviewed → it waits for its cross-check.
 *   2. The admin starts a round: the sheets the rule chooses (or the ones they pick) and a
 *      cross-checker who teaches the subject and isn't the evaluator. The checker is told.
 *   3. The checker confirms each sheet's marks, or changes them with a reason; changes go
 *      to the marks log (Marks & grading → Changes).
 *   4. The last sheet checked closes the round; the admins hear what changed, and results
 *      can be published.
 *
 * While the rule is on, results can't be published before the exam's round is done
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
import { settingsOf } from "../academic/instituteSettings.service";
import { logMarksChange } from "../academic/marks.service";
import { subjectTeacherIn } from "../academic/sessionSetup.service";
import { EXAM_INCLUDES, buildRoster, type RosterRow } from "./examRoster.service";
import { examLabel, instituteAdminIds, notifyAll } from "../notification/notifyPeople";

const clean = (v: unknown) => String(v ?? "").trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (score: number, total: number) => (total > 0 ? round2((score / total) * 100) : 0);

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
  all: () => "Every paper is cross-checked",
  below: (r) => `Below ${r?.below ?? "?"}%`,
  above: (r) => `At or above ${r?.above ?? "?"}%`,
  "near-pass": (r) => `Within ${r?.nearPass ?? "?"} marks of the pass mark`,
  picked: () => "Picked by the admin",
};

// ─── The rule, and what it chooses ────────────────────────────────────────────

const ruleOf = async (instituteId: string) => (await settingsOf(instituteId)).crossCheck;

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
}

/** Whether the rule is on, and each exam's active round with its counts. */
export const crossCheckStates = async (instituteId: string, examIds: string[]) => {
  const rule = await ruleOf(instituteId);
  const byExam = new Map<string, CrossCheckState>();
  if (rule.mode === "off" || !examIds.length) return { required: rule.mode !== "off", rule, byExam };
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
    });
  }
  return { required: true, rule, byExam };
};

/** Publishing waits for the cross-check while the school's rule is on. */
export const assertCrossCheckDone = async (exam: { instituteId: string; examId: string }) => {
  const { required, byExam } = await crossCheckStates(exam.instituteId, [exam.examId]);
  if (!required) return;
  const state = byExam.get(exam.examId);
  if (!state) {
    throw new ApiError(httpStatus.CONFLICT, "This exam needs its cross-check first. Choose the papers and a cross-checker under Exams → Cross-check.");
  }
  if (state.pending > 0) {
    throw new ApiError(httpStatus.CONFLICT, `The cross-check isn't finished yet: ${state.total - state.pending} of ${plural(state.total, "paper")} checked.`);
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
        title: "Cross-check stopped",
        message: `The evaluator reopened the marks of ${exam ? examLabel(exam) : "an exam"}, so its cross-check stopped. You'll be told if it starts again.`,
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

/** Exams whose marks the evaluator confirmed and whose results aren't out, plus every exam with a round. */
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
  const [exams, published, { byExam }] = await Promise.all([
    Exam.findAll({ where, include: EXAM_INCLUDES, order: [["examDate", "DESC"]] }),
    StudentResult.findAll({ where: { examId: { [Op.in]: examIds }, isDeleted: false }, attributes: ["examId"], group: ["examId"], raw: true }) as unknown as Promise<{ examId: string }[]>,
    crossCheckStates(instituteId, examIds),
  ]);
  const publishedSet = new Set(published.map((p) => p.examId));
  const roundOf = new Map(rounds.map((r) => [r.examId, r]));
  const evaluatorOf = new Map(reviewed.map((r) => [r.examId, r]));
  const names = await namesOf([...reviewed.map((r) => r.teacherId), ...rounds.map((r) => r.checkerId)]);
  const rows = await Promise.all(
    exams.map(async (exam: any) => {
      const round = roundOf.get(exam.examId) ?? null;
      const evaluator = evaluatorOf.get(exam.examId);
      // How many sheets the rule would choose now (before a round starts).
      let wouldChoose: number | null = null;
      let marked = 0;
      if (!round && rule.mode !== "off") {
        const rows = markedRows((await buildRoster(exam)).rows);
        marked = rows.length;
        wouldChoose = rule.mode === "pick" ? null : rows.filter((r) => reasonFor(r, exam, rule)).length;
      }
      return {
        examId: exam.examId,
        label: examLabel(exam),
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
    })
  );
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
      examType: exam.examType,
      sessionName: exam.session?.sessionName ?? "",
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      evaluator: evaluator ? { userId: evaluator.teacherId, name: names.get(evaluator.teacherId) ?? "", reviewedAt: evaluator.reviewedAt } : null,
    },
    rule,
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
  if (rule.mode === "off") throw new ApiError(httpStatus.BAD_REQUEST, "Cross-checking is off. Turn it on in Master Data → Cross-checking.");
  const exam = await loadExam(instituteId, examId);
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
    if (!chosen.length) throw new ApiError(httpStatus.BAD_REQUEST, "Pick at least one paper to cross-check.");
    if (chosen.length !== picked.size) throw new ApiError(httpStatus.BAD_REQUEST, "Some picked papers aren't this exam's marked answer sheets. Refresh and pick again.");
  } else {
    chosen = rows.flatMap((row) => {
      const reason = reasonFor(row, exam, rule);
      return reason ? [{ row, reason }] : [];
    });
  }

  const round = await sequelize.transaction(async (t) => {
    await Exam.findOne({ where: { examId: exam.examId }, transaction: t, lock: t.LOCK.UPDATE });
    if (await activeRound(exam.examId, t, true)) {
      throw new ApiError(httpStatus.CONFLICT, "This exam's cross-check has already started. Change its checker, or start it over.");
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
            title: "Papers to cross-check",
            message: `Cross-check ${plural(chosen.length, "answer sheet")} of ${examLabel(exam)}. Student names are hidden.`,
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
      ? `${plural(chosen.length, "paper")} sent to ${checker.userName} for cross-checking.`
      : "No paper matches the rule, so there is nothing to cross-check. The results can be published.",
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
    if (!round) throw new ApiError(httpStatus.NOT_FOUND, "This exam's cross-check hasn't started.");
    if (round.status !== "open") throw new ApiError(httpStatus.CONFLICT, "This exam's cross-check is already done.");
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
          title: "Papers to cross-check",
          message: `Cross-check ${plural(pending, "answer sheet")} of ${examLabel(exam)}. Student names are hidden.`,
          referenceId: exam.examId,
        },
        ...(before
          ? [{ instituteId, userId: before, type: "CROSS_CHECK_UNASSIGNED", title: "Cross-check reassigned", message: `The cross-check of ${examLabel(exam)} was given to another teacher.`, referenceId: exam.examId }]
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
  if (!round) throw new ApiError(httpStatus.NOT_FOUND, "This exam's cross-check hasn't started.");
  await round.update({ isActive: false });
  if (round.checkerId && round.status === "open") {
    await notifyAll([
      { instituteId: round.instituteId, userId: round.checkerId, type: "CROSS_CHECK_UNASSIGNED", title: "Cross-check stopped", message: `The admin started the cross-check of ${examLabel(exam)} over.`, referenceId: exam.examId },
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
  const evaluations = items.length ? await AIEvaluation.findAll({ where: { sheetId: { [Op.in]: items.map((i) => i.sheetId) } }, attributes: ["sheetId", "totalScore"] }) : [];
  const scoreOf = new Map(evaluations.map((e: any) => [e.sheetId, e.totalScore == null ? null : Number(e.totalScore)]));
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
            reasonText: REASON_TEXT[i.reason]?.((r.rule as CrossCheckRule) ?? null) ?? i.reason,
            marksBefore: i.marksBefore,
            currentMarks: scoreOf.get(i.sheetId) ?? null,
            marksAfter: i.marksAfter,
            status: i.status,
            note: i.note,
            checkedAt: i.checkedAt,
          };
        }),
      };
    }),
  };
};

/** { marks, note } — the cross-checker's verdict on one paper: the same marks, or new ones with a reason. */
const checkItem = async (teacher: any, itemId: string, body: any) => {
  const marksIn = Number(body?.marks);
  const note = clean(body?.note).slice(0, 1000);
  const outcome = await sequelize.transaction(async (t) => {
    const item = await CrossCheckItem.findOne({ where: { itemId: clean(itemId), instituteId: teacher.instituteId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!item) throw new ApiError(httpStatus.NOT_FOUND, "That paper isn't in a cross-check.");
    const round = await CrossCheckRound.findOne({ where: { roundId: item.roundId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!round?.isActive || round.status !== "open") throw new ApiError(httpStatus.CONFLICT, "This cross-check is closed.");
    if (round.checkerId !== teacher.userId) throw new ApiError(httpStatus.FORBIDDEN, "This paper is with another cross-checker.");
    if (item.status !== CROSS_CHECK_ITEM_STATUS.PENDING) throw new ApiError(httpStatus.CONFLICT, "You've already checked this paper.");
    const exam: any = await Exam.findOne({ where: { examId: item.examId }, include: EXAM_INCLUDES, transaction: t });
    if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
    if (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false }, transaction: t })) {
      throw new ApiError(httpStatus.CONFLICT, "This exam's results are already published.");
    }
    if (body?.marks === undefined || body?.marks === null || body?.marks === "" || !Number.isFinite(marksIn) || marksIn < 0 || marksIn > exam.totalMarks) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Marks must be between 0 and ${exam.totalMarks}.`);
    }
    const marks = round2(marksIn);
    const evaluation = await AIEvaluation.findOne({ where: { sheetId: item.sheetId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!evaluation) throw new ApiError(httpStatus.NOT_FOUND, "This paper has no marks to check.");
    const current = evaluation.totalScore == null ? null : Number(evaluation.totalScore);
    const before = item.marksBefore ?? current;
    const changed = before == null || Math.abs(marks - before) >= 0.005;
    if (changed && note.length < 3) throw new ApiError(httpStatus.BAD_REQUEST, "Say why the marks change; the admin and the evaluator see it.");

    if (current == null || Math.abs(marks - current) >= 0.005) {
      await evaluation.update({ totalScore: marks }, { transaction: t });
      await logMarksChange(
        {
          instituteId: exam.instituteId,
          what: MARKS_CHANGE.STUDENT,
          source: MARKS_SOURCE.CROSS_CHECK,
          changedBy: teacher.userId,
          oldValue: current,
          newValue: marks,
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
      { status: changed ? CROSS_CHECK_ITEM_STATUS.CHANGED : CROSS_CHECK_ITEM_STATUS.CONFIRMED, marksAfter: marks, note: note || null, checkedBy: teacher.userId, checkedAt: new Date() },
      { transaction: t }
    );

    // The last paper closes the round; the admins (and the evaluator) hear what changed.
    const left = await CrossCheckItem.count({ where: { roundId: round.roundId, status: CROSS_CHECK_ITEM_STATUS.PENDING }, transaction: t });
    if (left === 0) {
      await round.update({ status: "done", completedAt: new Date() }, { transaction: t });
      const all = await CrossCheckItem.findAll({ where: { roundId: round.roundId }, attributes: ["status"], transaction: t });
      const changedCount = all.filter((i) => i.status === CROSS_CHECK_ITEM_STATUS.CHANGED).length;
      const label = examLabel(exam);
      const summary = `${plural(all.length, "paper")} checked, ${changedCount ? `${plural(changedCount, "mark")} changed` : "no marks changed"}`;
      const evaluator = await EvaluationAssignment.findOne({ where: { examId: exam.examId, isActive: true }, transaction: t });
      await notifyAll(
        [
          ...(await instituteAdminIds(exam.instituteId, t)).map((userId) => ({
            instituteId: exam.instituteId,
            userId,
            type: "CROSS_CHECK_DONE",
            title: "Cross-check done",
            message: `Cross-check of ${label} is done: ${summary}. The results can be published.`,
            referenceId: exam.examId,
          })),
          ...(evaluator && evaluator.teacherId !== teacher.userId
            ? [{ instituteId: exam.instituteId, userId: evaluator.teacherId, type: "CROSS_CHECK_DONE", title: "Cross-check done", message: `The cross-check of ${label} is done: ${summary}.`, referenceId: exam.examId }]
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
