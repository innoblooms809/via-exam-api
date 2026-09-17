import httpStatus from "http-status";
import Class from "../modals/Class.modal";
import RegHelper from "../utils/helper";
import Section from "../modals/Section.modal";
import Subject from "../modals/Subject.modal";
import User from "../modals/User.modal";
import Exam from "../modals/Exam.modal";
import StudentProfile from "../modals/Student.modal";
import { sequelize } from "../config/sequelize";
import {
  MAX_BULK_ITEMS,
  MAX_NAME_LENGTH,
  nameKey,
  normalizeClassName,
  normalizeSectionName,
  normalizeSubjectName,
  uniqueNames,
} from "../utils/academicNames";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

/** "2" before "10", "LKG"/"Nursery" after the numbered classes. */
export const compareClassNames = (a: string, b: string) =>
  String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ─── CREATE CLASS(ES) ─────────────────────────────────────────────────────────
// Accepts { className } or { classNames: [] }, plus optional sections / subjects
// that are added to every class created.
const createClass = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const classNames = uniqueNames(body.classNames ?? body.className, normalizeClassName);
  const sectionNames = uniqueNames(body.sections ?? [], normalizeSectionName);
  const subjectNames = uniqueNames(body.subjects ?? [], normalizeSubjectName);

  if (classNames.length === 0) return fail(httpStatus.BAD_REQUEST, "Enter at least one class.");
  if (classNames.length > MAX_BULK_ITEMS || sectionNames.length > 26 || subjectNames.length > MAX_BULK_ITEMS) {
    return fail(httpStatus.BAD_REQUEST, `You can add up to ${MAX_BULK_ITEMS} classes or subjects and 26 sections at a time.`);
  }
  const tooLong = [...classNames, ...sectionNames, ...subjectNames].find((n) => n.length > MAX_NAME_LENGTH);
  if (tooLong) return fail(httpStatus.BAD_REQUEST, `"${tooLong.slice(0, 20)}…" is too long (max ${MAX_NAME_LENGTH} characters).`);

  const t = await sequelize.transaction();
  try {
    const existing = await Class.findAll({ where: { instituteId }, transaction: t });
    const byKey = new Map(existing.map((c) => [nameKey(c.className), c]));

    const created: string[] = [];
    const restored: string[] = [];
    const skipped: string[] = [];
    const touched: Class[] = [];

    for (const className of classNames) {
      const found = byKey.get(nameKey(className));
      if (found && !found.isDeleted) {
        skipped.push(found.className);
        continue;
      }
      if (found) {
        await found.update({ isDeleted: false, isActive: true }, { transaction: t });
        restored.push(found.className);
        touched.push(found);
        continue;
      }
      const row = await Class.create(
        { classId: await RegHelper.generateUserId(), instituteId, className },
        { transaction: t },
      );
      created.push(className);
      touched.push(row);
    }

    // Sections and subjects for the new classes (existing ones are left as they are).
    for (const cls of touched) {
      if (sectionNames.length) {
        const current = await Section.findAll({ where: { classId: cls.classId }, transaction: t });
        const sections = new Map(current.map((s) => [nameKey(s.sectionName), s]));
        for (const sectionName of sectionNames) {
          const found = sections.get(nameKey(sectionName));
          if (found) {
            if (found.isDeleted) await found.update({ isDeleted: false, isActive: true }, { transaction: t });
            continue;
          }
          await Section.create(
            { sectionId: await RegHelper.generateUserId(), classId: cls.classId, instituteId, sectionName },
            { transaction: t },
          );
        }
      }
      if (subjectNames.length) {
        const current = await Subject.findAll({ where: { classId: cls.classId }, transaction: t });
        const subjects = new Map(current.map((s) => [nameKey(s.subjectName), s]));
        for (const subjectName of subjectNames) {
          const found = subjects.get(nameKey(subjectName));
          if (found) {
            if (found.isDeleted) await found.update({ isDeleted: false, isActive: true }, { transaction: t });
            continue;
          }
          await Subject.create(
            {
              subjectId: await RegHelper.generateUserId(),
              classId: cls.classId,
              instituteId,
              subjectName,
              totalMarks: 100,
              passingMarks: 35,
            },
            { transaction: t },
          );
        }
      }
    }

    if (created.length + restored.length === 0) {
      await t.rollback();
      return fail(
        httpStatus.CONFLICT,
        skipped.length === 1 ? `Class ${skipped[0]} already exists.` : `Classes ${skipped.join(", ")} already exist.`,
      );
    }
    await t.commit();

    const added = created.length + restored.length;
    const parts = [`${added} ${added === 1 ? "class" : "classes"} added`];
    if (skipped.length) parts.push(`${skipped.join(", ")} already existed`);

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: `${parts.join(" · ")}.`,
      data: { created, restored, skipped, classes: touched },
    };
  } catch (e: any) {
    await t.rollback();
    console.error("POST /v1/class/createClass 500 - Error in service:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = async (createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const classes = await Class.findAll({
      where: { instituteId, isActive: true, isDeleted: false },
      include: [
        { model: Section, as: "sections", where: { isDeleted: false }, required: false },
        { model: Subject, as: "subjects", where: { isDeleted: false }, required: false },
        { model: User, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });

    const studentRows = (await StudentProfile.findAll({
      attributes: ["classId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: { instituteId },
      group: ["classId"],
      raw: true,
    })) as any[];
    const students = new Map<string, number>(studentRows.map((r) => [r.classId, Number(r.count)]));

    const rows = classes
      .map((c) => {
        const json: any = c.toJSON();
        json.sections = [...(json.sections ?? [])].sort((a: any, b: any) => compareClassNames(a.sectionName, b.sectionName));
        json.subjects = [...(json.subjects ?? [])].sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName));
        json.studentCount = students.get(c.classId) ?? 0;
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
        { model: Section, as: "sections", where: { isDeleted: false }, required: false },
        { model: Subject, as: "subjects", where: { isDeleted: false }, required: false },
        { model: User, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });
    if (!classData) return fail(404, "Class not found.");

    const json: any = classData.toJSON();
    json.sections = [...(json.sections ?? [])].sort((a: any, b: any) => compareClassNames(a.sectionName, b.sectionName));
    json.subjects = [...(json.subjects ?? [])].sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName));
    json.studentCount = await StudentProfile.count({ where: { instituteId: createdBy.instituteId, classId } });

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
      StudentProfile.count({ where: { instituteId, classId } }),
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
