import sys

filepath = 'src/controllers/exam/exam.controller.ts'
with open(filepath, 'r') as f:
    content = f.read()

func = """
const getExamProgress = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Exam.getExamProgress(req.params.examId, req.viaExamUser);
    return res.status(result.statusCode).json(result);
  } catch (e: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: `Something went wrong: ${e.message}`,
    });
  }
};
"""

content = content.replace("export default {", func + "\nexport default {\n  getExamProgress,")

with open(filepath, 'w') as f:
    f.write(content)
