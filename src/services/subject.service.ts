import httpStatus from "http-status";
import { Op } from "sequelize";
import Subject from "../modals/Subject.modal";
import RegHelper from "../utils/helper";
import Class from "../modals/Class.modal";
import User from "../modals/User.modal";
import Exam from "../modals/Exam.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import { sequelize } from "../config/sequelize";
import { specialisesIn } from "../utils/specialization";
import { compareClassNames } from "./class.service";
import {
  MAX_BULK_ITEMS,
  MAX_NAME_LENGTH,
  nameKey,
  normalizeSubjectCode,
  normalizeSubjectName,
} from "../utils/academicNames";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

const isBlankId = (value: unknown) => value === undefined || value === null || value === "" || value === "null";

/** Validates marks; returns cleaned numbers or an error message. */
const checkMarks = (total: unknown, passing: unknown, label = "") => {
  const totalMarks = total === undefined || total === null || total === "" ? 100 : Number(total);
  if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) {
    return { message: `${label}Total marks must be a whole number from 1 to 1000.` };
  }
  const passingMarks =
    passing === undefined || passing === null || passing === "" ? Math.ceil(totalMarks * 0.35) : Number(passing);
  if (!Number.isInteger(passingMarks) || passingMarks < 0) {
    return { message: `${label}Passing marks must be a whole number.` };
  }
  if (passingMarks > totalMarks) return { message: `${label}Passing marks can't be more than total marks.` };
  return { totalMarks, passingMarks };
};

// ─── CREATE SUBJECT(S) ──────────────────────────────────────────
// Accepts { classId | classIds[] } with either
//   subjects: [{ subjectName, totalMarks?, passingMarks? }]   (many at once)
// or the single fields { subjectName, subjectCode?, teacherId?, totalMarks?, passingMarks? }.
const createSubject = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const classIds: string[] = Array.from(
    new Set((Array.isArray(body.classIds) ? body.classIds : [body.classId]).filter(Boolean).map(String)),
  );
  if (classIds.length === 0) return fail(httpStatus.BAD_REQUEST, "Choose at least one class.");
  if (classIds.length > MAX_BULK_ITEMS) return fail(httpStatus.BAD_REQUEST, `You can choose up to ${MAX_BULK_ITEMS} classes at a time.`);

  const single = !Array.isArray(body.subjects);
  const input: any[] = single ? [body] : body.subjects;

  // Clean and de-duplicate the requested subjects.
  const subjects: { subjectName: string; totalMarks: number; passingMarks: number }[] = [];
  const seen = new Set<string>();
  for (const [i, item] of input.entries()) {
    const subjectName = normalizeSubjectName(item?.subjectName);
    if (!subjectName) continue;
    const label = single ? "" : `${subjectName}: `;
    if (subjectName.length > MAX_NAME_LENGTH) {
      return fail(httpStatus.BAD_REQUEST, `Subject ${i + 1} is too long (max ${MAX_NAME_LENGTH} characters).`);
    }
    const marks = checkMarks(item?.totalMarks, item?.passingMarks, label);
    if (!("totalMarks" in marks)) return fail(httpStatus.BAD_REQUEST, marks.message!);
    if (seen.has(nameKey(subjectName))) continue;
    seen.add(nameKey(subjectName));
    subjects.push({ subjectName, totalMarks: marks.totalMarks!, passingMarks: marks.passingMarks! });
  }
  if (subjects.length === 0) return fail(httpStatus.BAD_REQUEST, "Enter at least one subject.");
  if (subjects.length > MAX_BULK_ITEMS) return fail(httpStatus.BAD_REQUEST, `You can add up to ${MAX_BULK_ITEMS} subjects at a time.`);

  // Code and teacher only make sense for one subject in one class.
  const subjectCode = single && classIds.length === 1 ? normalizeSubjectCode(body.subjectCode) : null;
  const teacherId = single && classIds.length === 1 && !isBlankId(body.teacherId) ? String(body.teacherId) : null;
  if (teacherId && !(await User.findOne({ where: { userId: teacherId, instituteId, isDeleted: false } }))) {
    return fail(httpStatus.NOT_FOUND, "Teacher not found.");
  }
  if (subjectCode && (await Subject.findOne({ where: { subjectCode } }))) {
    return fail(httpStatus.CONFLICT, `Subject code ${subjectCode} is already in use.`);
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
      const current = await Subject.findAll({ where: { classId: cls.classId }, transaction: t });
      const byKey = new Map(current.map((s) => [nameKey(s.subjectName), s]));

      for (const subject of subjects) {
        const found = byKey.get(nameKey(subject.subjectName));
        if (found && !found.isDeleted) {
          skipped.push(classes.length > 1 ? `${found.subjectName} (${cls.className})` : found.subjectName);
          continue;
        }
        if (found) {
          await found.update(
            {
              isDeleted: false,
              isActive: true,
              subjectName: subject.subjectName,
              totalMarks: subject.totalMarks,
              passingMarks: subject.passingMarks,
              ...(subjectCode ? { subjectCode } : {}),
              ...(teacherId ? { teacherId } : {}),
            },
            { transaction: t },
          );
        } else {
          await Subject.create(
            {
              subjectId: await RegHelper.generateUserId(),
              instituteId,
              classId: cls.classId,
              subjectName: subject.subjectName,
              subjectCode,
              teacherId,
              totalMarks: subject.totalMarks,
              passingMarks: subject.passingMarks,
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
        skipped.length === 1 ? `${skipped[0]} already exists in this class.` : `Already added: ${skipped.join(", ")}.`,
      );
    }
    await t.commit();

    const parts = [`${added} ${added === 1 ? "subject" : "subjects"} added`];
    if (skipped.length) parts.push(`${skipped.length} already existed`);
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

// ─── GET ALL SUBJECTS ──────────────────────────────────────────
const getAllSubjects = async (query: any, createdBy: any): Promise<any> => {
  try {
    const where: any = { instituteId: createdBy.instituteId, isDeleted: false, isActive: true };
    if (query.classId) where.classId = query.classId;

    const subjects = await Subject.findAll({
      where,
      include: [
        { model: Class, as: "class", where: { isDeleted: false }, required: true },
        { model: User, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });

    const sorted = subjects.sort(
      (a: any, b: any) =>
        compareClassNames(a.class?.className ?? "", b.class?.className ?? "") ||
        a.subjectName.localeCompare(b.subjectName),
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subjects fetched successfully.",
      data: { subjects: sorted, total: sorted.length },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

// ─── GET SUBJECT BY ID ─────────────────────────────────────────
const getSubjectById = async (subjectId: string, createdBy: any): Promise<any> => {
  try {
    const subject = await Subject.findOne({
      where: { subjectId, instituteId: createdBy.instituteId, isDeleted: false },
      include: [
        { model: Class, as: "class", where: { isDeleted: false }, required: true },
        { model: User, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });
    if (!subject) return fail(httpStatus.NOT_FOUND, "Subject not found.");

    return { error: false, statusCode: httpStatus.OK, message: "Subject fetched successfully.", data: subject };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

// ─── UPDATE SUBJECT ────────────────────────────────────────────
const updateSubject = async (subjectId: string, body: any, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const subject = await Subject.findOne({ where: { subjectId, instituteId, isDeleted: false } });
    if (!subject) return fail(httpStatus.NOT_FOUND, "Subject not found.");

    const subjectName = body.subjectName !== undefined ? normalizeSubjectName(body.subjectName) : subject.subjectName;
    if (!subjectName) return fail(httpStatus.BAD_REQUEST, "Subject name can't be empty.");
    if (subjectName.length > MAX_NAME_LENGTH) {
      return fail(httpStatus.BAD_REQUEST, `Subject name can be at most ${MAX_NAME_LENGTH} characters.`);
    }

    if (subjectName !== subject.subjectName) {
      const siblings = await Subject.findAll({ where: { classId: subject.classId, subjectId: { [Op.ne]: subjectId } } });
      const clash = siblings.find((s) => nameKey(s.subjectName) === nameKey(subjectName));
      if (clash) {
        return fail(
          httpStatus.CONFLICT,
          clash.isDeleted
            ? `A deleted subject ${clash.subjectName} exists in this class. Add it again to restore it.`
            : `${clash.subjectName} already exists in this class.`,
        );
      }
    }

    const subjectCode = body.subjectCode !== undefined ? normalizeSubjectCode(body.subjectCode) : subject.subjectCode;
    if (subjectCode && subjectCode !== subject.subjectCode) {
      const taken = await Subject.findOne({ where: { subjectCode, subjectId: { [Op.ne]: subjectId } } });
      if (taken) return fail(httpStatus.CONFLICT, `Subject code ${subjectCode} is already in use.`);
    }

    const marks = checkMarks(body.totalMarks ?? subject.totalMarks, body.passingMarks ?? subject.passingMarks);
    if (!("totalMarks" in marks)) return fail(httpStatus.BAD_REQUEST, marks.message!);

    let teacherId = subject.teacherId;
    if (body.teacherId !== undefined) {
      teacherId = isBlankId(body.teacherId) ? null : String(body.teacherId);
      if (teacherId && !(await User.findOne({ where: { userId: teacherId, instituteId, isDeleted: false } }))) {
        return fail(httpStatus.NOT_FOUND, "Teacher not found.");
      }
    }

    // A (new) teacher for this subject must specialise in it.
    if (teacherId && teacherId !== subject.teacherId) {
      const profile = await TeacherProfile.findOne({ where: { userId: teacherId, instituteId } });
      if (!specialisesIn(profile?.specialization, subjectName)) {
        return fail(
          httpStatus.BAD_REQUEST,
          `This teacher does not specialise in ${subjectName}. Add ${subjectName} to their specialisations first.`,
        );
      }
    }

    await subject.update({
      subjectName,
      subjectCode,
      teacherId,
      totalMarks: marks.totalMarks,
      passingMarks: marks.passingMarks,
    });

    return { error: false, statusCode: httpStatus.OK, message: `${subjectName} updated.`, data: subject };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

// ─── DELETE SUBJECT (SOFT DELETE) ─────────────────────────────
const deleteSubject = async (subjectId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const subject = await Subject.findOne({ where: { subjectId, instituteId, isDeleted: false } });
    if (!subject) return fail(httpStatus.NOT_FOUND, "Subject not found.");

    const exams = await Exam.count({ where: { instituteId, subjectId, isDeleted: false } });
    if (exams) {
      return fail(
        httpStatus.CONFLICT,
        `${subject.subjectName} can't be deleted because it has ${exams} ${exams === 1 ? "exam" : "exams"}.`,
      );
    }

    await subject.update({ isDeleted: true, isActive: false });
    return { error: false, statusCode: httpStatus.OK, message: `${subject.subjectName} deleted.`, data: {} };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message);
  }
};

export default {
  createSubject,
  getAllSubjects,
  getSubjectById,
  updateSubject,
  deleteSubject,
};
