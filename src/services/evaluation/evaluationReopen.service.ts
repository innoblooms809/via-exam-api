// ═════════════════════════════════════════════════════════════════════════════
// EVALUATOR ⇄ ADMIN — reopening marks the evaluator marked completed
// ═════════════════════════════════════════════════════════════════════════════
//
// Marking a section's evaluation completed hands its marks to the admin (cross-check, publishing).
// From then on the evaluator can't change them on their own: they ask the admin, with a reason,
// and the admin reopens the section (the same evaluator gets it back and marks it completed again)
// or declines with a note the evaluator sees. One open request per section.
//
// It fits the rest of the process:
//   • Published results: no request, no reopening. Marks then change only through a recheck.
//   • A cross-check holding the sheets: the evaluator can't ask (the sheets are with the
//     cross-checker). A request made before the cross-check started can still be approved, but only
//     once the admin confirms that the cross-check is cancelled; it starts again after the evaluator
//     marks the section completed again.
//   • The admin gives the section to another evaluator, or takes it away: its open request is
//     declined, saying so (settleReopenRequests).

import httpStatus from "http-status";
import { Op, type Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import ApiError from "../../utils/ApiError";
import { newId } from "../../utils/idGenerator";
import { invalidate } from "../../utils/memoCache";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import EvaluationReopenRequest, { EVAL_REOPEN_STATUS } from "../../models/EvaluationReopenRequest.model";
import { loadExam, sectionKey, sectionsOfExam } from "../exam/examRoster.service";
import { closeRoundForReopen, crossCheckStates } from "../exam/crossCheck.service";
import { instituteAdminIds, notifyAll, preview, workLabel } from "../notification/notifyPeople";
import { examLockStates } from "./evaluationLock.service";
import { isTeacherRequester } from "./evaluationAccess.service";

const clean = (v: unknown) => String(v ?? "").trim();

/** A request as the evaluator's and the admin's pages show it. */
export const reopenInfo = (r: EvaluationReopenRequest | null | undefined) =>
  r
    ? {
        requestId: r.requestId,
        status: r.status,
        reason: r.reason,
        sectionId: r.sectionId,
        requestedAt: r.createdAt,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
      }
    : null;

/** The evaluator's latest request for each of these exams, per section (key: `${examId}:${sectionKey}`). */
export const latestReopenRequests = async (teacherId: string, examIds: string[]) => {
  const found = new Map<string, EvaluationReopenRequest>();
  if (!examIds.length) return found;
  const rows = await EvaluationReopenRequest.findAll({ where: { teacherId, examId: { [Op.in]: examIds } }, order: [["createdAt", "DESC"]] });
  for (const r of rows) {
    const key = `${r.examId}:${sectionKey(r.sectionId)}`;
    if (!found.has(key)) found.set(key, r);
  }
  return found;
};

/** The dashboards count open requests: show a change at once. */
const refreshHomes = (instituteId: string, teacherId?: string) => {
  invalidate(`home:admin:${instituteId}`);
  if (teacherId) invalidate(`home:teacher:${instituteId}:${teacherId}:`);
};

/** Names of the sections of an exam, by section key. */
const sectionNames = async (exam: any) => new Map((await sectionsOfExam(exam)).map((s) => [sectionKey(s.sectionId), s.sectionName]));

/**
 * Declines the open requests of these sections (the admin gave them to another evaluator, or took
 * the evaluator off), with a note the evaluator sees. Part of the caller's transaction when given.
 */
export const settleReopenRequests = async (assignmentIds: string[], adminId: string, note: string, transaction?: Transaction) => {
  if (!assignmentIds.length) return 0;
  const [count] = await EvaluationReopenRequest.update(
    { status: EVAL_REOPEN_STATUS.REJECTED, decidedBy: adminId, decidedAt: new Date(), decisionNote: note },
    { where: { assignmentId: { [Op.in]: assignmentIds }, status: EVAL_REOPEN_STATUS.PENDING }, transaction }
  );
  return count;
};

/** Evaluator: asks the admin to reopen a section (`sectionId`) they marked completed. */
export const requestReopen = async (user: any, examId: string, body: any) => {
  if (!isTeacherRequester(user)) throw new ApiError(httpStatus.FORBIDDEN, "Only the evaluator asks to reopen their marks.");
  const instituteId = user.instituteId;
  const reason = clean(body?.reason).slice(0, 500);
  if (reason.length < 5) throw new ApiError(httpStatus.BAD_REQUEST, "Say in a few words why the marks should reopen.");

  const mine = await EvaluationAssignment.findAll({ where: { instituteId, examId: clean(examId), teacherId: user.userId, isActive: true } });
  if (!mine.length) throw new ApiError(httpStatus.FORBIDDEN, "You are not assigned as the evaluator for this exam.");
  const named = body?.sectionId !== undefined && body?.sectionId !== null;
  const scoped = named ? mine.filter((a) => sectionKey(a.sectionId) === sectionKey(body.sectionId)) : mine;
  if (!scoped.length) throw new ApiError(httpStatus.FORBIDDEN, "You are not assigned to evaluate that section of this exam.");
  // Without a section named: the one section of theirs that is completed.
  const completed = scoped.filter((a) => a.reviewedAt);
  if (!completed.length) throw new ApiError(httpStatus.CONFLICT, "This evaluation isn't marked completed, so there is nothing to reopen. You can change its marks.");
  if (completed.length > 1) throw new ApiError(httpStatus.BAD_REQUEST, "Choose the section to reopen.");
  const target = completed[0];

  const lock = (await examLockStates([target.examId])).get(target.examId);
  if (lock?.published) {
    throw new ApiError(httpStatus.CONFLICT, "Results of this exam are published, so its marks can't be reopened. Marks change only through a recheck the admin assigns.");
  }
  if (lock?.crossCheck) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "This exam is being cross-checked, so its marks can't be reopened now. If they must change, tell the admin: they can restart the cross-check."
    );
  }

  const exam: any = await loadExam(instituteId, target.examId);
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
  const label = workLabel(exam, [(await sectionNames(exam)).get(sectionKey(target.sectionId)) ?? ""]);

  let created: EvaluationReopenRequest;
  try {
    created = await sequelize.transaction(async (t) => {
      const assignment = await EvaluationAssignment.findOne({ where: { assignmentId: target.assignmentId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!assignment?.isActive || assignment.teacherId !== user.userId) {
        throw new ApiError(httpStatus.FORBIDDEN, "This section of the exam is no longer assigned to you for evaluation.");
      }
      if (!assignment.reviewedAt) throw new ApiError(httpStatus.CONFLICT, "This evaluation isn't marked completed, so there is nothing to reopen. You can change its marks.");
      const open = await EvaluationReopenRequest.findOne({ where: { assignmentId: assignment.assignmentId, status: EVAL_REOPEN_STATUS.PENDING }, transaction: t });
      if (open) throw new ApiError(httpStatus.CONFLICT, "You already asked to reopen this section. The admin hasn't answered yet.");

      const request = await EvaluationReopenRequest.create(
        {
          requestId: newId("evaluationReopen"),
          instituteId,
          examId: assignment.examId,
          assignmentId: assignment.assignmentId,
          sectionId: assignment.sectionId,
          teacherId: user.userId,
          reason,
        },
        { transaction: t }
      );
      const teacher = await UserModal.findOne({ where: { userId: user.userId }, attributes: ["userName"], transaction: t });
      const admins = [...new Set([assignment.assignedBy, ...(await instituteAdminIds(instituteId, t))].filter(Boolean))];
      await notifyAll(
        admins.map((userId) => ({
          instituteId,
          userId,
          type: "EVALUATION_REOPEN_REQUESTED",
          title: "Request to reopen marks",
          message: `${teacher?.userName || "The evaluator"} asks to reopen the marks of ${label}: ${preview(reason)}`,
          referenceId: assignment.examId,
        })),
        t
      );
      return request;
    });
  } catch (err: any) {
    // Two requests at once: the other one is the open request.
    if (err?.name === "SequelizeUniqueConstraintError") throw new ApiError(httpStatus.CONFLICT, "You already asked to reopen this section. The admin hasn't answered yet.");
    throw err;
  }
  refreshHomes(instituteId, user.userId);
  logger.info(`[EvaluationReopen] ${user.userId} asked to reopen ${created.examId} section "${sectionKey(created.sectionId)}" (${created.requestId}).`);
  return { examId: created.examId, request: reopenInfo(created) };
};

/** Decided requests a list shows (newest first); open ones are always all there. */
const DECIDED_SHOWN = 200;

/**
 * Admin: the evaluators' requests, open ones first (PENDING), the decided ones (DECIDED), or ALL
 * (newest first). Every open request is listed; decided ones, the newest DECIDED_SHOWN.
 * ?sessionId (&examType) keeps the requests, and the counts, to that session's exams.
 */
export const listReopenRequests = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const view = clean(query?.status).toUpperCase() || "PENDING";
  const sessionId = clean(query?.sessionId);
  const examType = clean(query?.examType);
  const scope: any = { instituteId };
  if (sessionId) {
    scope.examId = {
      [Op.in]: sequelize.literal(
        `(SELECT "examId" FROM viaexam_exams WHERE "instituteId" = ${sequelize.escape(instituteId)} AND "sessionId" = ${sequelize.escape(sessionId)}${
          examType ? ` AND "examType" = ${sequelize.escape(examType)}` : ""
        } AND "isDeleted" = false)`
      ),
    };
  }
  const decided = { [Op.in]: [EVAL_REOPEN_STATUS.APPROVED, EVAL_REOPEN_STATUS.REJECTED] };

  const [open, closed, byStatus] = await Promise.all([
    view === "DECIDED" ? [] : EvaluationReopenRequest.findAll({ where: { ...scope, status: EVAL_REOPEN_STATUS.PENDING }, order: [["createdAt", view === "PENDING" ? "ASC" : "DESC"]] }),
    view === "PENDING" ? [] : EvaluationReopenRequest.findAll({ where: { ...scope, status: decided }, order: [["createdAt", "DESC"]], limit: DECIDED_SHOWN }),
    EvaluationReopenRequest.findAll({
      where: scope,
      attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "n"]],
      group: ["status"],
      raw: true,
    }) as unknown as Promise<{ status: string; n: string }[]>,
  ]);
  const rows = view === "ALL" ? [...open, ...closed].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) : [...open, ...closed];
  const examIds = [...new Set(rows.map((r) => r.examId))];
  const userIds = [...new Set(rows.flatMap((r) => [r.teacherId, r.decidedBy]).filter(Boolean) as string[])];
  const [exams, users, assignments, locks, crossChecks] = await Promise.all([
    Promise.all(examIds.map((id) => loadExam(instituteId, id))),
    userIds.length ? UserModal.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ["userId", "userName"] }) : [],
    rows.length ? EvaluationAssignment.findAll({ where: { assignmentId: { [Op.in]: [...new Set(rows.map((r) => r.assignmentId))] } } }) : [],
    examLockStates(examIds),
    crossCheckStates(instituteId, examIds),
  ]);
  const examById = new Map(exams.filter(Boolean).map((e: any) => [e.examId, e]));
  const nameOf = new Map(users.map((u: any) => [u.userId, u.userName]));
  const assignmentOf = new Map(assignments.map((a) => [a.assignmentId, a]));
  const namesByExam = new Map<string, Map<string, string>>();
  for (const e of examById.values()) namesByExam.set((e as any).examId, await sectionNames(e));
  const count = (s: string) => Number(byStatus.find((x) => x.status === s)?.n ?? 0);

  return {
    requests: rows.map((r) => {
      const exam: any = examById.get(r.examId);
      const assignment = assignmentOf.get(r.assignmentId);
      const sectionName = namesByExam.get(r.examId)?.get(sectionKey(r.sectionId)) || exam?.section?.sectionName || "";
      const round = crossChecks.byExam.get(r.examId);
      return {
        ...reopenInfo(r),
        examId: r.examId,
        label: exam ? workLabel(exam, [sectionName]) : "",
        examType: exam?.examType ?? "",
        subjectName: exam?.subject?.subjectName ?? "",
        className: exam?.class?.className ?? "",
        sectionName,
        sessionId: exam?.sessionId ?? null,
        sessionName: exam?.session?.sessionName ?? "",
        teacherId: r.teacherId,
        teacherName: nameOf.get(r.teacherId) ?? "",
        decidedByName: r.decidedBy ? (nameOf.get(r.decidedBy) ?? "") : null,
        // Approving needs the same evaluator still on the section, and unpublished results.
        stillAssigned: Boolean(assignment?.isActive && assignment.teacherId === r.teacherId),
        stillCompleted: Boolean(assignment?.isActive && assignment.reviewedAt),
        resultsPublished: Boolean(locks.get(r.examId)?.published),
        // A cross-check of the exam that approving would cancel (it starts again after the next completion).
        crossCheck: round ? { status: round.status, total: round.total, pending: round.pending } : null,
      };
    }),
    counts: { pending: count(EVAL_REOPEN_STATUS.PENDING), approved: count(EVAL_REOPEN_STATUS.APPROVED), rejected: count(EVAL_REOPEN_STATUS.REJECTED) },
  };
};

/**
 * Admin: approves (the section is no longer completed; the same evaluator changes its marks and
 * marks it completed again) or declines (with a note) an open request. Approving while a cross-check
 * of the exam is active needs `stopCrossCheck: true`: the cross-check is cancelled and starts again
 * after the next completion.
 */
const decide = async (admin: any, requestId: string, approve: boolean, body: any) => {
  const instituteId = admin.instituteId;
  const note = clean(body?.note).slice(0, 500) || null;
  if (!approve && (!note || note.length < 3)) throw new ApiError(httpStatus.BAD_REQUEST, "Tell the evaluator why, in a short note.");
  let cancelCrossCheck = false;

  const decided = await sequelize.transaction(async (t) => {
    const request = await EvaluationReopenRequest.findOne({ where: { requestId: clean(requestId), instituteId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!request) throw new ApiError(httpStatus.NOT_FOUND, "That request doesn't exist.");
    if (request.status !== EVAL_REOPEN_STATUS.PENDING) {
      throw new ApiError(httpStatus.CONFLICT, request.status === EVAL_REOPEN_STATUS.APPROVED ? "This request was already approved." : "This request was already declined.");
    }
    const assignment = await EvaluationAssignment.findOne({ where: { assignmentId: request.assignmentId }, transaction: t, lock: t.LOCK.UPDATE });

    if (approve) {
      // Lock the exam row so publishing can't slip in between.
      await Exam.findOne({ where: { examId: request.examId }, transaction: t, lock: t.LOCK.UPDATE });
      const lock = (await examLockStates([request.examId])).get(request.examId);
      if (lock?.published) {
        throw new ApiError(httpStatus.CONFLICT, "Results of this exam are published, so its marks change only through a recheck. Decline the request.");
      }
      if (!assignment?.isActive || assignment.teacherId !== request.teacherId) {
        throw new ApiError(httpStatus.CONFLICT, "This section is no longer with that evaluator. Decline the request; its new evaluator can change the marks.");
      }
      const round = (await crossCheckStates(instituteId, [request.examId])).byExam.get(request.examId);
      if (round && body?.stopCrossCheck !== true) {
        const err: any = new ApiError(
          httpStatus.CONFLICT,
          "A cross-check of this exam is active. Reopening the marks cancels it; it starts again after the evaluator marks the section completed. Confirm to reopen anyway."
        );
        err.data = { needsConfirm: "crossCheck", crossCheck: { status: round.status, total: round.total, pending: round.pending } };
        throw err;
      }
      cancelCrossCheck = Boolean(round);
      if (assignment.reviewedAt) await assignment.update({ reviewedAt: null, reviewedBy: null }, { transaction: t });
    }

    await request.update(
      { status: approve ? EVAL_REOPEN_STATUS.APPROVED : EVAL_REOPEN_STATUS.REJECTED, decidedBy: admin.userId, decidedAt: new Date(), decisionNote: note },
      { transaction: t }
    );
    const exam: any = await loadExam(instituteId, request.examId);
    const label = exam ? workLabel(exam, [(await sectionNames(exam)).get(sectionKey(request.sectionId)) ?? ""]) : "the exam";
    await notifyAll(
      [
        approve
          ? {
              instituteId,
              userId: request.teacherId,
              type: "EVALUATION_REOPENED",
              title: "Marks reopened",
              message: `The admin reopened the marks of ${label}.${note ? ` Note: ${preview(note)}` : ""} Change what you need, then mark it completed again.`,
              referenceId: request.examId,
            }
          : {
              instituteId,
              userId: request.teacherId,
              type: "EVALUATION_REOPEN_REJECTED",
              title: "Reopen request declined",
              message: `The admin didn't reopen the marks of ${label}: ${preview(note ?? "")}`,
              referenceId: request.examId,
            },
      ],
      t
    );
    return request;
  });

  // The cross-check holds sheets that may now change: it starts again after the next completion.
  if (cancelCrossCheck) await closeRoundForReopen(decided.examId).catch((err) => logger.error(`[EvaluationReopen] Could not cancel the cross-check of ${decided.examId}: ${err?.message || err}`));
  refreshHomes(instituteId, decided.teacherId);
  logger.info(`[EvaluationReopen] ${admin.userId} ${approve ? "approved" : "declined"} ${decided.requestId} (${decided.examId})${cancelCrossCheck ? "; its cross-check was cancelled" : ""}.`);
  return { examId: decided.examId, request: reopenInfo(decided), crossCheckCancelled: cancelCrossCheck };
};

export const approveReopen = (admin: any, requestId: string, body: any) => decide(admin, requestId, true, body);
export const rejectReopen = (admin: any, requestId: string, body: any) => decide(admin, requestId, false, body);

export default { requestReopen, listReopenRequests, approveReopen, rejectReopen, latestReopenRequests, settleReopenRequests, reopenInfo };
