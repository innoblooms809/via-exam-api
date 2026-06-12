import sys

filepath = 'src/services/exam.service.ts'
with open(filepath, 'r') as f:
    content = f.read()

# Replace the mapped formattedExams
old_str = """    const formattedExams = exams.map((exam: any) => ({
      id: exam.examId,
      className: exam.class?.className || "N/A",
      sectionName: exam.section?.sectionName || "N/A",
      subjectName: exam.subject?.subjectName || "N/A",
      sessionName: exam.session?.sessionName || "N/A",
      examType: exam.examType,
      status: exam.status,
    }));"""

new_str = """    const formattedExams = exams.map((exam: any) => ({
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

content = content.replace(old_str, new_str)
with open(filepath, 'w') as f:
    f.write(content)

