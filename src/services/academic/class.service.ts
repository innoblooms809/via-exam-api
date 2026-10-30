import httpStatus from "http-status";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import User from "../../models/User.model";
import Exam from "../../models/Exam.model";
import StudentProfile from "../../models/Student.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import { Op, UniqueConstraintError } from "sequelize";
import { sequelize } from "../../config/sequelize";
import { newId } from "../../utils/idGenerator";
import { examCountsBy, examsUsing, renameLockMessage } from "./academicGuards.service";
import StudentEnrollment from "../../models/StudentEnrollment.model";
import { activeSession, addToSession, findSession, forgetMasterRows, runningIn, sessionForNewRows } from "./sessionSetup.service";
import {
  MAX_BULK_ITEMS,
  MAX_NAME_LENGTH,
  nameKey,
  normalizeClassName,
  normalizeSectionName,
  normalizeSubjectName,
  uniqueNames,
} from "../../utils/academicNames";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

/** "2" before "10", "LKG"/"Nursery" after the numbered classes. */
export const compareClassNames = (a: string, b: string) =>
  String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ─── CREATE CLASS(ES) ─────────────────────────────────────────────────────────
// Accepts { className } or { classNames: [] }, plus optional sections / subjects
// that are added to every class created. A class always gets at least one section
// (A when none is given): students and exams belong to a section.
//
// Classes are master data: one "Class 6" for every session. Added without a session
// (Master Data) they run in none until Session setup adds them. With { sessionId } (a
// screen working in one session) they also run in that session: missing classes are
// made, and classes already in master data join it with the sections and subjects
// asked for, or all of their own when none are.
const DEFAULT_SECTION = "A";

const createClass = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const classNames = uniqueNames(body.classNames ?? body.className, normalizeClassName);
  const askedSections = uniqueNames(body.sections ?? [], normalizeSectionName);
  const subjectNames = uniqueNames(body.subjects ?? [], normalizeSubjectName);
  const askedSubjects: any[] = Array.isArray(body.subjects) ? body.subjects : [];

  if (classNames.length === 0) return fail(httpStatus.BAD_REQUEST, "Enter at least one class.");
  if (classNames.length > MAX_BULK_ITEMS || askedSections.length > 26 || subjectNames.length > MAX_BULK_ITEMS) {
    return fail(httpStatus.BAD_REQUEST, `You can add up to ${MAX_BULK_ITEMS} classes or subjects and 26 sections at a time.`);
  }
  const tooLong = [...classNames, ...askedSections, ...subjectNames].find((n) => n.length > MAX_NAME_LENGTH);
  if (tooLong) return fail(httpStatus.BAD_REQUEST, `"${tooLong.slice(0, 20)}…" is too long (max ${MAX_NAME_LENGTH} characters).`);

  const target = await sessionForNewRows(instituteId, body.sessionId);
  if ("message" in target) return fail(target.status, target.message);
  const session = target.session;

  const t = await sequelize.transaction();
  try {
    const existing = await Class.findAll({ where: { instituteId }, transaction: t });
    const byKey = new Map(existing.map((c) => [nameKey(c.className), c]));
    const inSession = session ? (await runningIn(session.sessionId, t)).classIds : new Set<string>();

    const created: string[] = [];
    const restored: string[] = [];
    const joined: string[] = [];
    const skipped: string[] = [];
    const touched: { cls: Class; joining: boolean }[] = [];
    const forSession: { sections: { classId: string; sectionId: string }[]; subjects: { classId: string; subjectId: string }[] } = { sections: [], subjects: [] };

    for (const className of classNames) {
      const found = byKey.get(nameKey(className));
      if (found && !found.isDeleted) {
        if (!session || inSession.has(found.classId)) {
          skipped.push(found.className);
          continue;
        }
        joined.push(found.className);
        touched.push({ cls: found, joining: true });
        continue;
      }
      if (found) {
        await found.update({ isDeleted: false, isActive: true }, { transaction: t });
        restored.push(found.className);
        touched.push({ cls: found, joining: false });
        continue;
      }
      const row = await Class.create({ classId: newId("class"), instituteId, className }, { transaction: t });
      created.push(className);
      touched.push({ cls: row, joining: false });
    }

    // Sections and subjects of the classes made, brought back or joining the session
    // (classes that were skipped are left as they are).
    for (const { cls, joining } of touched) {
      const createdSectionMap = new Map<string, string>();

      const current = await Section.findAll({ where: { classId: cls.classId }, transaction: t });
      const sectionsMap = new Map(current.map((s) => [nameKey(s.sectionName), s]));
      const own = current.filter((s) => !s.isDeleted).map((s) => s.sectionName);
      const sectionNames = askedSections.length ? askedSections : joining && own.length ? own : [DEFAULT_SECTION];
      for (const sectionName of sectionNames) {
        const found = sectionsMap.get(nameKey(sectionName));
        if (found) {
          if (found.isDeleted) await found.update({ isDeleted: false, isActive: true }, { transaction: t });
          createdSectionMap.set(nameKey(found.sectionName), found.sectionId);
          forSession.sections.push({ classId: cls.classId, sectionId: found.sectionId });
          continue;
        }
        const newSec = await Section.create(
          { sectionId: newId("section"), classId: cls.classId, instituteId, sectionName },
          { transaction: t },
        );
        createdSectionMap.set(nameKey(sectionName), newSec.sectionId);
        forSession.sections.push({ classId: cls.classId, sectionId: newSec.sectionId });
      }

      if (askedSubjects.length > 0) {
        const currentSubjects = await Subject.findAll({ where: { classId: cls.classId }, transaction: t });
        for (const item of askedSubjects) {
          const subjectName = typeof item === "string" ? normalizeSubjectName(item) : normalizeSubjectName(item?.subjectName);
          if (!subjectName) continue;
          const itemSecName = typeof item === "object" && item?.sectionName ? normalizeSectionName(item.sectionName) : null;
          const targetSectionId = itemSecName ? createdSectionMap.get(nameKey(itemSecName)) ?? null : null;

          const found = currentSubjects.find(
            (s) => (s.sectionId ?? null) === targetSectionId && nameKey(s.subjectName) === nameKey(subjectName)
          );
          if (found) {
            if (found.isDeleted) await found.update({ isDeleted: false, isActive: true, sectionId: targetSectionId }, { transaction: t });
            forSession.subjects.push({ classId: cls.classId, subjectId: found.subjectId });
            continue;
          }
          const subjectId = newId("subject");
          forSession.subjects.push({ classId: cls.classId, subjectId });
          await Subject.create(
            {
              subjectId,
              instituteId,
              classId: cls.classId,
              sectionId: targetSectionId,
              subjectName,
              totalMarks: 100,
              passingMarks: 35,
            },
            { transaction: t },
          );
        }
      } else if (joining) {
        // Its own subjects, where their section runs too.
        const running = new Set(createdSectionMap.values());
        const own = await Subject.findAll({ where: { classId: cls.classId, isDeleted: false }, transaction: t });
        for (const s of own) if (!s.sectionId || running.has(s.sectionId)) forSession.subjects.push({ classId: cls.classId, subjectId: s.subjectId });
      }
    }

    const added = created.length + restored.length + joined.length;
    if (added === 0) {
      await t.rollback();
      const one = skipped.length === 1;
      return fail(
        httpStatus.CONFLICT,
        session
          ? `${one ? `Class ${skipped[0]} is` : `Classes ${skipped.join(", ")} are`} already in ${session.sessionName}.`
          : one
            ? `Class ${skipped[0]} already exists.`
            : `Classes ${skipped.join(", ")} already exist.`,
      );
    }
    if (session) await addToSession(instituteId, session.sessionId, forSession, t);
    await t.commit();

    const parts = [`${added} ${added === 1 ? "class" : "classes"} added to ${session ? session.sessionName : "master data"}`];
    if (skipped.length) parts.push(`${skipped.join(", ")} ${session ? `already in ${session.sessionName}` : "already existed"}`);

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: `${parts.join(" · ")}.`,
      data: {
        created,
        restored,
        joined,
        skipped,
        session: session ? { sessionId: session.sessionId, sessionName: session.sessionName } : null,
        classes: touched.map((x) => x.cls),
      },
    };
  } catch (e: any) {
    await t.rollback();
    // Another admin added the same class a moment ago.
    if (e instanceof UniqueConstraintError) return fail(httpStatus.CONFLICT, "One of these classes was just added by someone else. Refresh and try again.");
    console.error("POST /v1/class/createClass 500 - Error in service:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = async (createdBy: any, query?: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const whereClause: any = { instituteId, isActive: true, isDeleted: false };
    // One session's classes: those running in it, with the sections and subjects that run there.
    const session = query?.sessionId ? await findSession(instituteId, query.sessionId) : null;
    if (query?.sessionId && !session) return fail(httpStatus.NOT_FOUND, "Session not found.");
    const running = session ? await runningIn(session.sessionId) : null;
    if (running) whereClause.classId = { [Op.in]: [...running.classIds] };

    const classes = await Class.findAll({
      where: whereClause,
      include: [
        { model: Section, as: "sections", where: { isDeleted: false }, required: false },
        {
          model: Subject,
          as: "subjects",
          where: { isDeleted: false },
          required: false,
          include: [{ model: Section, as: "section", where: { isDeleted: false }, required: false }],
        },
        { model: User, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });

    const counted = session ?? (await activeSession(instituteId));
    const studentRows = (await StudentEnrollment.findAll({
      attributes: ["classId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: { instituteId, sessionId: counted?.sessionId ?? "-", isActive: true },
      group: ["classId"],
      raw: true,
    })) as any[];
    const students = new Map<string, number>(studentRows.map((r) => [r.classId, Number(r.count)]));
    const exams = await examCountsBy(instituteId, "classId");

    const rows = classes
      .map((c) => {
        const json: any = c.toJSON();
        json.sections = (json.sections ?? [])
          .filter((s: any) => !running || running.sectionIds.has(s.sectionId))
          .sort((a: any, b: any) => compareClassNames(a.sectionName, b.sectionName));
        json.subjects = (json.subjects ?? [])
          .filter((s: any) => !running || running.subjectIds.has(s.subjectId))
          .sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName));
        json.studentCount = students.get(c.classId) ?? 0;
        json.examCount = exams.get(c.classId) ?? 0;
        return json;
      })
      .sort((a, b) => compareClassNames(a.className, b.className));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Classes fetched successfully.",
      data: { classes: rows, total: rows.length },
    };
  } catch (e: any) {
    return fail(500, e.message);
  }
};

// ─── GET ONE CLASS ────────────────────────────────────────────────────────────
const getClassById = async (classId: string, createdBy: any): Promise<any> => {
  try {
    const classData = await Class.findOne({
      where: { classId, instituteId: createdBy.instituteId, isDeleted: false },
      include: [
        {
          model: Section,
          as: "sections",
          where: { isDeleted: false },
          required: false,
          include: [
            {
              model: User,
              as: "classTeacher",
              attributes: ["userId", "userName", "emailId", "phoneNumber"],
              required: false,
              include: [
                {
                  model: TeacherProfile,
                  as: "teacherProfile",
                  attributes: ["qualification", "experience", "specialization"],
                  required: false,
                },
              ],
            },
          ],
        },
        {
          model: Subject,
          as: "subjects",
          where: { isDeleted: false },
          required: false,
          include: [
            { model: Section, as: "section", where: { isDeleted: false }, required: false },
            {
              model: User,
              as: "teacher",
              attributes: ["userId", "userName", "emailId", "phoneNumber"],
              required: false,
              include: [
                {
                  model: TeacherProfile,
                  as: "teacherProfile",
                  attributes: ["qualification", "experience", "specialization"],
                  required: false,
                },
              ],
            },
          ],
        },
        {
          model: User,
          as: "classTeacher",
          attributes: ["userId", "userName", "emailId", "phoneNumber"],
          required: false,
          include: [
            {
              model: TeacherProfile,
              as: "teacherProfile",
              attributes: ["qualification", "experience", "specialization"],
              required: false,
            },
          ],
        },
      ],
    });
    if (!classData) return fail(404, "Class not found.");

    const json: any = classData.toJSON();
    json.sections = [...(json.sections ?? [])].sort((a: any, b: any) => compareClassNames(a.sectionName, b.sectionName));
    json.subjects = [...(json.subjects ?? [])].sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName));
    const current = await activeSession(createdBy.instituteId);
    json.studentCount = await StudentEnrollment.count({ where: { instituteId: createdBy.instituteId, classId, sessionId: current?.sessionId ?? "-", isActive: true } });

    return { error: false, statusCode: 200, message: "Class fetched successfully.", data: json };
  } catch (e: any) {
    return fail(500, e.message);
  }
};

// ─── UPDATE CLASS ─────────────────────────────────────────────────────────────
const updateClass = async (classId: string, body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const t = await sequelize.transaction();
  try {
    const classData = await Class.findOne({ where: { classId, instituteId, isDeleted: false }, transaction: t });
    if (!classData) {
      await t.rollback();
      return fail(404, "Class not found.");
    }

    const className = normalizeClassName(body.className ?? classData.className);
    if (!className) {
      await t.rollback();
      return fail(httpStatus.BAD_REQUEST, "Class name can't be empty.");
    }
    if (className.length > MAX_NAME_LENGTH) {
      await t.rollback();
      return fail(httpStatus.BAD_REQUEST, `Class name can be at most ${MAX_NAME_LENGTH} characters.`);
    }

    const others = await Class.findAll({ where: { instituteId }, transaction: t });
    const clash = others.find((c) => c.classId !== classId && nameKey(c.className) === nameKey(className));
    if (clash) {
      await t.rollback();
      return fail(
        httpStatus.CONFLICT,
        clash.isDeleted
          ? `A deleted class ${clash.className} exists. Add class ${clash.className} again to restore it.`
          : `Class ${clash.className} already exists.`,
      );
    }

    const oldName = classData.className;
    if (className !== oldName) {
      const exams = await examsUsing(instituteId, { classId }, t);
      if (exams) {
        await t.rollback();
        return fail(httpStatus.CONFLICT, renameLockMessage(`Class ${oldName}`, exams));
      }
    }
    await classData.update({ className }, { transaction: t });
    // Student profiles keep a copy of the class name.
    if (oldName !== className) {
      await StudentProfile.update({ className }, { where: { instituteId, classId }, transaction: t });
    }
    await t.commit();

    return { error: false, statusCode: 200, message: `Class ${className} updated.`, data: classData };
  } catch (e: any) {
    await t.rollback();
    return fail(500, e.message);
  }
};

// ─── DELETE CLASS ─────────────────────────────────────────────────────────────
const deleteClass = async (classId: string, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  try {
    const classData = await Class.findOne({ where: { classId, instituteId, isDeleted: false } });
    if (!classData) return fail(httpStatus.NOT_FOUND, "Class not found.");

    const [students, exams] = await Promise.all([
      StudentEnrollment.count({ where: { instituteId, classId } }),
      Exam.count({ where: { instituteId, classId, isDeleted: false } }),
    ]);
    if (students || exams) {
      const used = [students && plural(students, "student"), exams && plural(exams, "exam")].filter(Boolean).join(" and ");
      return fail(httpStatus.CONFLICT, `Class ${classData.className} can't be deleted because it has ${used}.`);
    }

    await sequelize.transaction(async (t) => {
      await classData.update({ isDeleted: true, isActive: false }, { transaction: t });
      await Section.update({ isDeleted: true, isActive: false }, { where: { classId }, transaction: t });
      await Subject.update({ isDeleted: true, isActive: false }, { where: { classId }, transaction: t });
      await forgetMasterRows({ classId }, t);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Class ${classData.className} and its sections and subjects were deleted.`,
      data: {},
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

export default {
  createClass,
  getAllClasses,
  getClassById,
  updateClass,
  deleteClass,
};
