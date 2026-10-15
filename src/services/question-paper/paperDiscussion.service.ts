/**
 * A question paper's discussion: the school's admins and the paper setter write to each
 * other about an exam's paper, and its approval steps (sent for approval, approved, sent
 * back with the admin's note) go into the same thread, so the paper's history reads in one
 * place. A new comment tells the other side: an admin's goes to the paper setter, a
 * teacher's to the admins.
 *
 * Who takes part: the school's admins, the exam's paper setter, and a teacher who owns one
 * of its paper sets. Nobody outside the school.
 */

import httpStatus from "http-status";
import { Transaction } from "sequelize";
import Exam from "../../models/Exam.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import PaperComment, { PAPER_EVENT, type PaperEvent } from "../../models/PaperComment.model";
import ApiError from "../../utils/ApiError";
import { newId } from "../../utils/idGenerator";
import { EXAM_INCLUDES } from "../exam/examRoster.service";
import { examLabel, instituteAdminIds, notifyAll, preview } from "../notification/notifyPeople";

const MAX_BODY = 2000;
const SETS = ["A", "B", "C", "D"];

const roleKey = (user: any) => String(user?.role?.role ?? user?.role ?? "").toUpperCase().replace(/[\s_-]+/g, "");
const isAdmin = (user: any) => ["ADMIN", "INSTITUTEADMIN"].includes(roleKey(user));

/** What a step says in the thread when it has no comment of its own. */
const STEP_TEXT: Record<PaperEvent, (set: string | null) => string> = {
  comment: () => "",
  submitted: (set) => `Sent ${set ? `set ${set}` : "the paper"} for approval.`,
  approved: (set) => `Approved ${set ? `set ${set}` : "the paper"}.`,
  rejected: (set) => `Sent ${set ? `set ${set}` : "the paper"} back.`,
};

/** The exam, when this user may take part in its paper's discussion. */
const examFor = async (user: any, examId: string) => {
  const exam: any = await Exam.findOne({
    where: { examId: String(examId ?? ""), instituteId: String(user?.instituteId ?? ""), isDeleted: false },
    include: EXAM_INCLUDES,
  });
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
  if (isAdmin(user) || exam.teacherId === user.userId) return exam;
  if (await QuestionPaper.count({ where: { examId: exam.examId, teacherId: user.userId } })) return exam;
  throw new ApiError(httpStatus.FORBIDDEN, "Only this exam's paper setter and the school's admins can see its paper's discussion.");
};

/** Writes a step or a comment into the thread (inside the step's transaction when there is one). */
export const recordPaperEvent = (
  entry: { instituteId: string; examId: string; paperSet?: string | null; kind: PaperEvent; author: any; body?: string | null },
  transaction?: Transaction
) =>
  PaperComment.create(
    {
      commentId: newId("paperComment"),
      instituteId: entry.instituteId,
      examId: entry.examId,
      paperSet: entry.paperSet ?? null,
      kind: entry.kind,
      authorId: String(entry.author?.userId ?? "system"),
      authorRole: isAdmin(entry.author) ? "ADMIN" : "TEACHER",
      body: entry.body ? String(entry.body).trim().slice(0, MAX_BODY) || null : null,
    },
    { transaction }
  );

/**
 * The thread, oldest first. Each entry keeps the fields the paper screens already read
 * (sender, role, text, time), plus what it is (kind), its set, and whether it's the reader's.
 */
const listComments = async (user: any, examId: string) => {
  const exam = await examFor(user, examId);
  const rows: any[] = await PaperComment.findAll({
    where: { examId: exam.examId },
    order: [["id", "ASC"]],
    limit: 500,
    include: [{ association: "author", attributes: ["userName"], required: false }],
  });
  return {
    examId: exam.examId,
    label: examLabel(exam),
    remarks: rows.map((c) => ({
      id: c.commentId,
      kind: c.kind as PaperEvent,
      paperSet: c.paperSet,
      sender: c.author?.userName ?? (c.authorRole === "TEACHER" ? "Paper setter" : "Admin"),
      role: c.authorRole,
      text: c.body ?? STEP_TEXT[c.kind as PaperEvent]?.(c.paperSet) ?? "",
      time: new Date(c.createdAt).toISOString(),
      mine: c.authorId === user.userId,
    })),
  };
};

/** { remark | text, paperSet? } — a comment from an admin or the paper setter. */
const addComment = async (user: any, examId: string, body: any) => {
  const text = String(body?.remark ?? body?.text ?? "").trim();
  if (!text) throw new ApiError(httpStatus.BAD_REQUEST, "Write a comment first.");
  if (text.length > MAX_BODY) throw new ApiError(httpStatus.BAD_REQUEST, `Keep a comment under ${MAX_BODY} characters.`);
  const set = String(body?.paperSet ?? "").trim().toUpperCase();
  const exam = await examFor(user, examId);
  await recordPaperEvent({ instituteId: exam.instituteId, examId: exam.examId, paperSet: SETS.includes(set) ? set : null, kind: PAPER_EVENT.COMMENT, author: user, body: text });

  // The other side hears about it.
  const fromAdmin = isAdmin(user);
  const to = fromAdmin
    ? [exam.teacherId, ...(await QuestionPaper.findAll({ where: { examId: exam.examId }, attributes: ["teacherId"] })).map((p) => p.teacherId)]
    : await instituteAdminIds(exam.instituteId);
  const who = user?.userName || (fromAdmin ? "The admin" : "The paper setter");
  await notifyAll(
    [...new Set(to)]
      .filter((id) => id && id !== user.userId)
      .map((userId) => ({
        instituteId: exam.instituteId,
        userId,
        type: "PAPER_COMMENT",
        title: `${who} commented on ${examLabel(exam)}`,
        message: preview(text),
        referenceId: exam.examId,
      }))
  );
  return listComments(user, exam.examId);
};

export default { listComments, addComment };
