import httpStatus from "http-status";
import UserModal from "../../models/User.model";
import StudentProfile from "../../models/Student.model";
import Role from "../../models/Role.model";
import Institute from "../../models/Institute.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import EncryptPassword from "../../utils/encryption";
import RegHelper from "../../utils/helper";
import exclude from "../../utils/exclude";
import { sequelize } from "../../config/sequelize";
import { Op } from "sequelize";
import StudentBulkService from "./studentBulk.service";
import { newId } from "../../utils/idGenerator";
import Session from "../../models/Session.model";
import Exam from "../../models/Exam.model";
import { nameKey } from "../../utils/academicNames";
import { studentPlacementLock, unfinishedExamsFor } from "../academic/academicGuards.service";
import { bulkStudentRowSchema } from "../../validations/student.validation";

// A single student has the same rules as a bulk row, except that the section may be
// empty (a class without sections) and the session defaults to the current one.
const singleStudentSchema = bulkStudentRowSchema.fork(["sectionId", "session", "className"], (f) => f.allow("", null).optional());

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const resolveClassId = async (inputClass: string, instituteId: string): Promise<string | null> => {
  if (!inputClass) return null;
  const candidates = [inputClass];
  // Try stripping "Class " prefix (e.g. "Class 10" → "10")
  if (inputClass.startsWith("Class ")) candidates.push(inputClass.slice(6));
  // Try adding "Class " prefix (e.g. "10" → "Class 10")
  if (!inputClass.startsWith("Class ")) candidates.push(`Class ${inputClass}`);

  const byId = await Class.findOne({
    where: { classId: inputClass, instituteId, isDeleted: false },
  });
  if (byId) return byId.classId;

  for (const name of candidates) {
    const byName = await Class.findOne({
      where: { className: name, instituteId, isDeleted: false },
    });
    if (byName) return byName.classId;
  }

  return null;
};

const resolveSectionId = async (inputSection: string, classId: string, instituteId: string): Promise<string> => {
  if (!inputSection) return "";
  const byId = await Section.findOne({
    where: { sectionId: inputSection, instituteId, isDeleted: false },
  });
  if (byId) return byId.sectionId;

  const byName = await Section.findOne({
    where: { sectionName: inputSection, classId, instituteId, isDeleted: false },
  });
  if (byName) return byName.sectionId;

  return inputSection;
};

// ─── PLACEMENT (class · section · session) ────────────────────────────────────

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });
const clean = (v: unknown) => String(v ?? "").trim();

interface Placement {
  classId: string;
  className: string;
  /** Always a real section: a class without sections can't take students yet. */
  sectionId: string;
  sectionName: string;
  session: string;
}

/**
 * Resolves and checks where a student sits: the class must exist, the section must be
 * one of that class's sections (required when the class has any), and the session must
 * exist (defaults to the current one). Accepts ids or names, like the forms send.
 */
const resolvePlacement = async (
  input: { classId?: unknown; className?: unknown; sectionId?: unknown; session?: unknown },
  instituteId: string
): Promise<Placement | { message: string }> => {
  const classId = await resolveClassId(clean(input.classId) || clean(input.className), instituteId);
  if (!classId) return { message: "Choose a class that exists (Master Data → Classes)." };
  const cls = await Class.findOne({ where: { classId, instituteId, isDeleted: false } });
  if (!cls) return { message: "Choose a class that exists (Master Data → Classes)." };

  const sections = await Section.findAll({ where: { classId, instituteId, isDeleted: false } });
  const sectionInput = clean(input.sectionId);
  let section: Section | undefined;
  if (sectionInput) {
    section =
      sections.find((s) => s.sectionId === sectionInput) ??
      sections.find((s) => nameKey(s.sectionName) === nameKey(sectionInput));
    if (!section) return { message: `Section ${sectionInput} is not part of Class ${cls.className}.` };
  } else if (sections.length) {
    return { message: `Choose a section of Class ${cls.className}.` };
  } else {
    // A student's section is a reference to a real section, so a class needs one first.
    return { message: `Class ${cls.className} has no sections yet. Add one (for example A) in Master Data → Sections first.` };
  }

  const sessionInput = clean(input.session);
  const session = await Session.findOne({
    where: sessionInput
      ? { instituteId, isDeleted: false, [Op.or]: [{ sessionName: sessionInput }, { sessionId: sessionInput }] }
      : { instituteId, isDeleted: false, isActive: true },
  });
  if (!session) return { message: "Choose a session that exists (Master Data → Sessions)." };

  return {
    classId,
    className: cls.className,
    sectionId: section?.sectionId ?? "",
    sectionName: section?.sectionName ?? "",
    session: session.sessionName,
  };
};

const placementLabel = (p: Placement) => `Class ${p.className}${p.sectionName ? `-${p.sectionName}` : ""} (${p.session})`;

/** Another active student already has this roll number in the same class, section and session. */
const rollTaken = (instituteId: string, rollNumber: string, p: Placement, exceptUserId?: string) =>
  StudentProfile.findOne({
    where: {
      instituteId,
      rollNumber,
      classId: p.classId,
      sectionId: p.sectionId,
      session: p.session,
      isActive: true,
      ...(exceptUserId ? { userId: { [Op.ne]: exceptUserId } } : {}),
    },
  });

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
    const placement = await resolvePlacement(body, instituteId);
    if ("message" in placement) return fail(httpStatus.BAD_REQUEST, placement.message);

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

    if (await rollTaken(instituteId, rollNumber, placement, restoring?.userId)) {
      return fail(httpStatus.CONFLICT, `Roll number ${rollNumber} is already used in ${placementLabel(placement)}.`);
    }

    const profileUrl = files?.profilePhoto?.[0] ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}` : null;
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
    const profileFields = {
      classId: placement.classId,
      className: placement.className,
      sectionId: placement.sectionId,
      session: placement.session,
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
      if (restoring) {
        await restoring.update(
          { userName: `${body.firstName} ${body.lastName}`, phoneNumber: body.mobile, password: encryptedPassword, status: 1, isDeleted: false },
          { transaction: t }
        );
        const profile = await StudentProfile.findOne({ where: { userId: restoring.userId }, transaction: t });
        if (profile) await profile.update({ ...profileFields, ...(profileUrl ? { profileUrl } : {}) }, { transaction: t });
        else await StudentProfile.create({ userId: restoring.userId, instituteId, ...profileFields, profileUrl }, { transaction: t });
        return restoring;
      }
      const created = await UserModal.create(
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
      await StudentProfile.create({ userId: created.userId, instituteId, ...profileFields, profileUrl }, { transaction: t });
      return created;
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: restoring
        ? `${user.userName} was a deleted student; their account is restored in ${placementLabel(placement)} with their old results.`
        : `Student added to ${placementLabel(placement)}.`,
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
const getAllStudents = async (createdBy: any, query: any): Promise<any> => {
  try {
    const {
      search = "",
      className = "",
      sectionId = "",
      session = "",

    } = query;

    const studentRole = await Role.findOne({ where: { role: "STUDENT" } });

    const where: any = {
      instituteId: createdBy.instituteId,
      roleId: studentRole?.id,
      status: 1,
    };

    if (search) {
      where[Op.or] = [
        { userName: { [Op.iLike]: `%${search}%` } },
        { emailId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Profile filters
    const profileWhere: any = {};
    if (className) profileWhere.className = className;
    if (session) profileWhere.session = session;

    if (sectionId) {
      const resolvedClassId = await resolveClassId(className, createdBy.instituteId);
      const resolvedSectionId = await resolveSectionId(sectionId, resolvedClassId || "", createdBy.instituteId);
      profileWhere.sectionId = resolvedSectionId;
    }

    const students = await UserModal.findAll({
      where,
      include: [
        { model: Role, as: "role" },
        {
          model: StudentProfile,
          as: "studentProfile",
          required: Object.keys(profileWhere).length > 0,
          where:
            Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
          include: [
            {
              model: Class,
              as: "class",
              required: false,
            },
            {
              model: Section,
              as: "section",
              required: false,
            },
          ],
        },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
      order: [["userName", "ASC"]],
    });

    // Exams whose roster includes each student (same rule as rosterExamsFor), counted in
    // memory so the list can show which placements are locked without a query per row.
    const [sessions, exams] = await Promise.all([
      Session.findAll({ where: { instituteId: createdBy.instituteId, isDeleted: false }, attributes: ["sessionId", "sessionName"], raw: true }),
      Exam.findAll({ where: { instituteId: createdBy.instituteId, isDeleted: false }, attributes: ["classId", "sectionId", "sessionId"], raw: true }),
    ]);
    const sessionIdByName = new Map(sessions.map((s: any) => [s.sessionName, s.sessionId]));
    const lockCache = new Map<string, number>();
    const rosterExams = (p: any) => {
      if (!p?.classId || !p?.session) return 0;
      const key = `${p.classId}|${p.sectionId ?? ""}|${p.session}`;
      if (!lockCache.has(key)) {
        const sessionId = sessionIdByName.get(p.session);
        const sectionKeys = [p.sectionId, p.section?.sectionName].filter(Boolean);
        lockCache.set(
          key,
          sessionId
            ? exams.filter((e: any) => e.sessionId === sessionId && e.classId === p.classId && (!e.sectionId || sectionKeys.includes(e.sectionId))).length
            : 0
        );
      }
      return lockCache.get(key)!;
    };

    const result = students.map((u: any) => ({
      userId: u.userId,
      userName: u.userName,
      emailId: u.emailId,
      phoneNumber: u.phoneNumber,
      status: u.status,
      instituteId: u.instituteId,
      rollNumber: u.studentProfile?.rollNumber ?? null,
      classId: u.studentProfile?.classId ?? null,
      /** Exams this student is on the roster of: class, section, session and roll are locked while > 0. */
      examCount: rosterExams(u.studentProfile),
      className: u.studentProfile?.className ?? null,
      sectionId: u.studentProfile?.sectionId ?? null,
      sectionName: u.studentProfile?.section?.sectionName ?? null,
      session: u.studentProfile?.session ?? null,
      fatherName: u.studentProfile?.fatherName ?? null,
      gender: u.studentProfile?.gender ?? null,
      dob: u.studentProfile?.dob ?? null,
      aadhar: u.studentProfile?.aadhar ?? null,
      address: u.studentProfile?.address ?? null,
      profileUrl: u.studentProfile?.profileUrl ?? null,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Students fetched successfully.",
      data: { students: result, total: result.length },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ONE STUDENT ──────────────────────────────────────────────────────────
const getStudentById = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy?.instituteId;
    const userWhere: any = { userId };
    const profileWhere: any = { rollNumber: userId };

    if (instituteId) {
      userWhere.instituteId = instituteId;
      profileWhere.instituteId = instituteId;
    }

    let student = await UserModal.findOne({
      where: userWhere,
      include: [
        { model: Role, as: "role" },
        {
          model: StudentProfile,
          as: "studentProfile",
          include: [
            { model: Class, as: "class", where: { isDeleted: false }, required: false },
            { model: Section, as: "section", where: { isDeleted: false }, required: false },
          ],
        },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
    });

    if (!student) {
      const profile = await StudentProfile.findOne({
        where: profileWhere,
      });
      if (profile && profile.userId) {
        const userSecondWhere: any = { userId: profile.userId };
        if (instituteId) {
          userSecondWhere.instituteId = instituteId;
        }
        student = await UserModal.findOne({
          where: userSecondWhere,
          include: [
            { model: Role, as: "role" },
            {
              model: StudentProfile,
              as: "studentProfile",
              include: [
                { model: Class, as: "class", where: { isDeleted: false }, required: false },
                { model: Section, as: "section", where: { isDeleted: false }, required: false },
              ],
            },
          ],
          attributes: { exclude: ["password", "refreshToken"] },
        });
      }
    }

    if (!student) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Student not found.",
      };
    }

    const s = student.toJSON() as any;
    // Tells the edit form whether class / section / session / roll can still change.
    const placementLock = s.studentProfile ? await studentPlacementLock(s.studentProfile, s.instituteId) : { locked: false, exams: 0, reason: null };
    const data = {
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
          sectionId: s.studentProfile.sectionId,
          sectionName: s.studentProfile.section?.sectionName ?? null,
        }
        : null,
    };

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student fetched successfully.",
      data,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE STUDENT ───────────────────────────────────────────────────────────
// Personal details can always change. Class, section, session and roll number are
// locked while the student is on an exam roster (see academicGuards.service).
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
    let placement: Placement | null = null;
    let rollNumber = profile?.rollNumber ?? "";

    if (profile) {
      const wantsPlacement = ["classId", "className", "sectionId", "session", "rollNumber"].some((k) => body[k] !== undefined);
      if (wantsPlacement) {
        const resolved = await resolvePlacement(
          {
            classId: body.classId ?? (body.className === undefined ? profile.classId : undefined),
            className: body.className ?? profile.className,
            sectionId: body.sectionId ?? profile.sectionId,
            session: body.session ?? profile.session,
          },
          instituteId
        );
        if ("message" in resolved) return fail(httpStatus.BAD_REQUEST, resolved.message);
        rollNumber = clean(body.rollNumber ?? profile.rollNumber);
        if (!rollNumber) return fail(httpStatus.BAD_REQUEST, "Roll number is required.");

        // Older profiles keep the class / section by name; the same place by name is not a move.
        const sameClass = resolved.classId === profile.classId || (!profile.classId && nameKey(resolved.className) === nameKey(profile.className));
        const sameSection =
          resolved.sectionId === (profile.sectionId ?? "") || (resolved.sectionName !== "" && nameKey(resolved.sectionName) === nameKey(profile.sectionId));
        const moved = !sameClass || !sameSection || resolved.session !== profile.session || rollNumber !== profile.rollNumber;
        if (moved) {
          const lock = await studentPlacementLock(profile, instituteId);
          if (lock.locked) return fail(httpStatus.CONFLICT, lock.reason);
          if (await rollTaken(instituteId, rollNumber, resolved, userId)) {
            return fail(httpStatus.CONFLICT, `Roll number ${rollNumber} is already used in ${placementLabel(resolved)}.`);
          }
          placement = resolved;
        }
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
          ...(placement
            ? { classId: placement.classId, className: placement.className, sectionId: placement.sectionId, session: placement.session, rollNumber }
            : {}),
          fatherName: body.fatherName ?? profile.fatherName,
          gender: body.gender ?? profile.gender,
          address: body.address ?? profile.address,
          dob: body.dob ?? profile.dob,
          aadhar: body.aadhar ?? profile.aadhar,
          profileUrl,
        },
        { transaction: t }
      );
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: placement ? `Student updated and moved to ${placementLabel(placement)}.` : "Student updated.",
      data: { userId, userName: user.userName },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── DELETE STUDENT ───────────────────────────────────────────────────────────
// Deactivates the account and frees the roll number. Published results stay linked to
// the student; adding them again with the same email restores the account.
const deleteStudent = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const user = await UserModal.findOne({ where: { userId, instituteId } });
    if (!user) return fail(httpStatus.NOT_FOUND, "Student not found.");

    await sequelize.transaction(async (t) => {
      await user.update({ status: 0, refreshToken: null }, { transaction: t });
      await StudentProfile.update({ isActive: false }, { where: { userId, instituteId }, transaction: t });
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${user.userName} deleted. Their published results are kept; add them again with the same email to place them in another class.`,
      data: {},
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── PROMOTE STUDENTS (year end) ──────────────────────────────────────────────
// Moves the chosen students to a class / section of another session in one go.
// Old exams keep their published results (they store class, section and session),
// so a student can move once their work in the current session is published.
// Body: { studentIds[], toClassId, toSectionId?, toSession, rollNumbers?: { [userId]: roll } }
const promoteStudents = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  try {
    const studentIds: string[] = Array.from(new Set((Array.isArray(body.studentIds) ? body.studentIds : []).map(String))).filter(Boolean) as string[];
    if (!studentIds.length) return fail(httpStatus.BAD_REQUEST, "Choose at least one student.");
    if (studentIds.length > 500) return fail(httpStatus.BAD_REQUEST, "You can promote up to 500 students at a time.");

    const target = await resolvePlacement(
      { classId: body.toClassId, sectionId: body.toSectionId, session: body.toSession ?? body.toSessionId },
      instituteId
    );
    if ("message" in target) return fail(httpStatus.BAD_REQUEST, target.message);
    const rolls: Record<string, unknown> = body.rollNumbers && typeof body.rollNumbers === "object" ? body.rollNumbers : {};

    const profiles = await StudentProfile.findAll({
      where: { instituteId, userId: { [Op.in]: studentIds }, isActive: true },
      include: [{ model: UserModal, as: "user", attributes: ["userId", "userName", "status"], required: true, where: { status: 1 } }],
    });
    const byId = new Map(profiles.map((p) => [p.userId, p]));

    const skipped: { userId: string; name: string; reason: string }[] = [];
    const moves: { profile: StudentProfile; rollNumber: string }[] = [];
    const rollsInBatch = new Set<string>();

    for (const id of studentIds) {
      const profile = byId.get(id);
      const name = (profile as any)?.user?.userName ?? "";
      if (!profile) {
        skipped.push({ userId: id, name, reason: "Not an active student of this institute." });
        continue;
      }
      const rollNumber = clean(rolls[id]) || clean(profile.rollNumber);
      if (profile.classId === target.classId && (profile.sectionId ?? "") === target.sectionId && profile.session === target.session) {
        skipped.push({ userId: id, name, reason: `Already in ${placementLabel(target)}.` });
        continue;
      }
      // Within the same session this is a class change, which the exam roster lock governs.
      if (profile.session === target.session) {
        const lock = await studentPlacementLock(profile, instituteId);
        if (lock.locked) {
          skipped.push({ userId: id, name, reason: `On the roster of ${lock.exams} exam(s) in ${profile.session}; delete and add again to move.` });
          continue;
        }
      } else {
        const open = await unfinishedExamsFor(profile, instituteId);
        if (open) {
          skipped.push({ userId: id, name, reason: `Has answer sheets in ${open} unpublished exam(s) of ${profile.session}. Publish those results first.` });
          continue;
        }
      }
      if (rollsInBatch.has(rollNumber) || (await rollTaken(instituteId, rollNumber, target, id))) {
        skipped.push({ userId: id, name, reason: `Roll number ${rollNumber} is already used in ${placementLabel(target)}.` });
        continue;
      }
      rollsInBatch.add(rollNumber);
      moves.push({ profile, rollNumber });
    }

    if (moves.length) {
      await sequelize.transaction(async (t) => {
        for (const { profile, rollNumber } of moves) {
          await profile.update(
            { classId: target.classId, className: target.className, sectionId: target.sectionId, session: target.session, rollNumber },
            { transaction: t }
          );
        }
      });
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: moves.length
        ? `${moves.length} ${moves.length === 1 ? "student" : "students"} moved to ${placementLabel(target)}${skipped.length ? ` · ${skipped.length} skipped` : ""}.`
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
