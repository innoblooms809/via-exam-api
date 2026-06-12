import sys

filepath = 'src/services/exam.service.ts'
with open(filepath, 'r') as f:
    content = f.read()

old_str = """    const formattedExams = exams.map((exam: any) => ({
      id: exam.examId,
      classId: exam.class?.classId || exam.classId,
      className: exam.class?.className || "N/A",
      sectionId: exam.section?.sectionId || exam.sectionId,
      sectionName: exam.section?.sectionName || "N/A",
      subjectId: exam.subject?.subjectId || exam.subjectId,
      subjectName: exam.subject?.subjectName || "N/A",
      sessionId: exam.session?.sessionId || exam.sessionId,
      sessionName: exam.session?.sessionName || "N/A",
      examType: exam.examType,
      status: exam.status,
    }));"""

new_str = """    const formattedExams = await Promise.all(exams.map(async (exam: any) => {
      const totalStudents = await StudentProfile.count({
          where: { instituteId, classId: exam.classId, isActive: true }
      });
      const uploadedSheets = await Scanner.count({
          where: { 
            instituteId, 
            classId: exam.classId, 
            subjectId: exam.subjectId, 
            examType: exam.examType,
            isDeleted: false 
          }
      });
      return {
        id: exam.examId,
        classId: exam.class?.classId || exam.classId,
        className: exam.class?.className || "N/A",
        sectionId: exam.section?.sectionId || exam.sectionId,
        sectionName: exam.section?.sectionName || "N/A",
        subjectId: exam.subject?.subjectId || exam.subjectId,
        subjectName: exam.subject?.subjectName || "N/A",
        sessionId: exam.session?.sessionId || exam.sessionId,
        sessionName: exam.session?.sessionName || "N/A",
        examType: exam.examType,
        status: exam.status,
        totalStudents,
        uploadedSheets
      };
    }));"""

content = content.replace(old_str, new_str)

with open(filepath, 'w') as f:
    f.write(content)
