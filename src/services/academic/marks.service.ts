/**
 * Marks & grading: every subject's maximum and pass marks for each exam (Mid Term / Final)
 * of each session, set once by the admin (Master Data → Marks & grading).
 *
 *   - An exam takes its marks from here; the exam form doesn't ask for them.
 *   - A question paper must add up to the exam's maximum marks (questionPaper.service).
 *   - Marks freeze once a paper of the exam has been sent for approval, or answer sheets
 *     or results exist, so every sheet of an exam is marked out of the same total.
 *   - Every change is written to MarksAudit with who made it.
 */

import httpStatus from "http-status";
import { Op, QueryTypes, Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import Class from "../../models/Class.model";
import Subject from "../../models/Subject.model";
import Session from "../../models/Session.model";
import Exam from "../../models/Exam.model";
import Notification from "../../models/Notification.model";
import MarksScheme from "../../models/MarksScheme.model";
import MarksAudit, { MARKS_CHANGE, MARKS_SOURCE, type MarksChange, type MarksSource } from "../../models/MarksAudit.model";
import SessionSubject from "../../models/SessionSubject.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import { EXAM_TYPES, normalizeExamType } from "../../utils/examTypes";
import { newId } from "../../utils/idGenerator";
import { findSession } from "./sessionSetup.service";
import { settingsOf } from "./instituteSettings.service";

const fail = (statusCode: number, message: string, data?: unknown) => ({ error: true, statusCode, message, ...(data ? { data } : {}) });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byName = (a: string, b: string) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
const classText = (name?: string | null) => (name ? (/^\d/.test(name) ? `Class ${name}` : name) : "Class");

// ─── Audit ────────────────────────────────────────────────────────────────────

/** Records one change of marks (call inside the change's transaction). */
export const logMarksChange = (
  entry: {
    instituteId: string;
    what: MarksChange;
    source: MarksSource;
    changedBy: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
    sessionId?: string | null;
    examType?: string | null;
    examId?: string | null;
    subjectId?: string | null;
    studentId?: string | null;
    sheetId?: string | null;
    /** The admin who approved it (a recheck decision). */
    approvedBy?: string | null;
  },
  transaction?: Transaction
) =>
  MarksAudit.create(
    {
      instituteId: entry.instituteId,
      what: entry.what,
      source: entry.source,
      changedBy: entry.changedBy,
      approvedBy: entry.approvedBy ?? null,
      oldValue: entry.oldValue === undefined || entry.oldValue === null ? null : String(entry.oldValue).slice(0, 255),
      newValue: entry.newValue === undefined || entry.newValue === null ? null : String(entry.newValue).slice(0, 255),
      reason: entry.reason ? String(entry.reason).slice(0, 2000) : null,
      sessionId: entry.sessionId ?? null,
      examType: entry.examType ?? null,
      examId: entry.examId ?? null,
      subjectId: entry.subjectId ?? null,
      studentId: entry.studentId ?? null,
      sheetId: entry.sheetId ?? null,
    },
    { transaction }
  );

// ─── Reads used by other services ─────────────────────────────────────────────

/** A subject's marks for an exam of a session, or null when not set yet. */
export const marksFor = (sessionId: string, examType: string, subjectId: string, transaction?: Transaction) =>
  MarksScheme.findOne({ where: { sessionId, examType, subjectId }, transaction });

/** What already depends on an exam's marks, per exam: submitted papers, sheets, results. */
const usageOf = async (examIds: string[]) => {
  const out = new Map<string, { papers: number; sheets: number; results: number }>();
  if (!examIds.length) return out;
  const rows = (await sequelize.query(
    `SELECT e."examId",
            (SELECT COUNT(*) FROM viaexam_question_papers q WHERE q."examId" = e."examId" AND q."deletedAt" IS NULL AND q.status::text NOT IN ('DRAFT', 'REJECTED'))::int AS papers,
            (SELECT COUNT(*) FROM viaexam_answer_sheets s WHERE s."examId" = e."examId" AND s."isDeleted" = false)::int AS sheets,
            (SELECT COUNT(*) FROM viaexam_student_results r WHERE r."examId" = e."examId" AND r."isDeleted" = false)::int AS results
     FROM viaexam_exams e WHERE e."examId" IN (:ids)`,
    { replacements: { ids: examIds }, type: QueryTypes.SELECT }
  )) as any[];
  for (const r of rows) out.set(r.examId, { papers: Number(r.papers), sheets: Number(r.sheets), results: Number(r.results) });
  return out;
};

/** Why marks can't change any more ("Answer sheets are in"), or null. */
const lockFrom = (u: { papers: number; sheets: number; results: number } | undefined) =>
  !u ? null : u.results ? "Results are published" : u.sheets ? "Answer sheets are in" : u.papers ? "The question paper has been sent for approval" : null;

// ─── GET /marks?sessionId=&examType= ───────────────────────────────────────────

const getMarks = async (user: any, query: any) => {
  const instituteId = String(user?.instituteId ?? "");
  try {
    const session = await findSession(instituteId, query?.sessionId);
    if (!session) return fail(httpStatus.NOT_FOUND, query?.sessionId ? "Session not found." : "No current session yet. Create one in Master Data → Sessions.");
    const examType = normalizeExamType(query?.examType) ?? EXAM_TYPES[0];

    const [sessions, taught, schemes, exams, settings, allSchemes] = await Promise.all([
      Session.findAll({ where: { instituteId, isDeleted: false }, order: [["startDate", "DESC"]] }),
      SessionSubject.findAll({ where: { sessionId: session.sessionId } }),
      MarksScheme.findAll({ where: { sessionId: session.sessionId, examType } }),
      Exam.findAll({ where: { instituteId, sessionId: session.sessionId, examType, isDeleted: false }, attributes: ["examId", "subjectId"] }),
      settingsOf(instituteId),
      MarksScheme.findAll({ where: { sessionId: session.sessionId }, attributes: ["subjectId", "examType"] }),
    ]);
    const subjectIds = taught.map((t) => t.subjectId);
    const [subjects, classes, usage] = await Promise.all([
      subjectIds.length ? Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds }, isDeleted: false }, include: [{ association: "section", attributes: ["sectionName"], required: false }] }) : [],
      Class.findAll({ where: { instituteId, isDeleted: false }, attributes: ["classId", "className"] }),
      usageOf(exams.map((e) => e.examId)),
    ]);
    const schemeOf = new Map(schemes.map((s) => [s.subjectId, s]));
    const examsOf = new Map<string, string[]>();
    for (const e of exams) examsOf.set(e.subjectId, [...(examsOf.get(e.subjectId) ?? []), e.examId]);
    const lockOfSubject = (subjectId: string) => {
      for (const id of examsOf.get(subjectId) ?? []) {
        const reason = lockFrom(usage.get(id));
        if (reason) return reason;
      }
      return null;
    };

    const rows = classes
      .map((c) => ({
        classId: c.classId,
        className: c.className,
        subjects: subjects
          .filter((s) => s.classId === c.classId)
          .sort((a, b) => byName(a.subjectName, b.subjectName))
          .map((s) => {
            const scheme = schemeOf.get(s.subjectId);
            return {
              subjectId: s.subjectId,
              subjectName: s.subjectName,
              sectionName: (s as any).section?.sectionName ?? null,
              maxMarks: scheme?.maxMarks ?? null,
              passMarks: scheme?.passMarks ?? null,
              exams: (examsOf.get(s.subjectId) ?? []).length,
              locked: lockOfSubject(s.subjectId),
              updatedAt: scheme?.updatedAt ? new Date(scheme.updatedAt).toISOString() : null,
            };
          }),
      }))
      .filter((c) => c.subjects.length)
      .sort((a, b) => byName(a.className, b.className));

    const all = rows.flatMap((c) => c.subjects);
    const listed = new Set(all.map((s) => s.subjectId));
    const byType = Object.fromEntries(
      EXAM_TYPES.map((type) => [type, { subjects: all.length, set: allSchemes.filter((m) => m.examType === type && listed.has(m.subjectId)).length }])
    );
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Marks loaded.",
      data: {
        session: { sessionId: session.sessionId, sessionName: session.sessionName, isActive: session.isActive },
        sessions: sessions.map((s) => ({ sessionId: s.sessionId, sessionName: s.sessionName, isActive: s.isActive, startDate: s.startDate, endDate: s.endDate })),
        examType,
        examTypes: EXAM_TYPES,
        defaults: settings.marksDefaults[examType],
        classes: rows,
        totals: { subjects: all.length, set: all.filter((s) => s.maxMarks !== null).length, locked: all.filter((s) => s.locked).length },
        byType,
      },
    };
  } catch (e: any) {
    console.error("getMarks failed:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't load the marks: ${e.message}`);
  }
};

// ─── PUT /marks ────────────────────────────────────────────────────────────────
// { sessionId, examType, rows: [{ subjectId, maxMarks, passMarks }] } — the changed rows.
// Exams of a subject that haven't started (no paper sent, no sheets, no results) take the
// new marks, and so do their draft papers; their paper setters are told.

const saveMarks = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  try {
    const session = await findSession(instituteId, body?.sessionId);
    if (!session) return fail(httpStatus.NOT_FOUND, "Session not found.");
    const examType = normalizeExamType(body?.examType);
    if (!examType) return fail(httpStatus.BAD_REQUEST, `Choose ${EXAM_TYPES.join(" or ")}.`);
    const input: any[] = Array.isArray(body?.rows) ? body.rows : [];
    if (!input.length) return fail(httpStatus.BAD_REQUEST, "Nothing to save.");
    if (input.length > 500) return fail(httpStatus.BAD_REQUEST, "Save at most 500 subjects at a time.");

    const subjectIds = [...new Set(input.map((r) => String(r?.subjectId ?? "")))].filter(Boolean);
    const [subjects, taught, schemes, exams] = await Promise.all([
      Subject.findAll({ where: { instituteId, subjectId: { [Op.in]: subjectIds }, isDeleted: false }, include: [{ association: "class", attributes: ["className"] }] }),
      SessionSubject.findAll({ where: { sessionId: session.sessionId, subjectId: { [Op.in]: subjectIds } }, attributes: ["subjectId"] }),
      MarksScheme.findAll({ where: { sessionId: session.sessionId, examType, subjectId: { [Op.in]: subjectIds } } }),
      Exam.findAll({ where: { instituteId, sessionId: session.sessionId, examType, subjectId: { [Op.in]: subjectIds }, isDeleted: false } }),
    ]);
    const subjectOf = new Map(subjects.map((s) => [s.subjectId, s]));
    const isTaught = new Set(taught.map((t) => t.subjectId));
    const schemeOf = new Map(schemes.map((s) => [s.subjectId, s]));
    const usage = await usageOf(exams.map((e) => e.examId));

    const problems: string[] = [];
    const changes: { subject: Subject; maxMarks: number; passMarks: number; before: MarksScheme | undefined }[] = [];
    for (const r of input) {
      const subject = subjectOf.get(String(r?.subjectId ?? ""));
      if (!subject) {
        problems.push("A subject was not found. Refresh and try again.");
        continue;
      }
      const label = `${subject.subjectName} (${classText((subject as any).class?.className)})`;
      if (!isTaught.has(subject.subjectId)) {
        problems.push(`${label} isn't taught in ${session.sessionName}. Add it in Session setup first.`);
        continue;
      }
      const maxMarks = Number(r?.maxMarks);
      const passMarks = Number(r?.passMarks);
      if (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > 1000) {
        problems.push(`${label}: maximum marks must be a whole number from 1 to 1000.`);
        continue;
      }
      if (!Number.isInteger(passMarks) || passMarks < 0 || passMarks > maxMarks) {
        problems.push(`${label}: pass marks must be a whole number from 0 to ${maxMarks}.`);
        continue;
      }
      const before = schemeOf.get(subject.subjectId);
      if (before && before.maxMarks === maxMarks && before.passMarks === passMarks) continue;
      const lock = exams
        .filter((e) => e.subjectId === subject.subjectId)
        .map((e) => lockFrom(usage.get(e.examId)))
        .find(Boolean);
      if (lock) {
        problems.push(`${label}: ${lock.toLowerCase()} for ${examType}, so its marks stay ${before ? `${before.maxMarks}/${before.passMarks}` : "as they are"}.`);
        continue;
      }
      changes.push({ subject, maxMarks, passMarks, before });
    }
    if (problems.length) {
      const unique = [...new Set(problems)];
      return fail(httpStatus.CONFLICT, unique.length === 1 ? unique[0] : `${unique.length} subjects need attention.`, { problems: unique });
    }
    if (!changes.length) return { error: false, statusCode: httpStatus.OK, message: "Nothing changed.", data: { saved: 0 } };

    const told: { teacherId: string; text: string; examId: string }[] = [];
    await sequelize.transaction(async (t) => {
      for (const c of changes) {
        const where = { sessionId: session.sessionId, examType, subjectId: c.subject.subjectId };
        // Read before the update below changes the row in place.
        const old = c.before ? { max: c.before.maxMarks, pass: c.before.passMarks } : null;
        if (c.before) await c.before.update({ maxMarks: c.maxMarks, passMarks: c.passMarks, updatedBy: user.userId }, { transaction: t });
        else await MarksScheme.create({ instituteId, ...where, classId: c.subject.classId, maxMarks: c.maxMarks, passMarks: c.passMarks, updatedBy: user.userId }, { transaction: t });

        const base = { instituteId, source: MARKS_SOURCE.SETUP, changedBy: user.userId, sessionId: session.sessionId, examType, subjectId: c.subject.subjectId };
        if (old?.max !== c.maxMarks) await logMarksChange({ ...base, what: MARKS_CHANGE.MAX, oldValue: old?.max ?? null, newValue: c.maxMarks }, t);
        if (old?.pass !== c.passMarks) await logMarksChange({ ...base, what: MARKS_CHANGE.PASS, oldValue: old?.pass ?? null, newValue: c.passMarks }, t);

        // Exams of this subject (none has started: see the lock above) take the new marks.
        for (const exam of exams.filter((e) => e.subjectId === c.subject.subjectId)) {
          if (exam.totalMarks === c.maxMarks && exam.passingMarks === c.passMarks) continue;
          await exam.update({ totalMarks: c.maxMarks, passingMarks: c.passMarks }, { transaction: t });
          const drafts = await QuestionPaper.findAll({ where: { examId: exam.examId, status: { [Op.in]: ["DRAFT", "REJECTED"] } }, transaction: t });
          for (const paper of drafts) {
            const content: any = paper.content && typeof paper.content === "object" ? paper.content : {};
            await paper.update({ content: { ...content, meta: { ...(content.meta ?? {}), maxMarks: String(c.maxMarks) } } }, { transaction: t });
          }
          if (drafts.length && exam.teacherId) {
            told.push({ teacherId: exam.teacherId, examId: exam.examId, text: `${c.subject.subjectName} ${examType} is now out of ${c.maxMarks} marks (pass ${c.passMarks}). Make your paper add up to ${c.maxMarks}.` });
          }
        }
      }
    });

    for (const n of told) {
      await Notification.create({
        notificationId: newId("notification"),
        instituteId,
        userId: n.teacherId,
        type: "EXAM_MARKS_CHANGED",
        title: "Paper marks changed",
        message: n.text,
        referenceId: n.examId,
      }).catch(() => null);
    }

    const classes = [...new Set(changes.map((c) => classText((c.subject as any).class?.className)))];
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${examType} marks saved for ${plural(changes.length, "subject")}${classes.length === 1 ? ` of ${classes[0]}` : ""}.${told.length ? ` ${plural(told.length, "paper setter")} told.` : ""}`,
      data: { saved: changes.length },
    };
  } catch (e: any) {
    console.error("saveMarks failed:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't save the marks: ${e.message}`);
  }
};

// ─── POST /marks/copy ──────────────────────────────────────────────────────────
// { fromSessionId, toSessionId, examType } — fills the subjects of `to` that have no marks
// yet with what the same subjects had in `from`. Subjects already set are left alone.

const copyMarks = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const [from, to] = await Promise.all([findSession(instituteId, body?.fromSessionId), findSession(instituteId, body?.toSessionId)]);
  const examType = normalizeExamType(body?.examType);
  if (!from || !to || !body?.fromSessionId) return fail(httpStatus.BAD_REQUEST, "Choose the session to copy from.");
  if (from.sessionId === to.sessionId) return fail(httpStatus.BAD_REQUEST, "Choose another session to copy from.");
  if (!examType) return fail(httpStatus.BAD_REQUEST, `Choose ${EXAM_TYPES.join(" or ")}.`);
  const [source, taught, existing] = await Promise.all([
    MarksScheme.findAll({ where: { sessionId: from.sessionId, examType } }),
    SessionSubject.findAll({ where: { sessionId: to.sessionId }, attributes: ["subjectId"] }),
    MarksScheme.findAll({ where: { sessionId: to.sessionId, examType }, attributes: ["subjectId"] }),
  ]);
  const isTaught = new Set(taught.map((t) => t.subjectId));
  const has = new Set(existing.map((e) => e.subjectId));
  const rows = source.filter((s) => isTaught.has(s.subjectId) && !has.has(s.subjectId));
  if (!rows.length) return { error: false, statusCode: httpStatus.OK, message: `Nothing to copy: every subject taught in ${to.sessionName} already has ${examType} marks, or ${from.sessionName} had none.`, data: { copied: 0 } };
  await sequelize.transaction(async (t) => {
    for (const r of rows) {
      await MarksScheme.create({ instituteId, sessionId: to.sessionId, examType, classId: r.classId, subjectId: r.subjectId, maxMarks: r.maxMarks, passMarks: r.passMarks, updatedBy: user.userId }, { transaction: t });
      await logMarksChange({ instituteId, what: MARKS_CHANGE.MAX, source: MARKS_SOURCE.SETUP, changedBy: user.userId, sessionId: to.sessionId, examType, subjectId: r.subjectId, newValue: r.maxMarks, reason: `Copied from ${from.sessionName}` }, t);
    }
  });
  return { error: false, statusCode: httpStatus.OK, message: `${examType} marks copied from ${from.sessionName} for ${plural(rows.length, "subject")}.`, data: { copied: rows.length } };
};

// ─── GET /marks/changes ────────────────────────────────────────────────────────
// Who changed which marks, newest first. ?examId= / ?subjectId= / ?sessionId= / ?examType= /
// ?sheetId= (one answer sheet) / ?what=max-marks,pass-marks set the scope; ?changedBy= (a
// person), ?studentId= and ?source=recheck,cross-check narrow it; ?before=<id> pages back.
// ?facets=1 also lists, for the scope, who made changes, whose marks changed and where (for
// the filter menus).

const userNames = async (ids: string[]) =>
  new Map(
    ids.length
      ? (await sequelize.query<{ userId: string; userName: string }>(`SELECT "userId", "userName" FROM viaexam_users WHERE "userId" IN (:ids)`, { replacements: { ids }, type: QueryTypes.SELECT })).map(
          (u) => [u.userId, u.userName]
        )
      : []
  );

/** Who made changes, whose marks changed and where, with counts, in a scope. */
const changeFacets = async (scope: any) => {
  const count = [sequelize.fn("COUNT", sequelize.col("id")), "n"] as [ReturnType<typeof sequelize.fn>, string];
  const [changers, students, sources] = (await Promise.all([
    MarksAudit.findAll({ where: scope, attributes: ["changedBy", count], group: ["changedBy"], raw: true }),
    MarksAudit.findAll({ where: { ...scope, studentId: { [Op.ne]: null } }, attributes: ["studentId", count], group: ["studentId"], raw: true }),
    MarksAudit.findAll({ where: scope, attributes: ["source", count], group: ["source"], raw: true }),
  ])) as unknown as [{ changedBy: string; n: string }[], { studentId: string; n: string }[], { source: string; n: string }[]];
  const names = await userNames([...new Set([...changers.map((c) => c.changedBy), ...students.map((s) => s.studentId)])]);
  const people = <T,>(rows: T[], id: (r: T) => string) =>
    rows
      .map((r: any) => ({ userId: id(r), name: names.get(id(r)) ?? "Someone", count: Number(r.n) || 0 }))
      .sort((a, b) => b.count - a.count || byName(a.name, b.name))
      .slice(0, 100);
  return {
    changers: people(changers, (r) => r.changedBy),
    students: people(students, (r) => r.studentId),
    sources: sources.map((s) => ({ source: s.source, count: Number(s.n) || 0 })),
  };
};

const getChanges = async (user: any, query: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const limit = Math.min(100, Math.max(1, Number(query?.limit) || 30));
  const scope: any = { instituteId };
  for (const k of ["examId", "subjectId", "sessionId", "sheetId"] as const) if (query?.[k]) scope[k] = String(query[k]);
  if (query?.examType) scope.examType = normalizeExamType(query.examType) ?? String(query.examType);
  const what = String(query?.what ?? "").split(",").map((w) => w.trim()).filter((w) => (Object.values(MARKS_CHANGE) as string[]).includes(w));
  if (what.length) scope.what = { [Op.in]: what };
  const where: any = { ...scope };
  if (query?.studentId) where.studentId = String(query.studentId);
  if (query?.changedBy) where.changedBy = String(query.changedBy);
  const source = String(query?.source ?? "").split(",").map((s) => s.trim()).filter((s) => (Object.values(MARKS_SOURCE) as string[]).includes(s));
  if (source.length) where.source = { [Op.in]: source };
  if (query?.before) where.id = { [Op.lt]: Number(query.before) };
  const [rows, facets] = await Promise.all([
    MarksAudit.findAll({
      where,
      order: [["id", "DESC"]],
      limit: limit + 1,
      include: [
        { association: "changer", attributes: ["userName"], required: false },
        { association: "approver", attributes: ["userName"], required: false },
      ],
    }),
    // Only the first page asks; a page further back keeps the menus it has.
    query?.facets && !query?.before ? changeFacets(scope) : null,
  ]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const subjectIds = [...new Set(page.map((r) => r.subjectId).filter(Boolean))] as string[];
  const studentIds = [...new Set(page.map((r) => r.studentId).filter(Boolean))] as string[];
  const sessionIds = [...new Set(page.map((r) => r.sessionId).filter(Boolean))] as string[];
  const [subjects, students, sessions] = await Promise.all([
    subjectIds.length ? Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } }, attributes: ["subjectId", "subjectName"], include: [{ association: "class", attributes: ["className"] }] }) : [],
    studentIds.length
      ? sequelize.query(`SELECT "userId", "userName" FROM viaexam_users WHERE "userId" IN (:ids)`, { replacements: { ids: studentIds }, type: QueryTypes.SELECT })
      : [],
    sessionIds.length ? Session.findAll({ where: { sessionId: { [Op.in]: sessionIds } }, attributes: ["sessionId", "sessionName"] }) : [],
  ]);
  const sessionOf = new Map(sessions.map((s) => [s.sessionId, s.sessionName]));
  const subjectOf = new Map(subjects.map((s: any) => [s.subjectId, `${s.subjectName} (${classText(s.class?.className)})`]));
  const studentOf = new Map((students as any[]).map((s) => [s.userId, s.userName]));
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: "Changes loaded.",
    data: {
      changes: page.map((r: any) => ({
        id: r.id,
        at: new Date(r.createdAt).toISOString(),
        what: r.what,
        source: r.source,
        session: r.sessionId ? (sessionOf.get(r.sessionId) ?? null) : null,
        examType: r.examType,
        examId: r.examId,
        subject: r.subjectId ? (subjectOf.get(r.subjectId) ?? null) : null,
        studentId: r.studentId ?? null,
        student: r.studentId ? (studentOf.get(r.studentId) ?? null) : null,
        sheetId: r.sheetId ?? null,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
        changedById: r.changedBy,
        changedBy: r.changer?.userName ?? "Someone",
        /** The admin who approved it (a recheck decision). */
        approvedBy: r.approvedBy ? (r.approver?.userName ?? "an admin") : null,
      })),
      next: more ? page[page.length - 1].id : null,
      ...(facets ? { facets } : {}),
    },
  };
};

export default { getMarks, saveMarks, copyMarks, getChanges };
