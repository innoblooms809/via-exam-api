import "../config/config";
import { sequelize } from "../config/sequelize";
import "../modals";
import Exam from "../modals/Exam.modal";
import Session from "../modals/Session.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import AcademicCalendar from "../modals/AcademicCalendar.modal";
import { getExamSchedule } from "../services/examSchedule.service";
(async () => {
  const id = "IB228226";
  const exams = await Exam.findAll({ where: { instituteId: id, isDeleted: false } });
  const sessions = await Session.findAll({ where: { instituteId: id } });
  const sm = new Map(sessions.map((s) => [s.sessionId, s]));
  for (const e of exams) {
    const sets = await QuestionPaper.findAll({ where: { examId: e.examId }, attributes: ["paperSet", "status"] });
    const s = sm.get(e.sessionId);
    console.log("EXAM", e.examId, e.examType, e.classId, e.subjectId, e.status, "|", s?.sessionName, s?.isActive, s?.endDate, s?.isDeleted, "|", sets.map((x) => x.paperSet + ":" + x.status).join(","));
  }
  const evs = await AcademicCalendar.findAll({ where: { instituteId: id, isDeleted: false } });
  for (const v of evs) console.log("EVENT", v.eventType, v.eventDate, v.sessionId, v.classId, v.className, v.subjectId, v.subjectName);
  const r: any = await getExamSchedule({ instituteId: id, role: { role: "TEACHER" } });
  for (const s of r.data?.sheets ?? []) console.log(" SHEET", s.className, s.examType, s.sessionName, s.sessionId, s.papers.map((p: any) => `${p.subjectName}@${p.date}/${p.approval}/${(p.approvedSets||[]).join("")}`).join(", "));
  console.log(r.data?.sessions);
  await sequelize.close();
})();
