import Subject from "../../models/Subject.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import UserModal from "../../models/User.model";
import { specialisesIn } from "../../utils/specialization";
import { findSession, subjectTeacherIn } from "../academic/sessionSetup.service";

export interface TeacherSubjectCheck {
  ok: boolean;
  message?: string;
}

/**
 * Can this teacher set papers for (or teach) this subject? Yes when they are its subject
 * teacher in the session (the current one when no session is given), or when they
 * specialise in it.
 */
export const checkTeacherForSubject = async (
  instituteId: string,
  teacherId: string,
  subjectId: string,
  sessionId?: string
): Promise<TeacherSubjectCheck> => {
  const [subject, profile, user, session] = await Promise.all([
    Subject.findOne({ where: { subjectId, instituteId, isDeleted: false } }),
    TeacherProfile.findOne({ where: { userId: teacherId, instituteId } }),
    UserModal.findOne({ where: { userId: teacherId, instituteId }, attributes: ["userName"] }),
    findSession(instituteId, sessionId),
  ]);
  if (!subject) return { ok: false, message: "Subject not found in your institute." };
  if (session && (await subjectTeacherIn(session.sessionId, subjectId)) === teacherId) return { ok: true };
  if (specialisesIn(profile?.specialization, subject.subjectName)) return { ok: true };
  return {
    ok: false,
    message: `${user?.userName ?? "This teacher"} does not specialise in ${subject.subjectName}. Add ${subject.subjectName} to their specialisations in Teacher Assignments first.`,
  };
};
