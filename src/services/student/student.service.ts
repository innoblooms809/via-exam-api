import httpStatus from "http-status";
import { Op, QueryTypes } from "sequelize";
import UserModal from "../../models/User.model";
import StudentProfile from "../../models/Student.model";
import Role from "../../models/Role.model";
import Institute from "../../models/Institute.model";
import Class from "../../models/Class.model";
import Session from "../../models/Session.model";
import Exam from "../../models/Exam.model";
import EncryptPassword from "../../utils/encryption";
import RegHelper from "../../utils/helper";
import exclude from "../../utils/exclude";
import { sequelize } from "../../config/sequelize";
import StudentBulkService from "./studentBulk.service";
import { newId } from "../../utils/idGenerator";
import { nameKey } from "../../utils/academicNames";
import { bulkStudentRowSchema } from "../../validations/student.validation";
import { findSession } from "../academic/sessionSetup.service";
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
    const rollNumber = clean(body.rollNumber);
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

    const profileUrl = files?.profilePhoto?.[0] ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}` : null;
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
    const profileFields = {
      // The profile keeps a copy of the current enrolment; it is brought in line below.
      classId: place.classId,
      className: place.className,
      sectionId: place.sectionId,
      session: place.sessionName,
      rollNumber,
      // Optional on the form, but NOT NULL columns: an empty value is stored as "".
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
          { userName: `${body.firstName} ${body.lastName}`, phoneNumber: body.mobile, password: encryptedPassword, status: 1, isDeleted: false },
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

const STUDENT_ROWS = (all: boolean) => `
SELECT ${all ? `DISTINCT ON (e."studentId")` : ""}
       u."userId", u."userName", u."emailId", u."phoneNumber", u.status, u."instituteId",
       e."enrollmentId", e."sessionId", se."sessionName", e."classId", c."className",
       e."sectionId", sec."sectionName", e."rollNumber",
       p."fatherName", p.gender, p.dob, p.aadhar, p.address, p."profileUrl"
FROM viaexam_student_enrollments e
JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
LEFT JOIN viaexam_student_profiles p ON p."userId" = e."studentId"
LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
WHERE e."instituteId" = :inst AND e."isActive" = true
  ${all ? "" : `AND e."sessionId" = :ses`}
  AND (:classIds IS NULL OR e."classId" IN (:classList))
  AND (:section = '' OR e."sectionId" = :section OR lower(sec."sectionName") = lower(:section))
  AND (:q = '' OR u."userName" ILIKE :like OR u."emailId" ILIKE :like OR e."rollNumber" ILIKE :like)
ORDER BY ${all ? `e."studentId", se."isActive" DESC, se."startDate" DESC` : `u."userName"`}`;

const getAllStudents = async (createdBy: any, query: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const sessionParam = clean(query?.sessionId) || clean(query?.session);
    const all = sessionParam.toLowerCase() === "all";
    const session = all ? null : await findSession(instituteId, sessionParam);
    if (!all && !session) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: sessionParam ? "Session not found." : "No current session yet.",
        data: { students: [], total: 0, session: null, notEnrolled: 0, previous: null },
      };
    }

    // Class filter by id or name ("10", "Class 10").
    const className = clean(query?.className);
    let classList: string[] | null = null;
    if (className) {
      const bare = className.replace(/^class\s+/i, "");
      const classes = await Class.findAll({ where: { instituteId }, attributes: ["classId", "className"] });
      classList = classes.filter((c) => c.classId === className || nameKey(c.className) === nameKey(className) || nameKey(c.className) === nameKey(bare)).map((c) => c.classId);
      if (!classList.length) classList = ["-"];
    }
    const search = clean(query?.search);
    const rows = (await sequelize.query(STUDENT_ROWS(all), {
      replacements: {
        inst: instituteId,
        ses: session?.sessionId ?? "",
        classIds: classList ? "x" : null,
        classList: classList ?? ["-"],
        section: clean(query?.sectionId),
        q: search,
        like: `%${search}%`,
      },
      type: QueryTypes.SELECT,
    })) as any[];

    // Exams whose roster includes each row (same rule as the exam roster), counted in
    // memory so the list can show which placements are locked without a query per row.
    const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
    const exams = sessionIds.length
      ? ((await Exam.findAll({ where: { instituteId, isDeleted: false, sessionId: { [Op.in]: sessionIds } }, attributes: ["classId", "sectionId", "sessionId"], raw: true })) as any[])
      : [];
    const rosterExams = (r: any) =>
      exams.filter((e) => e.sessionId === r.sessionId && e.classId === r.classId && (!e.sectionId || e.sectionId === r.sectionId || e.sectionId === r.sectionName)).length;

    const students = rows
      .map((r) => ({
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
        examCount: rosterExams(r),
        fatherName: r.fatherName ?? null,
        gender: r.gender ?? null,
        dob: r.dob ?? null,
        aadhar: r.aadhar ?? null,
        address: r.address ?? null,
        profileUrl: r.profileUrl ?? null,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName));

    let notEnrolled = 0;
    let previous: { sessionId: string; sessionName: string; waiting: number } | null = null;
    if (session) {
      const [[counts], prior] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS n FROM viaexam_users u JOIN roles r ON r.id = u."roleId" AND r.role = 'STUDENT'
           WHERE u."instituteId" = :inst AND u.status = 1
             AND NOT EXISTS (SELECT 1 FROM viaexam_student_enrollments e WHERE e."studentId" = u."userId" AND e."sessionId" = :ses AND e."isActive" = true)`,
          { replacements: { inst: instituteId, ses: session.sessionId }, type: QueryTypes.SELECT }
        ) as Promise<any[]>,
        Session.findOne({ where: { instituteId, isDeleted: false, startDate: { [Op.lt]: session.startDate } }, order: [["startDate", "DESC"]] }),
      ]);
      notEnrolled = Number(counts?.n ?? 0);
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
        total: students.length,
        session: session ? { sessionId: session.sessionId, sessionName: session.sessionName, isActive: session.isActive } : null,
        notEnrolled,
        previous,
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
    if (body.email && body.email !== user.emailId && (await UserModal.findOne({ where: { emailId: body.email } }))) {
      return fail(httpStatus.CONFLICT, "Email address is already registered.");
    }

    const profile = await StudentProfile.findOne({ where: { userId, instituteId } });
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
      rollNumber = clean(body.rollNumber ?? existing?.rollNumber);
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

    await sequelize.transaction(async (t) => {
      await user.update(
        {
          userName: body.firstName && body.lastName ? `${body.firstName} ${body.lastName}` : user.userName,
          phoneNumber: body.mobile ?? user.phoneNumber,
          emailId: body.email ?? user.emailId,
        },
        { transaction: t }
      );
      if (!profile) return;
      const profileUrl = files?.profilePhoto?.[0] ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}` : profile.profileUrl;
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
      const rollNumber = clean(rolls[id]) || clean(source?.rollNumber);
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
