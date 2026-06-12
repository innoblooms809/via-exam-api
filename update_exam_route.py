import sys

filepath = 'src/routes/v1/exam.route.ts'
with open(filepath, 'r') as f:
    content = f.read()

route = """
router.get(
  "/progress/:examId",
  authenticate,
  Controller.getExamProgress,
);
"""

content = content.replace("export default router;", route + "\nexport default router;")

with open(filepath, 'w') as f:
    f.write(content)
