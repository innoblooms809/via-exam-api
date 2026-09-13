// Who may teach / set the exam for a subject: a teacher whose specialisations include the
// subject, or the teacher it is already assigned to (assignments made before specialisations
// existed keep working).

import Subject from "../modals/Subject.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import UserModal from "../modals/User.modal";
import { specialisesIn } from "../utils/specialization";

export interface TeacherSubjectCheck {
  ok: boolean;
  message?: string;
}

export const checkTeacherForSubject = async (
  instituteId: string,
  teacherId: string,
  subjectId: string
): Promise<TeacherSubjectCheck> => {
  const [subject, profile, user] = await Promise.all([
    Subject.findOne({ where: { subjectId, instituteId, isDeleted: false } }),
    TeacherProfile.findOne({ where: { userId: teacherId, instituteId } }),
    UserModal.findOne({ where: { userId: teacherId, instituteId }, attributes: ["userName"] }),
  ]);
  if (!subject) return { ok: false, message: "Subject not found in your institute." };
  if (subject.teacherId === teacherId) return { ok: true };
  if (specialisesIn(profile?.specialization, subject.subjectName)) return { ok: true };
  return {
    ok: false,
    message: `${user?.userName ?? "This teacher"} does not specialise in ${subject.subjectName}. Add ${subject.subjectName} to their specialisations in Teacher Assignments first.`,
  };
};
