import httpStatus from "http-status";
import { Op } from "sequelize";
import Subject from "../../models/Subject.model";
import Class from "../../models/Class.model";
import User from "../../models/User.model";
import Exam from "../../models/Exam.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import { sequelize } from "../../config/sequelize";
import { specialisesIn } from "../../utils/specialization";
import { compareClassNames } from "./class.service";
import {
  MAX_BULK_ITEMS,
  MAX_NAME_LENGTH,
  nameKey,
  normalizeSectionName,
  normalizeSubjectCode,
  normalizeSubjectName,
} from "../../utils/academicNames";

import Section from "../../models/Section.model";
import { newId } from "../../utils/idGenerator";
import { examCountsBy, examsUsing } from "./academicGuards.service";
import { addToCurrentSession, forgetMasterRows, syncCurrentMirrors } from "./sessionSetup.service";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

const isBlankId = (value: unknown) => value === undefined || value === null || value === "" || value === "null";

// ─── CREATE SUBJECT(S) ──────────────────────────────────────────
// Accepts { classId | classIds[] } with either
//   subjects: [{ subjectName, sectionId? }]   (many at once)
// or the single fields { subjectName, subjectCode?, teacherId?, sectionId? }.
// A subject's marks aren't set here: they are per session and exam, on Marks & grading.
const createSubject = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const classIds: string[] = Array.from(
    new Set((Array.isArray(body.classIds) ? body.classIds : [body.classId]).filter(Boolean).map(String)),
  );
  if (classIds.length === 0) return fail(httpStatus.BAD_REQUEST, "Choose at least one class.");
  if (classIds.length > MAX_BULK_ITEMS) return fail(httpStatus.BAD_REQUEST, `You can choose up to ${MAX_BULK_ITEMS} classes at a time.`);

  const single = !Array.isArray(body.subjects);
  const input: any[] = single ? [body] : body.subjects;

  const sectionIdDefault = isBlankId(body.sectionId) ? null : String(body.sectionId);
  const sectionNameDefault = body.sectionName ? normalizeSectionName(body.sectionName) : null;

  // Clean and de-duplicate the requested subjects.
  const subjects: { subjectName: string; sectionId: string | null; sectionName: string | null }[] = [];
  const seen = new Set<string>();
  for (const [i, item] of input.entries()) {
    const subjectName = normalizeSubjectName(item?.subjectName);
    if (!subjectName) continue;
    const itemSecId = isBlankId(item?.sectionId) ? sectionIdDefault : String(item.sectionId);
    const itemSecName = item?.sectionName ? normalizeSectionName(item.sectionName) : sectionNameDefault;
    if (subjectName.length > MAX_NAME_LENGTH) {
      return fail(httpStatus.BAD_REQUEST, `Subject ${i + 1} is too long (max ${MAX_NAME_LENGTH} characters).`);
    }
    const key = `${itemSecId || itemSecName || ""}_${nameKey(subjectName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push({ subjectName, sectionId: itemSecId, sectionName: itemSecName });
  }
  if (subjects.length === 0) return fail(httpStatus.BAD_REQUEST, "Enter at least one subject.");
  if (subjects.length > MAX_BULK_ITEMS) return fail(httpStatus.BAD_REQUEST, `You can add up to ${MAX_BULK_ITEMS} subjects at a time.`);

  // Code and teacher only make sense for one subject in one class.
  const subjectCode = single && classIds.length === 1 ? normalizeSubjectCode(body.subjectCode) : null;
  const teacherId = single && classIds.length === 1 && !isBlankId(body.teacherId) ? String(body.teacherId) : null;
  if (teacherId && !(await User.findOne({ where: { userId: teacherId, instituteId, isDeleted: false, status: 1 } }))) {
    return fail(httpStatus.NOT_FOUND, "That teacher was not found or is deactivated.");
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
    // New subjects (and sections made for them) are taught from the current session on.
    const forSession: { sections: { classId: string; sectionId: string }[]; subjects: { classId: string; subjectId: string; teacherId?: string | null }[] } = { sections: [], subjects: [] };

    for (const cls of classes.sort((a, b) => compareClassNames(a.className, b.className))) {
      const current = await Subject.findAll({ where: { classId: cls.classId }, transaction: t });
      const currentSections = await Section.findAll({ where: { classId: cls.classId }, transaction: t });

      for (const subject of subjects) {
        let targetSectionId: string | null = null;
        const secSearch = subject.sectionId || subject.sectionName;

        if (secSearch) {
          const secById = currentSections.find((s) => s.sectionId === secSearch);
          if (secById) {
            if (secById.isDeleted) {
              await secById.update({ isDeleted: false, isActive: true }, { transaction: t });
            }
            targetSectionId = secById.sectionId;
          } else {
            const secByName = currentSections.find((s) => nameKey(s.sectionName) === nameKey(secSearch));
            if (secByName) {
              if (secByName.isDeleted) {
                await secByName.update({ isDeleted: false, isActive: true }, { transaction: t });
              }
              targetSectionId = secByName.sectionId;
            } else {
              const newSec = await Section.create(
                {
                  sectionId: newId("section"),
                  classId: cls.classId,
                  instituteId,
                  sectionName: normalizeSectionName(secSearch),
                },
                { transaction: t },
              );
              targetSectionId = newSec.sectionId;
              currentSections.push(newSec);
              forSession.sections.push({ classId: cls.classId, sectionId: newSec.sectionId });
            }
          }
        }

        const found = current.find(
          (s) => (s.sectionId ?? null) === targetSectionId && nameKey(s.subjectName) === nameKey(subject.subjectName),
        );
        if (found && !found.isDeleted) {
          skipped.push(classes.length > 1 ? `${found.subjectName} (${cls.className})` : found.subjectName);
          continue;
        }
        if (found) {
          await found.update(
            {
              isDeleted: false,
              isActive: true,
              sectionId: targetSectionId,
              subjectName: subject.subjectName,
              ...(subjectCode ? { subjectCode } : {}),
            },
            { transaction: t },
          );
          forSession.subjects.push({ classId: cls.classId, subjectId: found.subjectId, ...(teacherId ? { teacherId } : {}) });
          if (targetSectionId) forSession.sections.push({ classId: cls.classId, sectionId: targetSectionId });
        } else {
          const subjectId = newId("subject");
          forSession.subjects.push({ classId: cls.classId, subjectId, ...(teacherId ? { teacherId } : {}) });
          if (targetSectionId) forSession.sections.push({ classId: cls.classId, sectionId: targetSectionId });
          await Subject.create(
            {
              subjectId,
              instituteId,
              classId: cls.classId,
              sectionId: targetSectionId,
              subjectName: subject.subjectName,
              subjectCode,
              teacherId,
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
    await addToCurrentSession(instituteId, forSession, t);
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
    console.error("Error creating subject:", e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, e.message || "Failed to create subject.");
  }
};

// ─── GET ALL SUBJECTS ──────────────────────────────────────────
const getAllSubjects = async (query: any, createdBy: any): Promise<any> => {
  try {
    const where: any = { instituteId: createdBy.instituteId, isDeleted: false, isActive: true };
    if (query.classId) where.classId = query.classId;
    if (query.sectionId) where.sectionId = query.sectionId;

    const subjects = await Subject.findAll({
      where,
      include: [
        { model: Class, as: "class", where: { isDeleted: false }, required: true },
        { model: Section, as: "section", where: { isDeleted: false }, required: false },
        { model: User, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
      ],
    });

    const exams = await examCountsBy(createdBy.instituteId, "subjectId");
    subjects.forEach((s: any) => s.setDataValue("examCount", exams.get(s.subjectId) ?? 0));
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
        { model: Section, as: "section", where: { isDeleted: false }, required: false },
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

    let sectionId = subject.sectionId;
    if (body.sectionId !== undefined || body.sectionName !== undefined) {
      const secSearch = isBlankId(body.sectionId) ? (body.sectionName ? String(body.sectionName) : null) : String(body.sectionId);
      if (!secSearch) {
        sectionId = null;
      } else {
        const classSections = await Section.findAll({ where: { classId: subject.classId, isDeleted: false } });
        const secById = classSections.find((s) => s.sectionId === secSearch);
        const secByName = classSections.find((s) => nameKey(s.sectionName) === nameKey(secSearch));
        sectionId = secById?.sectionId ?? secByName?.sectionId ?? null;
      }
    }

    if (subjectName !== subject.subjectName || sectionId !== subject.sectionId) {
      const exams = await examsUsing(instituteId, { subjectId });
      if (exams) {
        return fail(
          httpStatus.CONFLICT,
          `${subject.subjectName} is used by ${exams} ${exams === 1 ? "exam" : "exams"}, so its name and section can't change. ` +
            `Its code can still change.`,
        );
      }
      const siblings = await Subject.findAll({ where: { classId: subject.classId, subjectId: { [Op.ne]: subjectId } } });
      const clash = siblings.find((s) => (s.sectionId ?? null) === sectionId && nameKey(s.subjectName) === nameKey(subjectName));
      if (clash) {
        return fail(
          httpStatus.CONFLICT,
          clash.isDeleted
            ? `A deleted subject ${clash.subjectName} exists in this class. Add it again to restore it.`
            : `${clash.subjectName} already exists in this class section.`,
        );
      }
    }

    const subjectCode = body.subjectCode !== undefined ? normalizeSubjectCode(body.subjectCode) : subject.subjectCode;
    if (subjectCode && subjectCode !== subject.subjectCode) {
      const taken = await Subject.findOne({ where: { subjectCode, subjectId: { [Op.ne]: subjectId } } });
      if (taken) return fail(httpStatus.CONFLICT, `Subject code ${subjectCode} is already in use.`);
    }

    let teacherId = subject.teacherId;
    if (body.teacherId !== undefined) {
      teacherId = isBlankId(body.teacherId) ? null : String(body.teacherId);
      if (teacherId && !(await User.findOne({ where: { userId: teacherId, instituteId, isDeleted: false, status: 1 } }))) {
        return fail(httpStatus.NOT_FOUND, "That teacher was not found or is deactivated.");
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

    await subject.update({ subjectName, sectionId, subjectCode });
    if (body.teacherId !== undefined) {
      await addToCurrentSession(instituteId, { subjects: [{ classId: subject.classId, subjectId, teacherId }] });
      await subject.reload();
    }

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
    await forgetMasterRows({ subjectId });
    await syncCurrentMirrors(instituteId);
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
