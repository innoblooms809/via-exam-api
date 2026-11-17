import httpStatus from "http-status";
import { Op, QueryTypes } from "sequelize";
import UserModal from "../../models/User.model";
import StudentProfile from "../../models/Student.model";
import Role from "../../models/Role.model";
import Institute from "../../models/Institute.model";
import Class from "../../models/Class.model";
import Session from "../../models/Session.model";
import EncryptPassword from "../../utils/encryption";
import RegHelper from "../../utils/helper";
import exclude from "../../utils/exclude";
import { sequelize } from "../../config/sequelize";
import StudentBulkService from "./studentBulk.service";
import { newId } from "../../utils/idGenerator";
import { nameKey } from "../../utils/academicNames";
import { normalizeRollNo } from "../../utils/textRules";
import { bulkStudentRowSchema } from "../../validations/student.validation";
import { findSession } from "../academic/sessionSetup.service";
import { emailChange } from "../../utils/staffInput";
import { photoChange, uploadedPhoto } from "../../utils/profilePhoto";
import { decryptField } from "../../utils/dataProtection";
import { pageInfo, paging } from "../../utils/pagination";
import {
  currentEnrollment,
  enrollmentIn,
  enrollmentLock,
  enrollmentsOf,
  leaveOpenSessions,
  placeLabel,
  placeStudent,
  resolvePlace,
  rollTaken,
  syncStudentProfiles,
  type Place,
} from "./enrollment.service";

// A student is a person (account + profile) who is enrolled in a class, section and roll
// number for each session they study in (services/student/enrollment.service). Personal
// details live on the profile; where they study lives on the enrolment of each session.

// A single student has the same rules as a bulk row, except that the section may be
// empty (a class without sections) and the session defaults to the current one.
const singleStudentSchema = bulkStudentRowSchema.fork(["sectionId", "session", "className"], (f) => f.allow("", null).optional());

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });
const clean = (v: unknown) => String(v ?? "").trim();

// ─── CREATE STUDENT ───────────────────────────────────────────────────────────
// Adding a student whose email belongs to a deleted student of this institute brings
// that account back in the new class: the same person keeps their published results.
const createStudent = async (body: any, files: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  if (!instituteId) return fail(httpStatus.BAD_REQUEST, "Institute not found for this admin.");

  try {
    const institute = await Institute.findOne({ where: { instituteId, isDeleted: false, status: 1 } });
    if (!institute) return fail(httpStatus.NOT_FOUND, "Institute not found or inactive.");

    // Same field rules as a spreadsheet row; class / section / session are checked below.
    const { value: checked, error: invalid } = singleStudentSchema.validate(body, { abortEarly: true, convert: true });
    if (invalid) return fail(httpStatus.BAD_REQUEST, invalid.details[0].message);
    body = { ...body, ...checked, gender: checked.gender, email: checked.email, mobile: checked.mobile };
    // 0-9 however it was typed (١٠١ is 101): answer sheets are matched by it.
    const rollNumber = normalizeRollNo(body.rollNumber);
    if (!rollNumber) return fail(httpStatus.BAD_REQUEST, "Roll number is required.");
    const place = await resolvePlace(body, instituteId);
    if ("message" in place) return fail(httpStatus.BAD_REQUEST, place.message);

    const studentRole = await Role.findOne({ where: { role: "STUDENT" } });
    if (!studentRole) return fail(httpStatus.INTERNAL_SERVER_ERROR, "STUDENT role not found. Please seed roles.");

    // A deleted student of this institute with the same email is restored, not duplicated.
    const emailOwner = await UserModal.findOne({ where: { emailId: body.email } });
    const restoring =
      emailOwner && emailOwner.instituteId === instituteId && emailOwner.roleId === studentRole.id && emailOwner.status !== 1
        ? emailOwner
        : null;
    if (emailOwner && !restoring) return fail(httpStatus.CONFLICT, "Email is already registered.");

    const phoneOwner = await UserModal.findOne({ where: { phoneNumber: body.mobile } });
    if (phoneOwner && phoneOwner.userId !== restoring?.userId) return fail(httpStatus.CONFLICT, "Phone number is already registered.");

    if (await rollTaken(place.sessionId, place.sectionId, rollNumber, restoring?.userId)) {
      return fail(httpStatus.CONFLICT, `Roll number ${rollNumber} is already used in ${placeLabel(place)}.`);
    }

    const profileUrl = uploadedPhoto(files);
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
    const profileFields = {
      // The profile keeps a copy of the current enrolment; it is brought in line below.
      classId: place.classId,
      className: place.className,
      sectionId: place.sectionId,
      session: place.sessionName,
      rollNumber,
      // Required (checked above; the database refuses a new profile without it too).
      fatherName: clean(body.fatherName),
      gender: body.gender,
      dob: new Date(body.dob),
      aadhar: clean(body.aadhar),
      address: clean(body.address),
      isActive: true,
    };

    const user = await sequelize.transaction(async (t) => {
      let account: UserModal;
      if (restoring) {
        await restoring.update(
          { userName: `${body.firstName} ${body.lastName}`, phoneNumber: body.mobile, password: encryptedPassword, status: 1, isDeleted: false, ...(profileUrl ? { profileUrl } : {}) },
          { transaction: t }
        );
        const profile = await StudentProfile.findOne({ where: { userId: restoring.userId }, transaction: t });
        if (profile) await profile.update({ ...profileFields, ...(profileUrl ? { profileUrl } : {}) }, { transaction: t });
        else await StudentProfile.create({ userId: restoring.userId, instituteId, ...profileFields, profileUrl }, { transaction: t });
        account = restoring;
      } else {
        account = await UserModal.create(
          {
            userId: newId("user"),
            userName: `${body.firstName} ${body.lastName}`,
            emailId: body.email,
            phoneNumber: body.mobile,
            password: encryptedPassword,
            roleId: studentRole.id,
            instituteId,
            status: 1,
            profileUrl,
          },
          { transaction: t }
        );
        await StudentProfile.create({ userId: account.userId, instituteId, ...profileFields, profileUrl }, { transaction: t });
      }
      await placeStudent({ instituteId, studentId: account.userId, place, rollNumber }, t);
      await syncStudentProfiles(instituteId, [account.userId], t);
      return account;
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: restoring
        ? `${user.userName} was a deleted student; their account is restored in ${placeLabel(place)} with their old results.`
        : `Student added to ${placeLabel(place)}.`,
      data: {
        user: exclude(user.toJSON(), ["password", "refreshToken"]),
        plainPassword,
        instituteName: institute.instituteName,
        restored: Boolean(restoring),
      },
    };
  } catch (e: any) {
    console.error(e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── GET ALL STUDENTS ─────────────────────────────────────────────────────────
// The students of one session (?sessionId= or ?session=, by id or name; the current one
// when blank), with the class, section and roll number they have in that session.
// ?session=all lists every student once, at their current class.
// Also: how many active students aren't in this session at all, and how many of the
// previous session's students haven't been promoted into it yet.
//
// A page at a time: ?page=&limit= (25 a page, at most 1000; the first 1000 without them).
// Narrowed by ?classId= or ?className= (id or name), ?sectionId= (id or name), ?search=
// (name, email, roll, father, mobile), ?gender=male,female, ?exams=locked|free and
// ?studentId=; sorted by ?sort=school|rollNumber|userName|class|father|dob|examCount and
// ?order=asc|desc (by name when left out). ?counts=1 adds every class-section's head count
// in the session (the roster strip), unaffected by the other filters.

const STUDENT_PAGING = { defaultLimit: 25, maxLimit: 1000, unpagedLimit: 1000 };

/** Class names in school order, as the admin screens sort them: pre-primary, 1 … 12, then the rest. */
const PRE_PRIMARY = ["playgroup", "pre-nursery", "prenursery", "nursery", "lkg", "kg", "ukg"];
const PRE_PRIMARY_SQL = `ARRAY[${PRE_PRIMARY.map((n) => `'${n}'`).join(", ")}]`;
const CLASS_KEY = `btrim(regexp_replace(lower(coalesce(c."className", '')), '^class[[:space:]]*', ''))`;
const CLASS_ORDER = `CASE
      WHEN ${CLASS_KEY} = ANY(${PRE_PRIMARY_SQL}) THEN array_position(${PRE_PRIMARY_SQL}, ${CLASS_KEY})
      WHEN ${CLASS_KEY} ~ '^[0-9]' THEN 100 + substring(${CLASS_KEY} from '^[0-9]{1,9}')::bigint
      ELSE 10000
    END`;
/** Roll numbers as numbers ("2" before "10"), then as text. */
const ROLL_NUMBER = `substring(t."rollNumber" from '^[0-9]{1,15}')::bigint`;

type SortDir = "ASC" | "DESC";
/** How a text column is ordered (see textOrder). */
type TextOrder = (expr: string) => string;
const STUDENT_SORT: Record<string, (d: SortDir, text: TextOrder) => string> = {
  school: (d, text) => `t."classOrder" ${d}, ${text(`coalesce(t."sectionName", '')`)} ${d}, ${ROLL_NUMBER} ${d} NULLS LAST, ${text(`coalesce(t."rollNumber", '')`)} ${d}`,
  rollNumber: (d, text) => `${ROLL_NUMBER} ${d} NULLS LAST, ${text(`coalesce(t."rollNumber", '')`)} ${d}`,
  userName: (d, text) => `${text(`t."userName"`)} ${d}`,
  class: (d, text) => `t."classOrder" ${d}, ${text(`coalesce(t."sectionName", '')`)} ${d}`,
  father: (d, text) => `${text(`coalesce(t."fatherName", '')`)} ${d}`,
  dob: (d) => `t.dob ${d} NULLS LAST`,
  examCount: (d) => `t."examCount" ${d}`,
};

// Names in the order the screens sort them (JavaScript's localeCompare): the database's own
// collation (C.UTF-8) orders bytes, so names that differ only by case ("Aman" / "aman") fell
// in another order. The ICU root collation sorts like the browser; without it (a server built
// without ICU) text is compared lower-cased. Checked once; a failed check is tried again.
let icuCheck: Promise<boolean> | null = null;
const textOrder = async (): Promise<TextOrder> => {
  icuCheck ??= sequelize
    .query(`SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu' LIMIT 1`, { type: QueryTypes.SELECT })
    .then((rows) => rows.length > 0)
    .catch(() => {
      icuCheck = null;
      return false;
    });
  return (await icuCheck) ? (expr) => `${expr} COLLATE "und-x-icu"` : (expr) => `lower(${expr})`;
};

// examCount: exams whose roster includes the enrolment (same rule as the exam roster: the
// session and class, and the section unless the exam is for the whole class). While > 0
// the session's class, section and roll number are locked.
const STUDENT_ROWS = (all: boolean, orderBy: string) => `
WITH exam_counts AS (
  SELECT x."sessionId", x."classId", COALESCE(x."sectionId", '') AS sec, COUNT(*)::int AS n
  FROM viaexam_exams x
  WHERE x."instituteId" = :inst AND x."isDeleted" = false
  GROUP BY x."sessionId", x."classId", COALESCE(x."sectionId", '')
),
enrolled AS (
  SELECT ${all ? `DISTINCT ON (e."studentId")` : ""}
         u."userId", u."userName", u."emailId", u."phoneNumber", u.status, u."instituteId",
         e."enrollmentId", e."sessionId", se."sessionName", e."classId", c."className",
         e."sectionId", sec."sectionName", e."rollNumber",
         p."fatherName", p.gender, p.dob, p.aadhar, p.address,
         COALESCE(u."profileUrl", p."profileUrl") AS "profileUrl",
         ${CLASS_ORDER} AS "classOrder",
         (SELECT COALESCE(SUM(xc.n), 0)::int FROM exam_counts xc
           WHERE xc."sessionId" = e."sessionId" AND xc."classId" = e."classId"
             AND (xc.sec = '' OR xc.sec = e."sectionId" OR xc.sec = sec."sectionName")) AS "examCount"
  FROM viaexam_student_enrollments e
  JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
  JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
  LEFT JOIN viaexam_student_profiles p ON p."userId" = e."studentId"
  LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
  LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
  WHERE e."instituteId" = :inst AND e."isActive" = true
    ${all ? "" : `AND e."sessionId" = :ses`}
    AND (:studentId = '' OR e."studentId" = :studentId)
    AND (:classIds IS NULL OR e."classId" IN (:classList))
    AND (:section = '' OR e."sectionId" = :section OR lower(sec."sectionName") = lower(:section))
    AND (:q = '' OR u."userName" ILIKE :like OR u."emailId" ILIKE :like OR e."rollNumber" ILIKE :like
         OR p."fatherName" ILIKE :like OR u."phoneNumber" ILIKE :like)
    AND (:genderOn IS NULL OR lower(coalesce(p.gender, '')) IN (:genders))
  ${all ? `ORDER BY e."studentId", se."isActive" DESC, se."startDate" DESC` : ""}
)
SELECT t.*, COUNT(*) OVER() AS "matchCount"
FROM enrolled t
WHERE (:exams = '' OR (:exams = 'locked' AND t."examCount" > 0) OR (:exams = 'free' AND t."examCount" = 0))
ORDER BY ${orderBy}
LIMIT :limit OFFSET :offset`;

/** Head count of every class-section of a session (the roster strip on the Students page). */
const ROSTER_COUNTS = `
SELECT e."classId", e."sectionId", COUNT(*)::int AS n
FROM viaexam_student_enrollments e
JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
WHERE e."instituteId" = :inst AND e."sessionId" = :ses AND e."isActive" = true
GROUP BY e."classId", e."sectionId"`;

/** "50%_off" typed in the search box finds that text, not every row. */
const likeText = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const getAllStudents = async (createdBy: any, query: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const sessionParam = clean(query?.sessionId) || clean(query?.session);
    const all = sessionParam.toLowerCase() === "all";
    const session = all ? null : await findSession(instituteId, sessionParam);
    const { page, limit, offset } = paging(query, STUDENT_PAGING);
    if (!all && !session) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: sessionParam ? "Session not found." : "No current session yet.",
        data: { students: [], total: 0, pagination: pageInfo(0, page, limit), session: null, notEnrolled: 0, previous: null, rosters: [], sessionTotal: 0 },
      };
    }

    // Class filter by id or name ("10", "Class 10").
    const className = clean(query?.classId) || clean(query?.className);
    let classList: string[] | null = null;
    if (className) {
      const bare = className.replace(/^class\s+/i, "");
      const classes = await Class.findAll({ where: { instituteId }, attributes: ["classId", "className"] });
      classList = classes.filter((c) => c.classId === className || nameKey(c.className) === nameKey(className) || nameKey(c.className) === nameKey(bare)).map((c) => c.classId);
      if (!classList.length) classList = ["-"];
    }
    const genders = clean(query?.gender)
      .split(",")
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean);
    const exams = ["locked", "free"].includes(clean(query?.exams)) ? clean(query?.exams) : "";
    const sortKey = STUDENT_SORT[clean(query?.sort)] ? clean(query?.sort) : "userName";
    const dir: SortDir = clean(query?.order).toLowerCase() === "desc" ? "DESC" : "ASC";
    // The enrolment id keeps the order the same on every page.
    const text = await textOrder();
    const orderBy = `${STUDENT_SORT[sortKey](dir, text)}, ${text(`t."userName"`)} ASC, t."enrollmentId" ASC`;
    const search = clean(query?.search);
    const replacements = {
      inst: instituteId,
      ses: session?.sessionId ?? "",
      studentId: clean(query?.studentId),
      classIds: classList ? "x" : null,
      classList: classList ?? ["-"],
      section: clean(query?.sectionId),
      q: search,
      like: likeText(search),
      genderOn: genders.length ? "x" : null,
      genders: genders.length ? genders : ["-"],
      exams,
      limit,
      offset,
    };
    const sql = STUDENT_ROWS(all, orderBy);
    const rows = (await sequelize.query(sql, { replacements, type: QueryTypes.SELECT })) as any[];
    // A page past the end has no row to carry the count.
    let total = rows.length ? Number(rows[0].matchCount) : 0;
    if (!rows.length && offset > 0) {
      const [first] = (await sequelize.query(sql, { replacements: { ...replacements, limit: 1, offset: 0 }, type: QueryTypes.SELECT })) as any[];
      total = Number(first?.matchCount ?? 0);
    }

    const students = rows.map((r) => ({
      userId: r.userId,
      userName: r.userName,
      emailId: r.emailId,
      phoneNumber: r.phoneNumber,
      status: r.status,
      instituteId: r.instituteId,
      enrollmentId: r.enrollmentId,
      sessionId: r.sessionId,
      session: r.sessionName,
      rollNumber: r.rollNumber ?? null,
      classId: r.classId ?? null,
      className: r.className ?? null,
      sectionId: r.sectionId ?? null,
      sectionName: r.sectionName ?? null,
      /** Exams this enrolment is on the roster of: class, section and roll for this session are locked while > 0. */
      examCount: Number(r.examCount) || 0,
      fatherName: r.fatherName ?? null,
      gender: r.gender ?? null,
      dob: r.dob ?? null,
      // Stored encrypted (utils/dataProtection); raw SQL gets the ciphertext.
      aadhar: decryptField(r.aadhar, "aadhaar") ?? null,
      address: r.address ?? null,
      profileUrl: decryptField(r.profileUrl, "profileUrl") ?? null,
    }));

    let notEnrolled = 0;
    let previous: { sessionId: string; sessionName: string; waiting: number } | null = null;
    let rosters: { classId: string | null; sectionId: string | null; count: number }[] = [];
    const wantCounts = Boolean(session) && ["1", "true"].includes(clean(query?.counts).toLowerCase());
    if (session) {
      const [[counts], prior, rosterRows] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS n FROM viaexam_users u JOIN roles r ON r.id = u."roleId" AND r.role = 'STUDENT'
           WHERE u."instituteId" = :inst AND u.status = 1
             AND NOT EXISTS (SELECT 1 FROM viaexam_student_enrollments e WHERE e."studentId" = u."userId" AND e."sessionId" = :ses AND e."isActive" = true)`,
          { replacements: { inst: instituteId, ses: session.sessionId }, type: QueryTypes.SELECT }
        ) as Promise<any[]>,
        Session.findOne({ where: { instituteId, isDeleted: false, startDate: { [Op.lt]: session.startDate } }, order: [["startDate", "DESC"]] }),
        wantCounts
          ? (sequelize.query(ROSTER_COUNTS, { replacements: { inst: instituteId, ses: session.sessionId }, type: QueryTypes.SELECT }) as Promise<any[]>)
          : Promise.resolve([] as any[]),
      ]);
      notEnrolled = Number(counts?.n ?? 0);
      rosters = rosterRows.map((r) => ({ classId: r.classId ?? null, sectionId: r.sectionId ?? null, count: Number(r.n) || 0 }));
      if (prior) {
        const [waiting] = (await sequelize.query(
          `SELECT COUNT(*)::int AS n FROM viaexam_student_enrollments e
           JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
           WHERE e."sessionId" = :prior AND e."isActive" = true
             AND NOT EXISTS (SELECT 1 FROM viaexam_student_enrollments x WHERE x."studentId" = e."studentId" AND x."sessionId" = :ses)`,
          { replacements: { prior: prior.sessionId, ses: session.sessionId }, type: QueryTypes.SELECT }
        )) as any[];
        previous = { sessionId: prior.sessionId, sessionName: prior.sessionName, waiting: Number(waiting?.n ?? 0) };
      }
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Students fetched successfully.",
      data: {
        students,
        total,
        pagination: pageInfo(total, page, limit),
        session: session ? { sessionId: session.sessionId, sessionName: session.sessionName, isActive: session.isActive } : null,
        notEnrolled,
        previous,
        /** With ?counts=1: students per class-section of the session, and all of them (null without). */
        rosters,
        sessionTotal: wantCounts ? rosters.reduce((n, r) => n + r.count, 0) : null,
      },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── GET ONE STUDENT ──────────────────────────────────────────────────────────
// The person, their current class, and every session they studied in.
const getStudentById = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy?.instituteId;
    const userWhere: any = { userId, ...(instituteId ? { instituteId } : {}) };
    let student = await UserModal.findOne({
      where: userWhere,
      include: [{ model: Role, as: "role" }, { model: StudentProfile, as: "studentProfile" }],
      attributes: { exclude: ["password", "refreshToken"] },
    });

    // Older links pass a roll number instead of the id.
    if (!student) {
      const profile = await StudentProfile.findOne({ where: { rollNumber: userId, ...(instituteId ? { instituteId } : {}) } });
      if (profile?.userId) {
        student = await UserModal.findOne({
          where: { userId: profile.userId, ...(instituteId ? { instituteId } : {}) },
          include: [{ model: Role, as: "role" }, { model: StudentProfile, as: "studentProfile" }],
          attributes: { exclude: ["password", "refreshToken"] },
        });
      }
    }
    if (!student) return fail(httpStatus.NOT_FOUND, "Student not found.");

    const s = student.toJSON() as any;
    const [history, current] = await Promise.all([enrollmentsOf(s.userId, s.instituteId), currentEnrollment(s.userId, s.instituteId)]);
    const now = history.find((h) => h.enrollmentId === current?.enrollmentId) ?? null;
    // Tells the edit form whether this session's class / section / roll can still change.
    const placementLock = now ? await enrollmentLock({ instituteId: s.instituteId, sessionId: now.sessionId, classId: now.classId, sectionId: now.sectionId }, now.sessionName) : { locked: false, exams: 0, reason: null };

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student fetched successfully.",
      data: {
        placementLock,
        userId: s.userId,
        userName: s.userName,
        emailId: s.emailId,
        phoneNumber: s.phoneNumber,
        status: s.status,
        instituteId: s.instituteId,
        studentProfile: s.studentProfile
          ? {
              ...s.studentProfile,
              classId: now?.classId ?? s.studentProfile.classId,
              className: now?.className ?? s.studentProfile.className,
              sectionId: now?.sectionId ?? s.studentProfile.sectionId,
              sectionName: now?.sectionName ?? null,
              session: now?.sessionName ?? s.studentProfile.session,
              sessionId: now?.sessionId ?? null,
              rollNumber: now?.rollNumber ?? s.studentProfile.rollNumber,
            }
          : null,
        /** Every session the student studied in, newest first. */
        enrollments: history,
      },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── UPDATE STUDENT ───────────────────────────────────────────────────────────
// Personal details can always change. Class, section and roll number are set per session
// (body.sessionId or body.session; the student's current session when blank): that
// session's enrolment is written, others are left alone. A session's placement is locked
// while the student is on the roster of one of its exams.
const updateStudent = async (userId: string, body: any, files: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  try {
    const user = await UserModal.findOne({ where: { userId, instituteId } });
    if (!user) return fail(httpStatus.NOT_FOUND, "Student not found.");
    if (user.status !== 1) return fail(httpStatus.BAD_REQUEST, "This student was deleted. Add them again to bring them back.");

    if (body.mobile && body.mobile !== user.phoneNumber && (await UserModal.findOne({ where: { phoneNumber: body.mobile } }))) {
      return fail(httpStatus.CONFLICT, "Phone number is already registered.");
    }
    const nextEmail = await emailChange(body.email || undefined, user, instituteId);
    if (nextEmail.problem) return fail(httpStatus.BAD_REQUEST, nextEmail.problem);

    const profile = await StudentProfile.findOne({ where: { userId, instituteId } });
    // A new student must have a father's name. Older students saved without one can still be
    // edited as they are, but a father's name that is there can't be removed.
    if (profile && body.fatherName !== undefined) {
      const father = clean(body.fatherName);
      if (!father && clean(profile.fatherName)) return fail(httpStatus.BAD_REQUEST, "Father's name is required.");
      if (father && father !== clean(profile.fatherName)) {
        const { error } = bulkStudentRowSchema.extract("fatherName").validate(father);
        if (error) return fail(httpStatus.BAD_REQUEST, error.details[0].message);
      }
    }
    let place: Place | null = null;
    let rollNumber = "";

    const wantsPlacement = ["classId", "className", "sectionId", "session", "sessionId", "rollNumber"].some((k) => body[k] !== undefined && body[k] !== "");
    if (profile && wantsPlacement) {
      const current = await currentEnrollment(userId, instituteId);
      const sessionParam = clean(body.sessionId) || clean(body.session) || current?.sessionId || "";
      const session = await findSession(instituteId, sessionParam);
      if (!session) return fail(httpStatus.BAD_REQUEST, "Choose a session that exists (Master Data → Sessions).");
      const existing = await enrollmentIn(userId, session.sessionId);
      const resolved = await resolvePlace(
        {
          classId: body.classId ?? (body.className === undefined ? existing?.classId : undefined),
          className: body.className,
          sectionId: body.sectionId ?? existing?.sectionId ?? undefined,
          sessionId: session.sessionId,
        },
        instituteId
      );
      if ("message" in resolved) return fail(httpStatus.BAD_REQUEST, resolved.message);
      rollNumber = normalizeRollNo(body.rollNumber ?? existing?.rollNumber);
      if (!rollNumber) return fail(httpStatus.BAD_REQUEST, "Roll number is required.");

      const moved = !existing || !existing.isActive || existing.classId !== resolved.classId || existing.sectionId !== resolved.sectionId || existing.rollNumber !== rollNumber;
      if (moved) {
        if (existing) {
          const lock = await enrollmentLock(existing, session.sessionName);
          if (lock.locked && (existing.classId !== resolved.classId || existing.sectionId !== resolved.sectionId || existing.rollNumber !== rollNumber)) {
            return fail(httpStatus.CONFLICT, lock.reason);
          }
        }
        if (await rollTaken(resolved.sessionId, resolved.sectionId, rollNumber, userId)) {
          return fail(httpStatus.CONFLICT, `Roll number ${rollNumber} is already used in ${placeLabel(resolved)}.`);
        }
        place = resolved;
      }
    }

    const photo = photoChange(files, body);
    await sequelize.transaction(async (t) => {
      await user.update(
        {
          userName: body.firstName && body.lastName ? `${body.firstName} ${body.lastName}` : user.userName,
          phoneNumber: body.mobile ?? user.phoneNumber,
          emailId: nextEmail.email ?? user.emailId,
          ...(photo !== undefined ? { profileUrl: photo } : {}),
        },
        { transaction: t }
      );
      if (!profile) return;
      const profileUrl = photo !== undefined ? photo : profile.profileUrl;
      await profile.update(
        {
          fatherName: body.fatherName ?? profile.fatherName,
          gender: body.gender ?? profile.gender,
          address: body.address ?? profile.address,
          dob: body.dob ?? profile.dob,
          aadhar: body.aadhar ?? profile.aadhar,
          profileUrl,
        },
        { transaction: t }
      );
      if (place) {
        await placeStudent({ instituteId, studentId: userId, place, rollNumber }, t);
        await syncStudentProfiles(instituteId, [userId], t);
      }
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: place ? `Student updated: ${placeLabel(place)}, roll ${rollNumber}.` : "Student updated.",
      data: { userId, userName: user.userName },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── DELETE STUDENT ───────────────────────────────────────────────────────────
// The student leaves: the account is deactivated and their place in the current (and any
// later) session is freed. Earlier sessions keep them, with their published results;
// adding them again with the same email restores the account.
const deleteStudent = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const user = await UserModal.findOne({ where: { userId, instituteId } });
    if (!user) return fail(httpStatus.NOT_FOUND, "Student not found.");

    await sequelize.transaction(async (t) => {
      await user.update({ status: 0, refreshToken: null }, { transaction: t });
      await StudentProfile.update({ isActive: false }, { where: { userId, instituteId }, transaction: t });
      await leaveOpenSessions(instituteId, userId, t);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${user.userName} deleted. Earlier sessions and published results are kept; add them again with the same email to bring them back.`,
      data: {},
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── PROMOTE / MOVE STUDENTS ──────────────────────────────────────────────────
// Puts the chosen students in a class / section of a session in one go:
//   another session  → year-end promotion (or detention): next session's enrolment is
//                      added; this session's stays exactly as it is, with its results
//   the same session → a class change, refused for students already on an exam roster
// Body: { studentIds[], toClassId, toSectionId, toSession | toSessionId,
//         fromSessionId?, rollNumbers?: { [userId]: roll } }
const promoteStudents = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  try {
    const studentIds: string[] = Array.from(new Set((Array.isArray(body.studentIds) ? body.studentIds : []).map(String))).filter(Boolean) as string[];
    if (!studentIds.length) return fail(httpStatus.BAD_REQUEST, "Choose at least one student.");
    if (studentIds.length > 500) return fail(httpStatus.BAD_REQUEST, "You can promote up to 500 students at a time.");

    const target = await resolvePlace({ classId: body.toClassId, sectionId: body.toSectionId, sessionId: body.toSessionId ?? body.toSession }, instituteId);
    if ("message" in target) return fail(httpStatus.BAD_REQUEST, target.message);
    const fromSession = clean(body.fromSessionId) ? await findSession(instituteId, body.fromSessionId) : null;
    const rolls: Record<string, unknown> = body.rollNumbers && typeof body.rollNumbers === "object" ? body.rollNumbers : {};

    const users = await UserModal.findAll({ where: { instituteId, userId: { [Op.in]: studentIds }, status: 1 }, attributes: ["userId", "userName"] });
    const userOf = new Map(users.map((u) => [u.userId, u]));

    const skipped: { userId: string; name: string; reason: string }[] = [];
    const moves: { studentId: string; rollNumber: string }[] = [];
    const rollsInBatch = new Set<string>();

    for (const id of studentIds) {
      const user = userOf.get(id);
      const name = user?.userName ?? "";
      if (!user) {
        skipped.push({ userId: id, name, reason: "Not an active student of this institute." });
        continue;
      }
      const source = fromSession ? await enrollmentIn(id, fromSession.sessionId) : await currentEnrollment(id, instituteId);
      const rollNumber = normalizeRollNo(rolls[id]) || normalizeRollNo(source?.rollNumber);
      if (!rollNumber) {
        skipped.push({ userId: id, name, reason: "No roll number to give them; enter one." });
        continue;
      }
      const there = await enrollmentIn(id, target.sessionId);
      if (there && there.isActive && there.classId === target.classId && there.sectionId === target.sectionId && there.rollNumber === rollNumber) {
        skipped.push({ userId: id, name, reason: `Already in ${placeLabel(target)}.` });
        continue;
      }
      // Changing a session's placement is refused once its exams count on it.
      if (there) {
        const lock = await enrollmentLock(there, target.sessionName);
        if (lock.locked) {
          skipped.push({ userId: id, name, reason: `On the roster of ${lock.exams} exam(s) in ${target.sessionName}, so their class there can't change.` });
          continue;
        }
      }
      if (rollsInBatch.has(rollNumber) || (await rollTaken(target.sessionId, target.sectionId, rollNumber, id))) {
        skipped.push({ userId: id, name, reason: `Roll number ${rollNumber} is already used in ${placeLabel(target)}.` });
        continue;
      }
      rollsInBatch.add(rollNumber);
      moves.push({ studentId: id, rollNumber });
    }

    if (moves.length) {
      await sequelize.transaction(async (t) => {
        for (const m of moves) await placeStudent({ instituteId, studentId: m.studentId, place: target, rollNumber: m.rollNumber }, t);
        await syncStudentProfiles(instituteId, moves.map((m) => m.studentId), t);
      });
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: moves.length
        ? `${moves.length} ${moves.length === 1 ? "student" : "students"} placed in ${placeLabel(target)}${skipped.length ? ` · ${skipped.length} skipped` : ""}.`
        : "No students were moved.",
      data: { promoted: moves.length, skipped, target },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── BULK CREATE STUDENTS ─────────────────────────────────────────────────────
// Implemented in studentBulk.service.ts: bulk upload needs per-row validation,
// per-row transactions and structured per-row error reporting, none of which
// belong in the single-student CRUD path below.
const bulkCreateStudents = StudentBulkService.bulkCreateStudents;

export default {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  promoteStudents,
  bulkCreateStudents,
};
