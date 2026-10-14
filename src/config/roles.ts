/**
 * Role groups for route guards (authorize()).
 *
 * Roles in the DB: SUPER_ADMIN, ADMIN (INSTITUTE_ADMIN on old seeds), TEACHER,
 * SCANNER, STUDENT. "Examiner" is a flag on a teacher's profile, not a role;
 * EXAMINER is listed only so an old token carrying it keeps working.
 *
 * Every institute-scoped service also filters by the caller's instituteId — a
 * guard decides *who* may call a route, the service decides *which rows*.
 */

export const ADMINS = ["ADMIN", "INSTITUTE_ADMIN"];
export const SUPER_ADMIN = ["SUPER_ADMIN"];

/** Teachers who set papers and evaluate. */
export const TEACHERS = ["TEACHER", "EXAMINER"];

/** Admin + teachers: academic work (papers, evaluation, rosters). */
export const ACADEMIC = [...ADMINS, ...TEACHERS];

/** Everyone who works for the institute. */
export const STAFF = [...ADMINS, ...TEACHERS, "SCANNER"];

/** Admin + scanner: answer-sheet uploads. */
export const UPLOADERS = [...ADMINS, "SCANNER"];

/** Any signed-in member of an institute, students included. */
export const MEMBERS = [...STAFF, "STUDENT"];
