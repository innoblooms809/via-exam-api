import httpStatus from "http-status";
import { Op } from "sequelize";
import Section from "../../models/Section.model";
import Class from "../../models/Class.model";
import User from "../../models/User.model";
import Exam from "../../models/Exam.model";
import StudentProfile from "../../models/Student.model";
import { sequelize } from "../../config/sequelize";
import { compareClassNames } from "./class.service";
import { MAX_NAME_LENGTH, nameKey, normalizeSectionName, uniqueNames } from "../../utils/academicNames";
import { newId } from "../../utils/idGenerator";
import { examCountsBy, examsUsing, findStaff, renameLockMessage } from "./academicGuards.service";
import { checkClassTeacherPost, classTeacherPostOf, isHeadTeacher, syncTeacherType } from "../teacher/classTeacher.service";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

const MAX_SECTIONS_PER_REQUEST = 26;

/** An active teacher of this institute (not a student or another role). */
const findTeacher = async (userId: string, instituteId: string) => {
  const teacher = await findStaff(userId, instituteId, "TEACHER");
  return teacher && teacher.status === 1 && !teacher.isDeleted ? teacher : null;
};

// ─── CREATE SECTION(S) ────────────────────────────────────────────────────────
// Accepts { classId | classIds[], sectionName | sectionNames[] } — every section
// is added to every class chosen.
const createSection = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const classIds: string[] = Array.from(
    new Set((Array.isArray(body.classIds) ? body.classIds : [body.classId]).filter(Boolean).map(String)),
  );
  const sectionNames = uniqueNames(body.sectionNames ?? body.sectionName, normalizeSectionName);

  if (classIds.length === 0) return fail(httpStatus.BAD_REQUEST, "Choose at least one class.");
  if (sectionNames.length === 0) return fail(httpStatus.BAD_REQUEST, "Enter at least one section.");
  if (sectionNames.length > MAX_SECTIONS_PER_REQUEST || classIds.length > 50) {
    return fail(httpStatus.BAD_REQUEST, `You can add up to ${MAX_SECTIONS_PER_REQUEST} sections to 50 classes at a time.`);
  }
  const tooLong = sectionNames.find((n) => n.length > 20);
  if (tooLong) return fail(httpStatus.BAD_REQUEST, `Section "${tooLong.slice(0, 20)}" is too long (max 20 characters).`);

  const classTeacherId = body.classTeacherId ? String(body.classTeacherId) : null;
  if (classTeacherId && !(await findTeacher(classTeacherId, instituteId))) {
    return fail(httpStatus.NOT_FOUND, "That teacher was not found or is deactivated.");
  }
  if (classTeacherId) {
    // A class teacher looks after one section.
    if (classIds.length * sectionNames.length > 1) {
      return fail(httpStatus.BAD_REQUEST, "A class teacher looks after one section. Add the sections first, then choose a class teacher for each.");
    }
    const other = await classTeacherPostOf(classTeacherId, instituteId);
    if (other) {
      return fail(httpStatus.CONFLICT, `${(await findTeacher(classTeacherId, instituteId))?.userName ?? "This teacher"} is already class teacher of ${(other as any).class?.className ?? ""}-${other.sectionName}. A teacher looks after one section.`);
    }
    if (await isHeadTeacher(classTeacherId, instituteId)) {
      return fail(httpStatus.BAD_REQUEST, "The head teacher isn't a class teacher. Choose another teacher.");
    }
  }

  const t = await sequelize.transaction();
  try {
    const classes = await Class.findAll({
      where: { classId: { [Op.in]: classIds }, instituteId, isDeleted: false },
      transaction: t,
    });
    if (classes.length !== classIds.length) {
      await t.rollback();
      return fail(httpStatus.NOT_FOUND, "One of the chosen classes was not found. Refresh and try again.");
    }

    let added = 0;
    const skipped: string[] = [];

    for (const cls of classes.sort((a, b) => compareClassNames(a.className, b.className))) {
      const current = await Section.findAll({ where: { classId: cls.classId }, transaction: t });
      const byKey = new Map(current.map((s) => [nameKey(s.sectionName), s]));

      for (const sectionName of sectionNames) {
        const found = byKey.get(nameKey(sectionName));
        if (found && !found.isDeleted) {
          skipped.push(`${cls.className}-${found.sectionName}`);
          continue;
        }
        if (found) {
          await found.update(
            { isDeleted: false, isActive: true, classTeacherId: classTeacherId ?? found.classTeacherId },
            { transaction: t },
          );
        } else {
          await Section.create(
            {
              sectionId: newId("section"),
              classId: cls.classId,
              instituteId,
              sectionName,
              classTeacherId,
            },
            { transaction: t },
          );
        }
        added += 1;
      }
    }

    if (added === 0) {
      await t.rollback();
      return fail(
        httpStatus.CONFLICT,
        skipped.length === 1 ? `Section ${skipped[0]} already exists.` : `These sections already exist: ${skipped.join(", ")}.`,
      );
    }
    await syncTeacherType(classTeacherId, instituteId, t);
    await t.commit();

    const parts = [`${added} ${added === 1 ? "section" : "sections"} added`];
    if (skipped.length) parts.push(`${skipped.join(", ")} already existed`);
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: `${parts.join(" · ")}.`,
      data: { added, skipped },
    };
  } catch (e: any) {
    await t.rollback();
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

// ─── GET ALL SECTIONS ─────────────────────────────────────────────────────────
const getAllSections = async (query: any, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const where: any = { instituteId, isDeleted: false, isActive: true };
    if (query.classId) where.classId = query.classId;

    const sections = await Section.findAll({
      where,
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"], where: { isDeleted: false }, required: true },
        { model: User, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });

    const studentRows = (await StudentProfile.findAll({
      attributes: ["sectionId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: { instituteId },
      group: ["sectionId"],
      raw: true,
    })) as any[];
    const students = new Map<string, number>(studentRows.map((r) => [r.sectionId, Number(r.count)]));
    const [ownExams, classExams] = await Promise.all([examCountsBy(instituteId, "sectionId"), examCountsBy(instituteId, "classId")]);

    const rows = sections
      .map((s) => ({
        ...(s.toJSON() as any),
        studentCount: students.get(s.sectionId) ?? 0,
        // Exams of this section (block delete) and of its class (block rename).
        examCount: ownExams.get(s.sectionId) ?? 0,
        classExamCount: classExams.get(s.classId) ?? 0,
      }))
      .sort(
        (a, b) =>
          compareClassNames(a.class?.className ?? "", b.class?.className ?? "") ||
          compareClassNames(a.sectionName, b.sectionName),
      );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sections fetched successfully.",
      data: { sections: rows, total: rows.length },
    };
  } catch (e: any) {
    return fail(500, e.message);
  }
};

// ─── GET SECTION BY ID ────────────────────────────────────────────────────────
const getSectionById = async (sectionId: string, createdBy: any): Promise<any> => {
  try {
    const section = await Section.findOne({
      where: { sectionId, instituteId: createdBy.instituteId, isDeleted: false },
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"], where: { isDeleted: false }, required: true },
        { model: User, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });
    if (!section) return fail(404, "Section not found.");

    const studentCount = await StudentProfile.count({ where: { instituteId: createdBy.instituteId, sectionId } });
    return {
      error: false,
      statusCode: 200,
      message: "Section fetched successfully.",
      data: { ...(section.toJSON() as any), studentCount },
    };
  } catch (e: any) {
    return fail(500, e.message);
  }
};

// ─── UPDATE SECTION ───────────────────────────────────────────────────────────
const updateSection = async (sectionId: string, body: any, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const section = await Section.findOne({ where: { sectionId, instituteId, isDeleted: false } });
    if (!section) return fail(404, "Section not found.");

    const hasName = Object.prototype.hasOwnProperty.call(body, "sectionName");
    const sectionName = hasName ? normalizeSectionName(body.sectionName) : section.sectionName;
    if (!sectionName) return fail(httpStatus.BAD_REQUEST, "Section name can't be empty.");
    if (sectionName.length > 20) return fail(httpStatus.BAD_REQUEST, "Section name can be at most 20 characters.");

    if (sectionName !== section.sectionName) {
      // Older answer sheets store the section by name, for section and whole-class exams alike.
      const exams = await examsUsing(instituteId, { classId: section.classId });
      if (exams) return fail(httpStatus.CONFLICT, renameLockMessage(`Section ${section.sectionName}`, exams));
      const siblings = await Section.findAll({ where: { classId: section.classId, sectionId: { [Op.ne]: sectionId } } });
      const clash = siblings.find((s) => nameKey(s.sectionName) === nameKey(sectionName));
      if (clash) {
        return fail(
          httpStatus.CONFLICT,
          clash.isDeleted
            ? `A deleted section ${clash.sectionName} exists in this class. Add it again to restore it.`
            : `Section ${clash.sectionName} already exists in this class.`,
        );
      }
    }

    const previousTeacherId = section.classTeacherId;
    let classTeacherId = section.classTeacherId;
    if (body.classTeacherId !== undefined) {
      classTeacherId = body.classTeacherId ? String(body.classTeacherId) : null;
      if (classTeacherId && !(await findTeacher(classTeacherId, instituteId))) {
        return fail(httpStatus.NOT_FOUND, "That teacher was not found or is deactivated.");
      }
      if (classTeacherId && classTeacherId !== previousTeacherId) {
        // This is the section's own form, so its current class teacher may be replaced.
        const check = await checkClassTeacherPost(classTeacherId, sectionId, instituteId, { replace: true });
        if ("message" in check) return fail(check.status, check.message);
      }
    }

    await section.update({ sectionName, classTeacherId });
    if (classTeacherId !== previousTeacherId) {
      await syncTeacherType(classTeacherId, instituteId);
      await syncTeacherType(previousTeacherId, instituteId);
    }
    await section.reload({
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"] },
        { model: User, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });

    return { error: false, statusCode: 200, message: `Section ${sectionName} updated.`, data: section };
  } catch (e: any) {
    return fail(500, e.message);
  }
};

// ─── DELETE SECTION ───────────────────────────────────────────────────────────
const deleteSection = async (sectionId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const section = await Section.findOne({
      where: { sectionId, instituteId, isDeleted: false },
      include: [{ model: Class, as: "class", attributes: ["className"] }],
    });
    if (!section) return fail(404, "Section not found.");

    const label = `${(section as any).class?.className ?? ""}-${section.sectionName}`.replace(/^-/, "");
    const [students, exams] = await Promise.all([
      StudentProfile.count({ where: { instituteId, sectionId } }),
      Exam.count({ where: { instituteId, sectionId, isDeleted: false } }),
    ]);
    if (students || exams) {
      const used = [
        students && `${students} ${students === 1 ? "student" : "students"}`,
        exams && `${exams} ${exams === 1 ? "exam" : "exams"}`,
      ]
        .filter(Boolean)
        .join(" and ");
      return fail(httpStatus.CONFLICT, `Section ${label} can't be deleted because it has ${used}.`);
    }

    // A deleted section has no class teacher; theirs goes back to being a subject teacher.
    const freedTeacherId = section.classTeacherId;
    await section.update({ isDeleted: true, isActive: false, classTeacherId: null });
    await syncTeacherType(freedTeacherId, instituteId);
    return { error: false, statusCode: 200, message: `Section ${label} deleted.`, data: {} };
  } catch (e: any) {
    return fail(500, e.message);
  }
};

export default {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection,
};
