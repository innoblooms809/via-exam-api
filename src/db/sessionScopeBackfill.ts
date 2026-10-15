/**
 * One-time fill of the per-session tables from the data the school already has.
 * Runs at startup (after sync() has created the tables), once per database: a row in
 * viaexam_data_jobs records that it ran, and an advisory lock keeps two API instances
 * from running it together. Only the new tables are written (and the profile copies
 * brought in line), so existing data is never lost.
 *
 *   enrolments      every student profile → a row in the session it names ("2025-26"
 *                   finds "2025-2026"; a name matching no session falls back to the
 *                   current session); plus earlier years recovered from published
 *                   results and absent marks
 *   session setup   the current session gets every section and subject with today's
 *                   class / subject teachers; every session gets the sections and
 *                   subjects its exams and students used (teachers unknown → empty)
 */

import { QueryTypes } from "sequelize";
import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import Session from "../models/Session.model";
import { syncCurrentMirrors } from "../services/academic/sessionSetup.service";
import { syncStudentProfiles } from "../services/student/enrollment.service";

const JOB = "session-scope-v1";

// "2025-26" → "2025-2026"; spaces removed. Used on both sides of a session-name match.
const NORM = (col: string) =>
  `(CASE WHEN regexp_replace(${col}, '\\s', '', 'g') ~ '^[0-9]{4}-[0-9]{2}$'
         THEN substr(regexp_replace(${col}, '\\s', '', 'g'), 1, 4) || '-' || substr(regexp_replace(${col}, '\\s', '', 'g'), 1, 2) || substr(regexp_replace(${col}, '\\s', '', 'g'), 6, 2)
         ELSE lower(regexp_replace(${col}, '\\s', '', 'g')) END)`;

const ENROLMENTS_FROM_PROFILES = `
INSERT INTO viaexam_student_enrollments ("enrollmentId", "instituteId", "studentId", "sessionId", "classId", "sectionId", "rollNumber", "isActive", "createdAt", "updatedAt")
SELECT 'VIENR' || upper(substr(md5(p."userId" || ':' || ses."sessionId"), 1, 10)),
       p."instituteId", p."userId", ses."sessionId", cls."classId", COALESCE(s1."sectionId", s2."sectionId"),
       COALESCE(NULLIF(trim(p."rollNumber"), ''), '-'),
       (p."isActive" AND u.status = 1), p."createdAt", now()
FROM viaexam_student_profiles p
JOIN viaexam_users u ON u."userId" = p."userId"
JOIN LATERAL (
  SELECT se."sessionId" FROM viaexam_sessions se
  WHERE se."instituteId" = p."instituteId" AND se."isDeleted" = false
  ORDER BY (se."sessionName" = p.session) DESC, (${NORM('se."sessionName"')} = ${NORM("p.session")}) DESC, se."isActive" DESC, se."startDate" DESC
  LIMIT 1
) ses ON true
JOIN LATERAL (
  SELECT c."classId" FROM viaexam_classes c
  WHERE c."instituteId" = p."instituteId" AND (c."classId" = p."classId" OR lower(c."className") = lower(p."className"))
  ORDER BY (c."classId" = p."classId") DESC, c."isDeleted" ASC
  LIMIT 1
) cls ON true
LEFT JOIN viaexam_sections s1 ON s1."sectionId" = p."sectionId"
LEFT JOIN viaexam_sections s2 ON s1."sectionId" IS NULL AND s2."classId" = cls."classId" AND lower(s2."sectionName") = lower(p."sectionId") AND s2."isDeleted" = false
ON CONFLICT DO NOTHING`;

// Earlier years: the class, section and roll a published result was given under.
const ENROLMENTS_FROM_RESULTS = `
INSERT INTO viaexam_student_enrollments ("enrollmentId", "instituteId", "studentId", "sessionId", "classId", "sectionId", "rollNumber", "isActive", "createdAt", "updatedAt")
SELECT DISTINCT ON (r."studentId", r."sessionId")
       'VIENR' || upper(substr(md5(r."studentId" || ':' || r."sessionId"), 1, 10)),
       r."instituteId", r."studentId", r."sessionId", r."classId", r."sectionId", COALESCE(NULLIF(trim(r."rollNo"), ''), '-'), true, r."publishedAt", now()
FROM viaexam_student_results r
JOIN viaexam_sessions se ON se."sessionId" = r."sessionId"
WHERE r."isDeleted" = false AND r."classId" IS NOT NULL
ORDER BY r."studentId", r."sessionId", r."publishedAt" DESC
ON CONFLICT DO NOTHING`;

// …and the class of an exam a student was marked absent in.
const ENROLMENTS_FROM_ATTENDANCE = `
INSERT INTO viaexam_student_enrollments ("enrollmentId", "instituteId", "studentId", "sessionId", "classId", "sectionId", "rollNumber", "isActive", "createdAt", "updatedAt")
SELECT DISTINCT ON (a."studentId", e."sessionId")
       'VIENR' || upper(substr(md5(a."studentId" || ':' || e."sessionId"), 1, 10)),
       a."instituteId", a."studentId", e."sessionId", e."classId", sec."sectionId", COALESCE(NULLIF(trim(a."rollNo"), ''), '-'), true, a."createdAt", now()
FROM viaexam_exam_attendance a
JOIN viaexam_exams e ON e."examId" = a."examId" AND e."classId" IS NOT NULL
JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
ORDER BY a."studentId", e."sessionId", a."createdAt" DESC
ON CONFLICT DO NOTHING`;

const SECTIONS_OF_CURRENT_SESSION = `
INSERT INTO viaexam_session_sections ("instituteId", "sessionId", "classId", "sectionId", "classTeacherId", "createdAt", "updatedAt")
SELECT sec."instituteId", cur."sessionId", sec."classId", sec."sectionId", sec."classTeacherId", now(), now()
FROM viaexam_sections sec
JOIN viaexam_classes c ON c."classId" = sec."classId" AND c."isDeleted" = false
JOIN LATERAL (
  SELECT "sessionId" FROM viaexam_sessions
  WHERE "instituteId" = sec."instituteId" AND "isDeleted" = false AND "isActive" = true
  ORDER BY "startDate" DESC LIMIT 1
) cur ON true
WHERE sec."isDeleted" = false
ON CONFLICT DO NOTHING`;

const SECTIONS_USED = `
INSERT INTO viaexam_session_sections ("instituteId", "sessionId", "classId", "sectionId", "classTeacherId", "createdAt", "updatedAt")
SELECT DISTINCT x."instituteId", x."sessionId", sec."classId", sec."sectionId", NULL::varchar, now(), now()
FROM (
  SELECT e."instituteId", e."sessionId", e."sectionId", NULL::varchar AS "classId" FROM viaexam_student_enrollments e WHERE e."sectionId" IS NOT NULL
  UNION ALL
  SELECT x."instituteId", x."sessionId", x."sectionId", x."classId" FROM viaexam_exams x WHERE x."isDeleted" = false
) x
JOIN viaexam_sessions se ON se."sessionId" = x."sessionId"
JOIN viaexam_sections sec ON (x."sectionId" IS NOT NULL AND x."sectionId" <> '' AND sec."sectionId" = x."sectionId")
                          OR ((x."sectionId" IS NULL OR x."sectionId" = '') AND sec."classId" = x."classId" AND sec."isDeleted" = false)
ON CONFLICT DO NOTHING`;

const SUBJECTS_OF_CURRENT_SESSION = `
INSERT INTO viaexam_session_subjects ("instituteId", "sessionId", "classId", "subjectId", "teacherId", "createdAt", "updatedAt")
SELECT sub."instituteId", cur."sessionId", sub."classId", sub."subjectId", sub."teacherId", now(), now()
FROM viaexam_subjects sub
JOIN viaexam_classes c ON c."classId" = sub."classId" AND c."isDeleted" = false
JOIN LATERAL (
  SELECT "sessionId" FROM viaexam_sessions
  WHERE "instituteId" = sub."instituteId" AND "isDeleted" = false AND "isActive" = true
  ORDER BY "startDate" DESC LIMIT 1
) cur ON true
WHERE sub."isDeleted" = false
ON CONFLICT DO NOTHING`;

const SUBJECTS_USED = `
INSERT INTO viaexam_session_subjects ("instituteId", "sessionId", "classId", "subjectId", "teacherId", "createdAt", "updatedAt")
SELECT DISTINCT e."instituteId", e."sessionId", sub."classId", sub."subjectId", NULL::varchar, now(), now()
FROM viaexam_exams e
JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
JOIN viaexam_subjects sub ON sub."subjectId" = e."subjectId"
WHERE e."isDeleted" = false
ON CONFLICT DO NOTHING`;

/** The inserts, in order (enrolments first: the session setup also takes what they use). */
export const BACKFILL_STEPS = [
  ENROLMENTS_FROM_PROFILES,
  ENROLMENTS_FROM_RESULTS,
  ENROLMENTS_FROM_ATTENDANCE,
  SECTIONS_OF_CURRENT_SESSION,
  SECTIONS_USED,
  SUBJECTS_OF_CURRENT_SESSION,
  SUBJECTS_USED,
];

// Every student has at least one enrolment. A profile without any (e.g. added by an older
// build after the one-time fill) is placed by its profile, and its section joins that
// session's setup. Safe on every start: profiles with an enrolment are never touched.
const ENROL_THE_UNENROLLED = `
WITH added AS (
  ${ENROLMENTS_FROM_PROFILES.replace(
    "ON CONFLICT DO NOTHING",
    `WHERE NOT EXISTS (SELECT 1 FROM viaexam_student_enrollments x WHERE x."studentId" = p."userId")
     ON CONFLICT DO NOTHING
     RETURNING "instituteId", "sessionId", "classId", "sectionId"`
  )}
)
INSERT INTO viaexam_session_sections ("instituteId", "sessionId", "classId", "sectionId", "classTeacherId", "createdAt", "updatedAt")
SELECT DISTINCT a."instituteId", a."sessionId", a."classId", a."sectionId", NULL::varchar, now(), now()
FROM added a WHERE a."sectionId" IS NOT NULL
ON CONFLICT DO NOTHING`;

export const ensureEveryStudentEnrolled = async () => {
  const [, affected] = (await sequelize.query(ENROL_THE_UNENROLLED)) as [unknown, number];
  const left = Number(
    (((await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM viaexam_student_profiles p WHERE NOT EXISTS (SELECT 1 FROM viaexam_student_enrollments e WHERE e."studentId" = p."userId")`,
      { type: QueryTypes.SELECT }
    )) as any[])[0]?.n) ?? 0
  );
  if (left) logger.warn(`[enrolments] ${left} student profile(s) still have no class to place them in; see the Students page.`);
  return affected;
};

const count = async (sql: string, transaction: any) => Number(((await sequelize.query(sql, { type: QueryTypes.SELECT, transaction })) as any[])[0]?.n ?? 0);

export const runSessionScopeBackfill = async () => {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS viaexam_data_jobs (name VARCHAR(100) PRIMARY KEY, "ranAt" TIMESTAMPTZ NOT NULL DEFAULT now(), detail JSONB)`
  );
  await sequelize.transaction(async (t) => {
    await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('viaexam:${JOB}'))`, { transaction: t });
    const done = (await sequelize.query(`SELECT 1 FROM viaexam_data_jobs WHERE name = :job`, { replacements: { job: JOB }, type: QueryTypes.SELECT, transaction: t })) as any[];
    if (done.length) return;

    logger.info(`[${JOB}] Filling per-session tables from existing data…`);
    for (const sql of BACKFILL_STEPS) await sequelize.query(sql, { transaction: t });

    // Profiles now copy the current row (this also tidies "2025-26" into "2025-2026").
    const institutes = (await Session.findAll({ attributes: ["instituteId"], group: ["instituteId"], raw: true, transaction: t })) as any[];
    for (const { instituteId } of institutes) {
      await syncCurrentMirrors(instituteId, t);
      await syncStudentProfiles(instituteId, null, t);
    }

    const detail = {
      enrollments: await count(`SELECT COUNT(*)::int AS n FROM viaexam_student_enrollments`, t),
      sessionSections: await count(`SELECT COUNT(*)::int AS n FROM viaexam_session_sections`, t),
      sessionSubjects: await count(`SELECT COUNT(*)::int AS n FROM viaexam_session_subjects`, t),
      // Students who couldn't be placed (no class, or a roll number already taken): listed, not hidden.
      profilesWithoutEnrollment: await count(
        `SELECT COUNT(*)::int AS n FROM viaexam_student_profiles p
         WHERE NOT EXISTS (SELECT 1 FROM viaexam_student_enrollments e WHERE e."studentId" = p."userId")`,
        t
      ),
    };
    await sequelize.query(`INSERT INTO viaexam_data_jobs (name, detail) VALUES (:job, CAST(:detail AS JSONB))`, {
      replacements: { job: JOB, detail: JSON.stringify(detail) },
      transaction: t,
    });
    logger.info(`[${JOB}] Done: ${JSON.stringify(detail)}`);
    if (detail.profilesWithoutEnrollment) {
      logger.warn(`[${JOB}] ${detail.profilesWithoutEnrollment} student profile(s) have no class to place them in; they are listed as "not in this session" on the Students page.`);
    }
  });
};
