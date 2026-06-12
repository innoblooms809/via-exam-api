import sys

filepath = 'src/services/exam.service.ts'
with open(filepath, 'r') as f:
    content = f.read()

import_new = """import Session from "../modals/Session.modal";
import Notification from "../modals/Notification.modal";
import StudentProfile from "../modals/Student.modal";
import Scanner from "../modals/Scanner.modal";"""

content = content.replace('import Session from "../modals/Session.modal";\nimport Notification from "../modals/Notification.modal";', import_new)

progress_func = """
// ─── GET EXAM PROGRESS ────────────────────────────────────────────────────────
const getExamProgress = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;

    const exam: any = await Exam.findOne({
      where: { examId, instituteId, isDeleted: false },
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"], required: true },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
        { model: Session, as: "session", attributes: ["sessionName"] }
      ]
    });

    if (!exam) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Exam not found." };
    }

    const sections: any = await Section.findAll({
      where: { classId: exam.classId, isDeleted: false }
    });

    const progressData = await Promise.all(
      sections.map(async (sec: any) => {
        const totalStudents = await StudentProfile.count({
          where: { instituteId, classId: exam.classId, sectionId: sec.sectionId, isActive: true }
        });

        // Some sheets might be tracked by sectionName instead of ID, we check sectionId or sectionName.
        const uploadedSheets = await Scanner.count({
          where: { 
            instituteId, 
            classId: exam.classId, 
            section: { [Op.in]: [sec.sectionId, sec.sectionName] }, 
            subjectId: exam.subjectId, 
            examType: exam.examType,
            isDeleted: false 
          }
        });

        return {
          sectionId: sec.sectionId,
          sectionName: sec.sectionName,
          totalStudents,
          uploadedSheets
        };
      })
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Progress fetched successfully.",
      data: { progress: progressData }
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};
"""

content = content.replace("export default {", progress_func + "\nexport default {\n  getExamProgress,")

with open(filepath, 'w') as f:
    f.write(content)
