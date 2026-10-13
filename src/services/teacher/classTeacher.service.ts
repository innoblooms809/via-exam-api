// Teacher types and class-teacher posts.
//
//   Subject Teacher — teaches the subjects they are given.
//   Class Teacher   — teaches subjects too, and looks after exactly one section.
//   Head Teacher    — heads the school; not a class teacher.
//
// A section's class teacher is stored on the section (Section.classTeacherId) and can
// be set from the teacher form or from Master Data → Sections. These helpers keep the
// two in step: a teacher holds at most one section, and their type follows the post.

import { Op, Transaction } from "sequelize";
import Section from "../../models/Section.model";
import Class from "../../models/Class.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import UserModal from "../../models/User.model";

export const TEACHER_TYPES = ["Subject Teacher", "Class Teacher", "Head Teacher"] as const;
export type TeacherType = (typeof TEACHER_TYPES)[number];

export const isTeacherType = (v: unknown): v is TeacherType => TEACHER_TYPES.includes(v as TeacherType);

const label = (s: any) => `${s.class?.className ?? ""}-${s.sectionName}`.replace(/^-/, "");

export const isHeadTeacher = async (teacherId: string, instituteId: string) =>
  (await TeacherProfile.findOne({ where: { userId: teacherId, instituteId }, attributes: ["teacherType"] }))?.teacherType === "Head Teacher";

/** The section a teacher is class teacher of (other than `exceptSectionId`), if any. */
export const classTeacherPostOf = (teacherId: string, instituteId: string, exceptSectionId?: string, transaction?: Transaction) =>
  Section.findOne({
    where: {
      instituteId,
      classTeacherId: teacherId,
      isDeleted: false,
      ...(exceptSectionId ? { sectionId: { [Op.ne]: exceptSectionId } } : {}),
    },
    include: [{ model: Class, as: "class", attributes: ["className"] }],
    transaction,
  });

/**
 * Can `teacherId` become class teacher of `sectionId`? Returns the section, or the
 * sentence to show. Checks the section exists, is free (or already theirs), that the
 * teacher holds no other section, and that they aren't the head teacher.
 */
export const checkClassTeacherPost = async (
  teacherId: string | null,
  sectionId: string,
  instituteId: string,
  /** replace: the section's current class teacher may be swapped out (the section's own form). */
  opts: { teacherType?: string | null; replace?: boolean } = {}
): Promise<{ section: Section } | { message: string; status: number }> => {
  const section = await Section.findOne({
    where: { sectionId, instituteId, isDeleted: false },
    include: [{ model: Class, as: "class", attributes: ["className"] }],
  });
  if (!section) return { message: "That section was not found. Refresh and choose again.", status: 404 };

  if (section.classTeacherId && section.classTeacherId !== teacherId && !opts.replace) {
    const holder = await UserModal.findOne({ where: { userId: section.classTeacherId }, attributes: ["userName"] });
    return {
      status: 409,
      message: `${label(section)} already has a class teacher: ${holder?.userName ?? "another teacher"}. Choose another section, or change it in Master Data → Sections.`,
    };
  }
  if (!teacherId) return { section };

  const type = opts.teacherType ?? (await TeacherProfile.findOne({ where: { userId: teacherId, instituteId }, attributes: ["teacherType"] }))?.teacherType;
  if (type === "Head Teacher") {
    return { status: 400, message: "The head teacher isn't a class teacher. Change their type to Class Teacher first, or choose another teacher." };
  }
  const other = await classTeacherPostOf(teacherId, instituteId, sectionId);
  if (other) {
    const name = (await UserModal.findOne({ where: { userId: teacherId }, attributes: ["userName"] }))?.userName ?? "This teacher";
    return { status: 409, message: `${name} is already class teacher of ${label(other)}. A teacher looks after one section; free ${label(other)} first.` };
  }
  return { section };
};

/**
 * After a post changes: a Subject Teacher who now holds a section becomes a Class
 * Teacher, and a Class Teacher with no section left becomes a Subject Teacher.
 * The head teacher's type never changes here.
 */
export const syncTeacherType = async (teacherId: string | null | undefined, instituteId: string, transaction?: Transaction) => {
  if (!teacherId) return;
  const profile = await TeacherProfile.findOne({ where: { userId: teacherId, instituteId }, transaction });
  if (!profile || profile.teacherType === "Head Teacher") return;
  const holds = await Section.count({ where: { instituteId, classTeacherId: teacherId, isDeleted: false }, transaction });
  const next = holds ? "Class Teacher" : "Subject Teacher";
  if (profile.teacherType !== next) await profile.update({ teacherType: next }, { transaction });
};
