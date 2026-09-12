// One-time repair for set statuses corrupted by the old exam-level approval.
//
// Before approvals became per set, approving/submitting ONE set of an exam copied
// that status onto EVERY set of the exam — so sets that were never submitted
// (often without an answer sheet) show as Pending/Approved/Rejected.
//
//   npx ts-node src/scripts/repairSetStatuses.ts                 # dry run: report only
//   npx ts-node src/scripts/repairSetStatuses.ts --apply         # write the fixes
//   npx ts-node src/scripts/repairSetStatuses.ts --apply --reset EXAMID:D --reset EXAMID2:B
//   npx ts-node src/scripts/repairSetStatuses.ts --apply --recompute-all   # also refresh every exam status
//
// Automatically reset to DRAFT: any set whose question paper or answer sheet is
// missing — such a set can never have been submitted.
// Sets that have both parts cannot be told apart from genuinely approved ones;
// list those with --reset EXAMID:SET after checking them.
// Finally every exam status is recomputed from its sets.

import "../config/config";
import { sequelize } from "../config/sequelize";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import Exam from "../modals/Exam.modal";
import { deriveExamStatus, refreshExamStatus } from "../services/exam.service";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const manualResets = new Set(
  args
    .flatMap((arg, i) => (arg === "--reset" && args[i + 1] ? [args[i + 1]] : []))
    .map((v) => {
      const [examId, set] = v.split(":");
      return `${examId}:${String(set ?? "").trim().toUpperCase()}`;
    })
);

const RESET_FIELDS = {
  status: "DRAFT" as const,
  submittedAt: null,
  approvedAt: null,
  rejectedAt: null,
  publishedAt: null,
};

async function main() {
  await sequelize.authenticate();
  console.log(APPLY ? "APPLY mode — changes will be written.\n" : "DRY RUN — nothing is written (add --apply).\n");

  const papers = await QuestionPaper.findAll({ order: [["examId", "ASC"], ["paperSet", "ASC"]] });
  const answers = await QuestionPaperAnswer.findAll();
  const touchedExams = new Set<string>();
  let resetCount = 0;

  const answerFor = (p: QuestionPaper) =>
    answers.find((a) => a.paperId === p.paperId) ??
    answers.find((a) => a.examId === p.examId && a.paperSet === p.paperSet);

  for (const paper of papers) {
    const answer = answerFor(paper);
    const key = `${paper.examId}:${paper.paperSet}`;
    const manual = manualResets.has(key);
    const missingAnswer = !answer;
    const locked = paper.status !== "DRAFT" || (answer && answer.status !== "DRAFT");

    let action = "ok";
    if (locked && (missingAnswer || manual)) {
      action = missingAnswer ? "RESET → DRAFT (no answer sheet, never submitted)" : "RESET → DRAFT (--reset)";
      resetCount++;
      touchedExams.add(paper.examId);
      if (APPLY) {
        await sequelize.transaction(async (transaction) => {
          await paper.update(RESET_FIELDS, { transaction });
          if (answer) await answer.update(RESET_FIELDS, { transaction });
        });
      }
    } else if (answer && answer.status !== paper.status) {
      action = "CHECK — paper and answer sheet statuses differ";
    }

    console.log(
      `${paper.examId}  Set ${paper.paperSet}  paper=${paper.status.padEnd(16)} answer=${(answer?.status ?? "—").padEnd(16)} ${action}`
    );
  }

  // Answer sheets whose set has no question paper.
  const orphans = answers.filter(
    (a) =>
      a.status !== "DRAFT" &&
      !papers.some((p) => p.paperId === a.paperId || (p.examId === a.examId && p.paperSet === a.paperSet))
  );
  for (const answer of orphans) {
    console.log(`${answer.examId}  Set ${answer.paperSet}  paper=—                answer=${answer.status.padEnd(16)} RESET → DRAFT (no question paper)`);
    resetCount++;
    touchedExams.add(answer.examId);
    if (APPLY) await answer.update(RESET_FIELDS);
  }

  // Recompute exam status from its sets (showing what changes) — only for exams whose
  // sets were reset, unless --recompute-all is given.
  const examIds = args.includes("--recompute-all")
    ? new Set<string>([...papers.map((p) => p.examId), ...answers.map((a) => a.examId)])
    : touchedExams;
  const resetKeys = new Set(
    papers
      .filter((p) => {
        const answer = answerFor(p);
        const locked = p.status !== "DRAFT" || (answer && answer.status !== "DRAFT");
        return locked && (!answer || manualResets.has(`${p.examId}:${p.paperSet}`));
      })
      .map((p) => p.paperId)
  );
  console.log("\nExam status changes:");
  let examChanges = 0;
  for (const examId of examIds) {
    const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
    if (!exam) continue;
    const setStatuses = papers
      .filter((p) => p.examId === examId)
      .map((p) => (resetKeys.has(p.paperId) ? "DRAFT" : p.status));
    const next =
      exam.status === "Live" || exam.status === "Completed"
        ? exam.status
        : deriveExamStatus(setStatuses, true);
    if (next !== exam.status) {
      examChanges++;
      console.log(`  ${examId}: ${exam.status} → ${next}`);
    }
    if (APPLY) await refreshExamStatus(examId);
  }
  if (examChanges === 0) console.log("  (none)");

  console.log(
    `\n${resetCount} set(s) ${APPLY ? "reset" : "would be reset"} across ${touchedExams.size} exam(s); ` +
      `${APPLY ? "recomputed" : "would recompute"} the status of ${examIds.size} exam(s).`
  );
  const unmatched = [...manualResets].filter((k) => !papers.some((p) => `${p.examId}:${p.paperSet}` === k));
  if (unmatched.length) console.log(`--reset entries with no matching set: ${unmatched.join(", ")}`);

  await sequelize.close();
}

main().catch(async (err) => {
  console.error("Repair failed:", err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
