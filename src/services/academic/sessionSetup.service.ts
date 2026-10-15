/**
 * Session setup: what runs in each academic session.
 *
 *   master data (once)        classes, sections, subjects: names, codes, default marks
 *   session setup (per year)  which sections run, with their class teacher
 *                             which subjects are taught, with their subject teacher
 *   enrolments (per year)     each student's class, section and roll number
 *                             (services/student/enrollment.service)
 *
 * Every year keeps its own rows, so changing teachers for 2027-2028 never rewrites who
 * taught in 2026-2027. A new session starts as a copy of another one (or, for a school's
 * first session, of the master data) and is then adjusted class by class.
 *
 * Older screens read the teacher on the subject / section itself (Subject.teacherId,
 * Section.classTeacherId). Those columns now hold a copy of the current session's
 * values; syncCurrentMirrors() refreshes them after every change and when another
 * session becomes current. Nothing else writes them.
 */

import httpStatus from "http-status";
import { Op, QueryTypes, Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import Session from "../../models/Session.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import SessionSection from "../../models/SessionSection.model";
import SessionSubject from "../../models/SessionSubject.model";
import StudentEnrollment from "../../models/StudentEnrollment.model";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import MarksScheme from "../../models/MarksScheme.model";
import MarksAudit, { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import { specialisesIn } from "../../utils/specialization";

const fail = (statusCode: number, message: string, data?: unknown) => ({ error: true, statusCode, message, ...(data ? { data } : {}) });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byName = (a: string, b: string) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
const classText = (name?: string | null) => (name ? (/^\d/.test(name) ? `Class ${name}` : name) : "Class");
const sectionText = (className?: string | null, sectionName?: string | null) => `${className ?? ""}-${sectionName ?? ""}`.replace(/^-|-$/g, "");
const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** "2025-26" and "2025-2026" are the same session. */
export const sessionKey = (name: unknown) => {
  const s = String(name ?? "").replace(/\s+/g, "");
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  return (m ? `${m[1]}-${m[1].slice(0, 2)}${m[2]}` : s).toLowerCase();
};

/** The institute's current session. */
export const activeSession = (instituteId: string, transaction?: Transaction) =>
  Session.findOne({ where: { instituteId, isDeleted: false, isActive: true }, order: [["startDate", "DESC"]], transaction });

/** A session of the institute by id or name ("2025-26" finds "2025-2026"); the current one when blank. */
export const findSession = async (instituteId: string, idOrName?: unknown, transaction?: Transaction) => {
  const wanted = String(idOrName ?? "").trim();
  if (!wanted) return activeSession(instituteId, transaction);
  const all = await Session.findAll({ where: { instituteId, isDeleted: false }, transaction });
  return all.find((s) => s.sessionId === wanted) ?? all.find((s) => s.sessionName === wanted) ?? all.find((s) => sessionKey(s.sessionName) === sessionKey(wanted)) ?? null;
};

/** Sessions that haven't ended: the current one and any later one. Past sessions are history. */
export const openSessionIds = async (instituteId: string, transaction?: Transaction) => {
  const all = await Session.findAll({ where: { instituteId, isDeleted: false }, attributes: ["sessionId", "isActive", "startDate"], transaction });
  const current = all.find((s) => s.isActive);
  return all.filter((s) => s.isActive || (current ? new Date(s.startDate) > new Date(current.startDate) : true)).map((s) => s.sessionId);
};

// ─── Teachers ─────────────────────────────────────────────────────────────────

interface TeacherInfo {
  userId: string;
  userName: string;
  teacherType: string | null;
  specialization: string | null;
}

/** Active teachers of the institute among `ids`. */
const loadTeachers = async (instituteId: string, ids: (string | null | undefined)[], transaction?: Transaction) => {
  const wanted = [...new Set(ids.filter(Boolean) as string[])];
  const out = new Map<string, TeacherInfo>();
  if (!wanted.length) return out;
  const role = await Role.findOne({ where: { role: "TEACHER" }, attributes: ["id"], transaction });
  const users = await UserModal.findAll({
    where: { userId: { [Op.in]: wanted }, instituteId, roleId: role?.id ?? -1, status: 1, isDeleted: false },
    attributes: ["userId", "userName"],
    transaction,
  });
  const profiles = await TeacherProfile.findAll({ where: { userId: { [Op.in]: users.map((u) => u.userId) } }, attributes: ["userId", "teacherType", "specialization"], transaction });
  const profileOf = new Map(profiles.map((p) => [p.userId, p]));
  for (const u of users) {
    const p = profileOf.get(u.userId);
    out.set(u.userId, { userId: u.userId, userName: u.userName, teacherType: p?.teacherType ?? null, specialization: p?.specialization ?? null });
  }
  return out;
};

/**
 * Why `teacher` can't be a class teacher in the session (they look after one section; the
 * head teacher isn't a class teacher), or null. `outside` leaves out the rows being
 * rewritten: one section, or a whole class saved at once (so two teachers can swap).
 */
const classTeacherProblem = async (sessionId: string, teacher: TeacherInfo, outside: { sectionId?: string; classId?: string }, transaction?: Transaction) => {
  if (teacher.teacherType === "Head Teacher") return `${teacher.userName} is the head teacher, who isn't a class teacher.`;
  const other = await SessionSection.findOne({
    where: {
      sessionId,
      classTeacherId: teacher.userId,
      ...(outside.sectionId ? { sectionId: { [Op.ne]: outside.sectionId } } : {}),
      ...(outside.classId ? { classId: { [Op.ne]: outside.classId } } : {}),
    },
    include: [
      { model: Section, as: "section", attributes: ["sectionName"] },
      { model: Class, as: "class", attributes: ["className"] },
    ],
    transaction,
  });
  return other
    ? `${teacher.userName} is already class teacher of ${sectionText((other as any).class?.className, (other as any).section?.sectionName)} in this session. A teacher looks after one section.`
    : null;
};

const subjectTeacherProblem = (teacher: TeacherInfo, subjectName: string) =>
  specialisesIn(teacher.specialization, subjectName)
    ? null
    : `${teacher.userName} doesn't teach ${subjectName}. Add it to what they teach first (Manage Teachers → Edit).`;

// ─── Mirrors for older screens ────────────────────────────────────────────────

/**
 * Copies the current session's class teachers and subject teachers onto the master rows
 * (Section.classTeacherId, Subject.teacherId) and sets each teacher's type to follow
 * their post this session. Does nothing for an institute without a current session.
 */
export const syncCurrentMirrors = async (instituteId: string, transaction?: Transaction) => {
  const current = await activeSession(instituteId, transaction);
  if (!current) return;
  const r = { inst: instituteId, cur: current.sessionId };
  const run = (sql: string) => sequelize.query(sql, { replacements: r, transaction, type: QueryTypes.UPDATE });
  await run(`
    UPDATE viaexam_sections s SET "classTeacherId" = x."classTeacherId", "updatedAt" = now()
    FROM (
      SELECT sec."sectionId", ss."classTeacherId"
      FROM viaexam_sections sec
      LEFT JOIN viaexam_session_sections ss ON ss."sectionId" = sec."sectionId" AND ss."sessionId" = :cur
      WHERE sec."instituteId" = :inst
    ) x
    WHERE s."sectionId" = x."sectionId" AND s."classTeacherId" IS DISTINCT FROM x."classTeacherId"`);
  await run(`
    UPDATE viaexam_subjects s SET "teacherId" = x."teacherId", "updatedAt" = now()
    FROM (
      SELECT sub."subjectId", ss."teacherId"
      FROM viaexam_subjects sub
      LEFT JOIN viaexam_session_subjects ss ON ss."subjectId" = sub."subjectId" AND ss."sessionId" = :cur
      WHERE sub."instituteId" = :inst
    ) x
    WHERE s."subjectId" = x."subjectId" AND s."teacherId" IS DISTINCT FROM x."teacherId"`);
  // A teacher with a section this session is a class teacher; the head teacher stays head teacher.
  await run(`
    UPDATE viaexam_teacher_profiles tp
    SET "teacherType" = x.type, "updatedAt" = now()
    FROM (
      SELECT p."userId",
             CASE WHEN EXISTS (SELECT 1 FROM viaexam_session_sections ss WHERE ss."sessionId" = :cur AND ss."classTeacherId" = p."userId")
                  THEN 'Class Teacher' ELSE 'Subject Teacher' END AS type
      FROM viaexam_teacher_profiles p
      WHERE p."instituteId" = :inst AND p."teacherType" IS DISTINCT FROM 'Head Teacher'
    ) x
    WHERE tp."userId" = x."userId" AND tp."teacherType" IS DISTINCT FROM x.type`);
};

// ─── Writes used by other services ────────────────────────────────────────────

/** Makes a section run in a session (no class teacher yet) if it doesn't already. */
export const ensureSectionRuns = async (instituteId: string, sessionId: string, classId: string, sectionId: string, transaction?: Transaction) => {
  await SessionSection.findOrCreate({
    where: { sessionId, sectionId },
    defaults: { instituteId, sessionId, classId, sectionId, classTeacherId: null },
    transaction,
  });
};

/** Adds new master sections / subjects to the current session (they were added to be used now). */
export const addToCurrentSession = async (
  instituteId: string,
  items: { sections?: { classId: string; sectionId: string; classTeacherId?: string | null }[]; subjects?: { classId: string; subjectId: string; teacherId?: string | null }[] },
  transaction?: Transaction
) => {
  const current = await activeSession(instituteId, transaction);
  if (!current) return;
  for (const s of items.sections ?? []) {
    const [row, created] = await SessionSection.findOrCreate({
      where: { sessionId: current.sessionId, sectionId: s.sectionId },
      defaults: { instituteId, sessionId: current.sessionId, classId: s.classId, sectionId: s.sectionId, classTeacherId: s.classTeacherId ?? null },
      transaction,
    });
    if (!created && s.classTeacherId !== undefined && row.classTeacherId !== s.classTeacherId) await row.update({ classTeacherId: s.classTeacherId ?? null }, { transaction });
  }
  for (const s of items.subjects ?? []) {
    const [row, created] = await SessionSubject.findOrCreate({
      where: { sessionId: current.sessionId, subjectId: s.subjectId },
      defaults: { instituteId, sessionId: current.sessionId, classId: s.classId, subjectId: s.subjectId, teacherId: s.teacherId ?? null },
      transaction,
    });
    if (!created && s.teacherId !== undefined && row.teacherId !== s.teacherId) await row.update({ teacherId: s.teacherId ?? null }, { transaction });
  }
  await syncCurrentMirrors(instituteId, transaction);
};

/** A school's first session takes every class, section and subject of the master data, with their teachers. */
export const startFromMasterData = async (instituteId: string, sessionId: string, transaction?: Transaction) => {
  const r = { inst: instituteId, ses: sessionId };
  await sequelize.query(
    `INSERT INTO viaexam_session_sections ("instituteId", "sessionId", "classId", "sectionId", "classTeacherId", "createdAt", "updatedAt")
     SELECT sec."instituteId", :ses, sec."classId", sec."sectionId", sec."classTeacherId", now(), now()
     FROM viaexam_sections sec JOIN viaexam_classes c ON c."classId" = sec."classId" AND c."isDeleted" = false
     WHERE sec."instituteId" = :inst AND sec."isDeleted" = false
     ON CONFLICT DO NOTHING`,
    { replacements: r, transaction }
  );
  await sequelize.query(
    `INSERT INTO viaexam_session_subjects ("instituteId", "sessionId", "classId", "subjectId", "teacherId", "createdAt", "updatedAt")
     SELECT sub."instituteId", :ses, sub."classId", sub."subjectId", sub."teacherId", now(), now()
     FROM viaexam_subjects sub JOIN viaexam_classes c ON c."classId" = sub."classId" AND c."isDeleted" = false
     WHERE sub."instituteId" = :inst AND sub."isDeleted" = false
     ON CONFLICT DO NOTHING`,
    { replacements: r, transaction }
  );
};

/** Takes a teacher off every section and subject of the sessions that haven't ended (they are leaving). */
export const releaseTeacher = async (instituteId: string, teacherId: string, transaction?: Transaction) => {
  const open = await openSessionIds(instituteId, transaction);
  if (!open.length) return { sections: 0, subjects: 0 };
  const [sections] = await SessionSection.update({ classTeacherId: null }, { where: { instituteId, classTeacherId: teacherId, sessionId: { [Op.in]: open } }, transaction });
  const [subjects] = await SessionSubject.update({ teacherId: null }, { where: { instituteId, teacherId, sessionId: { [Op.in]: open } }, transaction });
  await syncCurrentMirrors(instituteId, transaction);
  return { sections, subjects };
};

/** Removes every session row of a deleted section / subject / class (the caller checked nothing uses it). */
export const forgetMasterRows = async (where: { sectionId?: string; subjectId?: string; classId?: string }, transaction?: Transaction) => {
  if (where.sectionId) await SessionSection.destroy({ where: { sectionId: where.sectionId }, transaction });
  if (where.subjectId) await SessionSubject.destroy({ where: { subjectId: where.subjectId }, transaction });
  if (where.classId) {
    await SessionSection.destroy({ where: { classId: where.classId }, transaction });
    await SessionSubject.destroy({ where: { classId: where.classId }, transaction });
  }
};

// ─── Reads used by other services ─────────────────────────────────────────────

/** Subjects taught in a class in a session, with their teacher. */
export const subjectsInSession = (sessionId: string, classId?: string, transaction?: Transaction) =>
  SessionSubject.findAll({ where: { sessionId, ...(classId ? { classId } : {}) }, transaction });

/** The subject's teacher in a session (null when it has none or isn't taught then). */
export const subjectTeacherIn = async (sessionId: string, subjectId: string) =>
  (await SessionSubject.findOne({ where: { sessionId, subjectId }, attributes: ["teacherId"] }))?.teacherId ?? null;

export const isTaughtIn = async (sessionId: string, subjectId: string, transaction?: Transaction) =>
  Boolean(await SessionSubject.findOne({ where: { sessionId, subjectId }, attributes: ["id"], transaction }));

export const sectionRunsIn = async (sessionId: string, sectionId: string, transaction?: Transaction) =>
  Boolean(await SessionSection.findOne({ where: { sessionId, sectionId }, attributes: ["id"], transaction }));

// ─── Counts ───────────────────────────────────────────────────────────────────

const countBy = async (sql: string, replacements: Record<string, unknown>, transaction?: Transaction) => {
  const rows = (await sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction })) as { k: string; n: number }[];
  return new Map(rows.filter((r) => r.k).map((r) => [String(r.k), Number(r.n)]));
};

/** Active students per section in a session. */
const studentsPerSection = (sessionId: string, transaction?: Transaction) =>
  countBy(
    `SELECT e."sectionId" AS k, COUNT(*)::int AS n FROM viaexam_student_enrollments e
     JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
     WHERE e."sessionId" = :ses AND e."isActive" = true GROUP BY 1`,
    { ses: sessionId },
    transaction
  );

/** Live exams of a session per subject, per section (section exams) and per class. */
const examsIn = async (sessionId: string, transaction?: Transaction) => {
  const rows = (await Exam.findAll({ where: { sessionId, isDeleted: false }, attributes: ["classId", "sectionId", "subjectId"], raw: true, transaction })) as any[];
  const add = (m: Map<string, number>, k: string | null) => k && m.set(k, (m.get(k) ?? 0) + 1);
  const bySubject = new Map<string, number>();
  const bySection = new Map<string, number>();
  const byClass = new Map<string, number>();
  for (const e of rows) {
    add(bySubject, e.subjectId);
    add(bySection, e.sectionId);
    add(byClass, e.classId);
  }
  return { bySubject, bySection, byClass, wholeClass: new Set(rows.filter((e) => !e.sectionId).map((e) => e.classId as string)) };
};

// ─── GET /session-setup/:sessionId ─────────────────────────────────────────────

const getSetup = async (user: any, sessionParam?: string) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    const session = await findSession(instituteId, sessionParam);
    if (!session) return fail(httpStatus.NOT_FOUND, sessionParam ? "Session not found." : "No current session yet. Create one in Master Data → Sessions.");

    const [sessions, classes, sections, subjects, runSections, runSubjects, students, exams] = await Promise.all([
      Session.findAll({ where: { instituteId, isDeleted: false }, order: [["startDate", "DESC"]] }),
      Class.findAll({ where: { instituteId, isDeleted: false }, attributes: ["classId", "className"] }),
      Section.findAll({ where: { instituteId, isDeleted: false }, attributes: ["sectionId", "sectionName", "classId"] }),
      Subject.findAll({ where: { instituteId, isDeleted: false }, attributes: ["subjectId", "subjectName", "subjectCode", "classId", "sectionId"] }),
      SessionSection.findAll({ where: { sessionId: session.sessionId }, include: [{ model: UserModal, as: "classTeacher", attributes: ["userId", "userName"], required: false }] }),
      SessionSubject.findAll({ where: { sessionId: session.sessionId }, include: [{ model: UserModal, as: "teacher", attributes: ["userId", "userName"], required: false }] }),
      studentsPerSection(session.sessionId),
      examsIn(session.sessionId),
    ]);

    // What each session holds, for the session picker.
    const [setupCounts, enrolled] = await Promise.all([
      countBy(`SELECT "sessionId" AS k, COUNT(DISTINCT "classId")::int AS n FROM viaexam_session_sections WHERE "instituteId" = :inst GROUP BY 1`, { inst: instituteId }),
      countBy(
        `SELECT e."sessionId" AS k, COUNT(*)::int AS n FROM viaexam_student_enrollments e
         JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
         WHERE e."instituteId" = :inst AND e."isActive" = true GROUP BY 1`,
        { inst: instituteId }
      ),
    ]);

    const runSec = new Map(runSections.map((r) => [r.sectionId, r]));
    const runSub = new Map(runSubjects.map((r) => [r.subjectId, r]));
    const sectionName = new Map(sections.map((s) => [s.sectionId, s.sectionName]));
    const person = (u: any) => (u ? { userId: u.userId, userName: u.userName } : null);

    const rows = classes
      .map((c) => {
        const secs = sections
          .filter((s) => s.classId === c.classId)
          .sort((a, b) => byName(a.sectionName, b.sectionName))
          .map((s) => {
            const run = runSec.get(s.sectionId);
            return {
              sectionId: s.sectionId,
              sectionName: s.sectionName,
              running: Boolean(run),
              classTeacher: person((run as any)?.classTeacher) ?? (run?.classTeacherId ? { userId: run.classTeacherId, userName: "Unknown teacher" } : null),
              students: students.get(s.sectionId) ?? 0,
              exams: exams.bySection.get(s.sectionId) ?? 0,
            };
          });
        const subs = subjects
          .filter((s) => s.classId === c.classId)
          .sort((a, b) => byName(a.subjectName, b.subjectName) || byName(sectionName.get(a.sectionId ?? "") ?? "", sectionName.get(b.sectionId ?? "") ?? ""))
          .map((s) => {
            const run = runSub.get(s.subjectId);
            return {
              subjectId: s.subjectId,
              subjectName: s.subjectName,
              subjectCode: s.subjectCode ?? null,
              sectionId: s.sectionId ?? null,
              sectionName: s.sectionId ? (sectionName.get(s.sectionId) ?? null) : null,
              running: Boolean(run),
              teacher: person((run as any)?.teacher) ?? (run?.teacherId ? { userId: run.teacherId, userName: "Unknown teacher" } : null),
              exams: exams.bySubject.get(s.subjectId) ?? 0,
            };
          });
        const running = secs.some((s) => s.running) || subs.some((s) => s.running);
        return {
          classId: c.classId,
          className: c.className,
          running,
          students: secs.reduce((n, s) => n + s.students, 0),
          exams: exams.byClass.get(c.classId) ?? 0,
          sections: secs,
          subjects: subs,
        };
      })
      .sort((a, b) => byName(a.className, b.className));

    const live = rows.filter((c) => c.running);
    const liveSections = live.flatMap((c) => c.sections.filter((s) => s.running));
    const liveSubjects = live.flatMap((c) => c.subjects.filter((s) => s.running));
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Session setup loaded.",
      data: {
        session: { sessionId: session.sessionId, sessionName: session.sessionName, isActive: session.isActive, startDate: iso(session.startDate), endDate: iso(session.endDate) },
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          sessionName: s.sessionName,
          isActive: s.isActive,
          startDate: iso(s.startDate),
          endDate: iso(s.endDate),
          classes: setupCounts.get(s.sessionId) ?? 0,
          students: enrolled.get(s.sessionId) ?? 0,
        })),
        classes: rows,
        totals: {
          classes: live.length,
          sections: liveSections.length,
          sectionsWithoutTeacher: liveSections.filter((s) => !s.classTeacher).length,
          subjects: liveSubjects.length,
          subjectsWithoutTeacher: liveSubjects.filter((s) => !s.teacher).length,
          students: liveSections.reduce((n, s) => n + s.students, 0),
        },
      },
    };
  } catch (e: any) {
    console.error("getSetup failed:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't load the session setup: ${e.message}`);
  }
};

// ─── PUT /session-setup/:sessionId/classes/:classId ────────────────────────────
// The whole of one class in one session: the sections that run (with class teachers)
// and the subjects taught (with subject teachers). Rows left out are removed, unless
// students or exams of the session still use them.

interface ClassSetupBody {
  sections?: { sectionId: string; classTeacherId?: string | null }[];
  subjects?: { subjectId: string; teacherId?: string | null }[];
}

const saveClass = async (user: any, sessionParam: string, classId: string, body: ClassSetupBody) => {
  const instituteId = String(user?.instituteId ?? "");
  try {
    const session = await findSession(instituteId, sessionParam);
    if (!session) return fail(httpStatus.NOT_FOUND, "Session not found.");
    const cls = await Class.findOne({ where: { classId, instituteId, isDeleted: false } });
    if (!cls) return fail(httpStatus.NOT_FOUND, "Class not found.");

    const wantSections = Array.isArray(body?.sections) ? body.sections : [];
    const wantSubjects = Array.isArray(body?.subjects) ? body.subjects : [];
    const [sections, subjects, current, currentSubjects, students, exams] = await Promise.all([
      Section.findAll({ where: { classId, instituteId, isDeleted: false } }),
      Subject.findAll({ where: { classId, instituteId, isDeleted: false } }),
      SessionSection.findAll({ where: { sessionId: session.sessionId, classId } }),
      SessionSubject.findAll({ where: { sessionId: session.sessionId, classId } }),
      studentsPerSection(session.sessionId),
      examsIn(session.sessionId),
    ]);
    const sectionById = new Map(sections.map((s) => [s.sectionId, s]));
    const subjectById = new Map(subjects.map((s) => [s.subjectId, s]));
    const where = classText(cls.className);

    const problems: string[] = [];
    const sectionIds = new Set<string>();
    for (const s of wantSections) {
      if (!sectionById.has(String(s?.sectionId))) problems.push(`A chosen section is not part of ${where}. Refresh and try again.`);
      else sectionIds.add(String(s.sectionId));
    }
    const subjectIds = new Set<string>();
    for (const s of wantSubjects) {
      const subject = subjectById.get(String(s?.subjectId));
      if (!subject) problems.push(`A chosen subject is not part of ${where}. Refresh and try again.`);
      else if (subject.sectionId && !sectionIds.has(subject.sectionId)) {
        problems.push(`${subject.subjectName} is taught in section ${sectionById.get(subject.sectionId)?.sectionName ?? ""} only; that section has to run too.`);
      } else subjectIds.add(subject.subjectId);
    }

    // Removing what the session already uses is refused, with the reason.
    for (const row of current) {
      if (sectionIds.has(row.sectionId)) continue;
      const name = sectionText(cls.className, sectionById.get(row.sectionId)?.sectionName);
      const n = students.get(row.sectionId) ?? 0;
      if (n) problems.push(`${name} has ${plural(n, "student")} in ${session.sessionName}; move them before taking the section out.`);
      const x = exams.bySection.get(row.sectionId) ?? 0;
      if (x) problems.push(`${name} has ${plural(x, "exam")} in ${session.sessionName}, so it stays.`);
    }
    if (!sectionIds.size && exams.wholeClass.has(classId)) problems.push(`${where} has exams in ${session.sessionName}, so at least one section stays.`);
    for (const row of currentSubjects) {
      if (subjectIds.has(row.subjectId)) continue;
      const x = exams.bySubject.get(row.subjectId) ?? 0;
      if (x) problems.push(`${subjectById.get(row.subjectId)?.subjectName ?? "A subject"} has ${plural(x, "exam")} in ${session.sessionName}, so it stays.`);
    }

    // Teachers: active, a class teacher looks after one section, a subject teacher teaches the subject.
    const teachers = await loadTeachers(instituteId, [...wantSections.map((s) => s.classTeacherId), ...wantSubjects.map((s) => s.teacherId)]);
    const posts = new Set<string>();
    for (const s of wantSections) {
      if (!s.classTeacherId || !sectionIds.has(String(s.sectionId))) continue;
      const t = teachers.get(s.classTeacherId);
      if (!t) {
        problems.push("A chosen class teacher was not found or is deactivated.");
        continue;
      }
      if (posts.has(t.userId)) problems.push(`${t.userName} can be class teacher of one section only.`);
      posts.add(t.userId);
      const problem = await classTeacherProblem(session.sessionId, t, { classId });
      if (problem) problems.push(problem);
    }
    for (const s of wantSubjects) {
      if (!s.teacherId || !subjectIds.has(String(s.subjectId))) continue;
      const t = teachers.get(s.teacherId);
      if (!t) {
        problems.push("A chosen subject teacher was not found or is deactivated.");
        continue;
      }
      const problem = subjectTeacherProblem(t, subjectById.get(String(s.subjectId))!.subjectName);
      if (problem) problems.push(problem);
    }
    if (problems.length) {
      const unique = [...new Set(problems)];
      return fail(httpStatus.CONFLICT, unique.length === 1 ? unique[0] : `${unique.length} things need fixing first.`, { problems: unique });
    }

    await sequelize.transaction(async (t) => {
      for (const row of current) if (!sectionIds.has(row.sectionId)) await row.destroy({ transaction: t });
      for (const row of currentSubjects) if (!subjectIds.has(row.subjectId)) await row.destroy({ transaction: t });
      const secRow = new Map(current.map((r) => [r.sectionId, r]));
      for (const s of wantSections) {
        const id = String(s.sectionId);
        const teacher = s.classTeacherId ? String(s.classTeacherId) : null;
        const row = secRow.get(id);
        if (row) {
          if (row.classTeacherId !== teacher) await row.update({ classTeacherId: teacher }, { transaction: t });
        } else {
          await SessionSection.create({ instituteId, sessionId: session.sessionId, classId, sectionId: id, classTeacherId: teacher }, { transaction: t });
        }
      }
      const subRow = new Map(currentSubjects.map((r) => [r.subjectId, r]));
      for (const s of wantSubjects) {
        const id = String(s.subjectId);
        const teacher = s.teacherId ? String(s.teacherId) : null;
        const row = subRow.get(id);
        if (row) {
          if (row.teacherId !== teacher) await row.update({ teacherId: teacher }, { transaction: t });
        } else {
          await SessionSubject.create({ instituteId, sessionId: session.sessionId, classId, subjectId: id, teacherId: teacher }, { transaction: t });
        }
      }
      if (session.isActive) await syncCurrentMirrors(instituteId, t);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: sectionIds.size || subjectIds.size
        ? `${where} saved for ${session.sessionName}: ${plural(sectionIds.size, "section")}, ${plural(subjectIds.size, "subject")}.`
        : `${where} taken out of ${session.sessionName}.`,
      data: { sections: sectionIds.size, subjects: subjectIds.size },
    };
  } catch (e: any) {
    console.error("saveClass failed:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't save the class: ${e.message}`);
  }
};

// ─── PATCH one class teacher / one subject teacher ────────────────────────────

const setClassTeacher = async (user: any, sessionParam: string, sectionId: string, teacherId: string | null) => {
  const instituteId = String(user?.instituteId ?? "");
  try {
    const session = await findSession(instituteId, sessionParam);
    if (!session) return fail(httpStatus.NOT_FOUND, "Session not found.");
    const section = await Section.findOne({ where: { sectionId, instituteId, isDeleted: false }, include: [{ model: Class, as: "class", attributes: ["className"] }] });
    if (!section) return fail(httpStatus.NOT_FOUND, "Section not found.");
    const name = sectionText((section as any).class?.className, section.sectionName);
    let teacher: TeacherInfo | null = null;
    if (teacherId) {
      teacher = (await loadTeachers(instituteId, [teacherId])).get(teacherId) ?? null;
      if (!teacher) return fail(httpStatus.NOT_FOUND, "That teacher was not found or is deactivated.");
      const problem = await classTeacherProblem(session.sessionId, teacher, { sectionId });
      if (problem) return fail(httpStatus.CONFLICT, problem);
    }
    await sequelize.transaction(async (t) => {
      const [row] = await SessionSection.findOrCreate({
        where: { sessionId: session.sessionId, sectionId },
        defaults: { instituteId, sessionId: session.sessionId, classId: section.classId, sectionId, classTeacherId: null },
        transaction: t,
      });
      await row.update({ classTeacherId: teacher?.userId ?? null }, { transaction: t });
      if (session.isActive) await syncCurrentMirrors(instituteId, t);
    });
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: teacher ? `${teacher.userName} is class teacher of ${name} in ${session.sessionName}.` : `${name} has no class teacher in ${session.sessionName} now.`,
      data: { sectionId, classTeacherId: teacher?.userId ?? null },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't save the class teacher: ${e.message}`);
  }
};

const setSubjectTeacher = async (user: any, sessionParam: string, subjectId: string, teacherId: string | null) => {
  const instituteId = String(user?.instituteId ?? "");
  try {
    const session = await findSession(instituteId, sessionParam);
    if (!session) return fail(httpStatus.NOT_FOUND, "Session not found.");
    const subject = await Subject.findOne({ where: { subjectId, instituteId, isDeleted: false }, include: [{ model: Class, as: "class", attributes: ["className"] }] });
    if (!subject) return fail(httpStatus.NOT_FOUND, "Subject not found.");
    let teacher: TeacherInfo | null = null;
    if (teacherId) {
      teacher = (await loadTeachers(instituteId, [teacherId])).get(teacherId) ?? null;
      if (!teacher) return fail(httpStatus.NOT_FOUND, "That teacher was not found or is deactivated.");
      const problem = subjectTeacherProblem(teacher, subject.subjectName);
      if (problem) return fail(httpStatus.BAD_REQUEST, problem);
    }
    await sequelize.transaction(async (t) => {
      const [row] = await SessionSubject.findOrCreate({
        where: { sessionId: session.sessionId, subjectId },
        defaults: { instituteId, sessionId: session.sessionId, classId: subject.classId, subjectId, teacherId: null },
        transaction: t,
      });
      await row.update({ teacherId: teacher?.userId ?? null }, { transaction: t });
      if (session.isActive) await syncCurrentMirrors(instituteId, t);
    });
    const where = classText((subject as any).class?.className);
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: teacher
        ? `${teacher.userName} teaches ${subject.subjectName} in ${where} in ${session.sessionName}.`
        : `${subject.subjectName} in ${where} has no teacher in ${session.sessionName} now.`,
      data: { subjectId, teacherId: teacher?.userId ?? null },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't save the subject teacher: ${e.message}`);
  }
};

// ─── POST /session-setup/:sessionId/copy ───────────────────────────────────────
// Brings classes over from another session: their sections and subjects, and if asked,
// their class teachers and subject teachers. What the session already has is kept as it
// is; teachers who left, or who already hold a section here, are skipped and listed.

interface CopyBody {
  fromSessionId?: string;
  classIds?: string[];
  classTeachers?: boolean;
  subjectTeachers?: boolean;
  /** Also each subject's marks for every exam (Marks & grading). Default: yes. */
  marks?: boolean;
}

const copySetup = async (user: any, sessionParam: string, body: CopyBody) => {
  const instituteId = String(user?.instituteId ?? "");
  try {
    const [target, source] = await Promise.all([findSession(instituteId, sessionParam), findSession(instituteId, body?.fromSessionId)]);
    if (!target) return fail(httpStatus.NOT_FOUND, "Session not found.");
    if (!source || !body?.fromSessionId) return fail(httpStatus.BAD_REQUEST, "Choose the session to copy from.");
    if (source.sessionId === target.sessionId) return fail(httpStatus.BAD_REQUEST, "Choose another session to copy from.");

    const onlyClasses = Array.isArray(body.classIds) && body.classIds.length ? new Set(body.classIds.map(String)) : null;
    const [liveClasses, liveSections, liveSubjects, fromSections, fromSubjects, haveSections, haveSubjects] = await Promise.all([
      Class.findAll({ where: { instituteId, isDeleted: false }, attributes: ["classId", "className"] }),
      Section.findAll({ where: { instituteId, isDeleted: false }, attributes: ["sectionId", "sectionName", "classId"] }),
      Subject.findAll({ where: { instituteId, isDeleted: false }, attributes: ["subjectId", "subjectName", "classId"] }),
      SessionSection.findAll({ where: { sessionId: source.sessionId } }),
      SessionSubject.findAll({ where: { sessionId: source.sessionId } }),
      SessionSection.findAll({ where: { sessionId: target.sessionId } }),
      SessionSubject.findAll({ where: { sessionId: target.sessionId } }),
    ]);
    const classIds = new Set(liveClasses.map((c) => c.classId));
    const className = new Map(liveClasses.map((c) => [c.classId, c.className]));
    const sectionOf = new Map(liveSections.map((s) => [s.sectionId, s]));
    const subjectOf = new Map(liveSubjects.map((s) => [s.subjectId, s]));
    const keep = (classId: string) => classIds.has(classId) && (!onlyClasses || onlyClasses.has(classId));
    const sections = fromSections.filter((r) => keep(r.classId) && sectionOf.has(r.sectionId));
    const subjects = fromSubjects.filter((r) => keep(r.classId) && subjectOf.has(r.subjectId));
    if (!sections.length && !subjects.length) {
      return fail(httpStatus.BAD_REQUEST, `${source.sessionName} has nothing to copy${onlyClasses ? " for the chosen classes" : ""}.`);
    }

    const teachers = await loadTeachers(instituteId, [
      ...(body.classTeachers ? sections.map((r) => r.classTeacherId) : []),
      ...(body.subjectTeachers ? subjects.map((r) => r.teacherId) : []),
    ]);
    const hasSection = new Map(haveSections.map((r) => [r.sectionId, r]));
    const hasSubject = new Map(haveSubjects.map((r) => [r.subjectId, r]));
    const heldPosts = new Map(haveSections.filter((r) => r.classTeacherId).map((r) => [r.classTeacherId as string, r.sectionId]));
    const skipped: string[] = [];
    const counts = { sections: 0, subjects: 0, classTeachers: 0, subjectTeachers: 0, kept: 0, marks: 0 };

    await sequelize.transaction(async (t) => {
      for (const r of sections) {
        if (hasSection.has(r.sectionId)) {
          counts.kept += 1;
          continue;
        }
        let teacherId: string | null = null;
        if (body.classTeachers && r.classTeacherId) {
          const teacher = teachers.get(r.classTeacherId);
          const name = sectionText(className.get(r.classId), sectionOf.get(r.sectionId)?.sectionName);
          if (!teacher) skipped.push(`Class teacher of ${name}: no longer an active teacher.`);
          else if (teacher.teacherType === "Head Teacher") skipped.push(`Class teacher of ${name}: ${teacher.userName} is now the head teacher.`);
          else if (heldPosts.has(teacher.userId)) skipped.push(`Class teacher of ${name}: ${teacher.userName} already looks after another section in ${target.sessionName}.`);
          else {
            teacherId = teacher.userId;
            heldPosts.set(teacher.userId, r.sectionId);
            counts.classTeachers += 1;
          }
        }
        await SessionSection.create({ instituteId, sessionId: target.sessionId, classId: r.classId, sectionId: r.sectionId, classTeacherId: teacherId }, { transaction: t });
        counts.sections += 1;
      }
      for (const r of subjects) {
        if (hasSubject.has(r.subjectId)) {
          counts.kept += 1;
          continue;
        }
        let teacherId: string | null = null;
        if (body.subjectTeachers && r.teacherId) {
          const teacher = teachers.get(r.teacherId);
          const subject = subjectOf.get(r.subjectId)!;
          if (!teacher) skipped.push(`${subject.subjectName} (${classText(className.get(r.classId))}): its teacher is no longer active.`);
          else {
            teacherId = teacher.userId;
            counts.subjectTeachers += 1;
          }
        }
        await SessionSubject.create({ instituteId, sessionId: target.sessionId, classId: r.classId, subjectId: r.subjectId, teacherId }, { transaction: t });
        counts.subjects += 1;
      }
      // Each subject's marks for every exam, where the new session has none yet.
      if (body.marks !== false) {
        const subjectIds = subjects.map((r) => r.subjectId);
        // One after the other: a transaction's queries share one connection.
        const fromMarks = subjectIds.length ? await MarksScheme.findAll({ where: { sessionId: source.sessionId, subjectId: { [Op.in]: subjectIds } }, transaction: t }) : [];
        const haveMarks = subjectIds.length
          ? await MarksScheme.findAll({ where: { sessionId: target.sessionId, subjectId: { [Op.in]: subjectIds } }, attributes: ["subjectId", "examType"], transaction: t })
          : [];
        const has = new Set(haveMarks.map((m) => `${m.subjectId}|${m.examType}`));
        for (const m of fromMarks) {
          if (has.has(`${m.subjectId}|${m.examType}`)) continue;
          await MarksScheme.create(
            { instituteId, sessionId: target.sessionId, examType: m.examType, classId: m.classId, subjectId: m.subjectId, maxMarks: m.maxMarks, passMarks: m.passMarks, updatedBy: user.userId },
            { transaction: t }
          );
          await MarksAudit.create(
            {
              instituteId,
              what: MARKS_CHANGE.MAX,
              source: MARKS_SOURCE.SETUP,
              changedBy: user.userId,
              sessionId: target.sessionId,
              examType: m.examType,
              subjectId: m.subjectId,
              newValue: `${m.maxMarks} (pass ${m.passMarks})`,
              reason: `Copied from ${source.sessionName}`,
            },
            { transaction: t }
          );
          counts.marks += 1;
        }
      }

      if (target.isActive) await syncCurrentMirrors(instituteId, t);
    });

    const parts = [plural(counts.sections, "section"), plural(counts.subjects, "subject")];
    if (body.classTeachers || body.subjectTeachers) parts.push(`${counts.classTeachers + counts.subjectTeachers} teachers`);
    if (counts.marks) parts.push(`marks for ${plural(counts.marks, "subject exam", "subject exams")}`);
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: counts.sections || counts.subjects || counts.marks
        ? `Copied from ${source.sessionName}: ${parts.join(", ")}.${counts.kept ? ` ${plural(counts.kept, "row")} ${target.sessionName} already had stayed as they were.` : ""}`
        : `${target.sessionName} already has everything chosen; nothing was copied.`,
      data: { ...counts, skipped },
    };
  } catch (e: any) {
    console.error("copySetup failed:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Couldn't copy the setup: ${e.message}`);
  }
};

export default { getSetup, saveClass, setClassTeacher, setSubjectTeacher, copySetup };
