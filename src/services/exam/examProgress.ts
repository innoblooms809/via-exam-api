/**
 * "100% evaluated": when the last answer sheet of an exam gets its marks, the evaluator is
 * asked to check them and mark the exam reviewed, and the school's admins are told.
 *
 * Every way a sheet gets marks (the AI and OCR pipelines, an evaluator's correction) saves
 * through the AIEvaluation model, so one hook on it sees each sheet as it is marked. The
 * check runs after that save commits and tells people once per round of sheets: again
 * only if more sheets arrive later (uploading was re-opened) and those get marks too.
 * Uploading finishing after the marking (completeScan) runs the same check.
 */

import { Op } from "sequelize";
import logger from "../../config/logger";
import AIEvaluation from "../../models/AIEvaluation.model";
import Exam from "../../models/Exam.model";
import Scanner from "../../models/Scanner.model";
import Notification from "../../models/Notification.model";
import UserModal from "../../models/User.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import ExamScannerAssignment, { SCAN_STATUS } from "../../models/ExamScannerAssignment.model";
import StudentResult from "../../models/StudentResult.model";
import { EXAM_INCLUDES, buildRoster } from "./examRoster.service";
import { examLabel, instituteAdminIds, notifyAll } from "../notification/notifyPeople";

export const EVALUATION_DONE = "EVALUATION_DONE";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Tells the evaluator and the admins when every uploaded sheet of the exam has its marks. */
export const checkExamEvaluated = async (examId: string) => {
  const exam: any = await Exam.findOne({ where: { examId, isDeleted: false }, include: EXAM_INCLUDES });
  if (!exam) return;
  const [roster, scanner, evaluator, published] = await Promise.all([
    buildRoster(exam),
    ExamScannerAssignment.findOne({ where: { examId, isActive: true } }),
    EvaluationAssignment.findOne({ where: { examId, isActive: true } }),
    StudentResult.count({ where: { examId, isDeleted: false } }),
  ]);
  const { counts } = roster;
  // Uploading must be finished: by the assigned scanner, or (no scanner) every student has a sheet or an absent mark.
  const uploaded = scanner ? scanner.status === SCAN_STATUS.COMPLETED : counts.total > 0 && counts.pending === 0;
  if (published || !uploaded || !counts.uploaded || counts.evaluated < counts.uploaded) return;

  // Once per round: not again unless sheets arrived after the last time.
  const newest = (await Scanner.max("createdAt", { where: { examId, isDeleted: false } })) as Date | null;
  const told = await Notification.findOne({
    where: { type: EVALUATION_DONE, referenceId: examId, ...(newest ? { createdAt: { [Op.gte]: newest } } : {}) },
    attributes: ["id"],
  });
  if (told) return;

  const label = examLabel(exam);
  const sheets = plural(counts.uploaded, "answer sheet");
  const evaluatorName = evaluator ? (await UserModal.findOne({ where: { userId: evaluator.teacherId }, attributes: ["userName"] }))?.userName : null;
  const next = !evaluator
    ? " Assign an evaluator to review them."
    : evaluator.reviewedAt
      ? ""
      : ` ${evaluatorName ?? "The evaluator"} reviews them next.`;
  await notifyAll([
    ...(evaluator && !evaluator.reviewedAt
      ? [
          {
            instituteId: exam.instituteId,
            userId: evaluator.teacherId,
            type: EVALUATION_DONE,
            title: "Every sheet has its marks",
            message: `All ${sheets} of ${label} are evaluated. Check the marks, then mark the exam reviewed.`,
            referenceId: examId,
          },
        ]
      : []),
    ...(await instituteAdminIds(exam.instituteId)).map((userId) => ({
      instituteId: exam.instituteId,
      userId,
      type: EVALUATION_DONE,
      title: "Evaluation complete",
      message: `All ${sheets} of ${label} are evaluated.${next}`,
      referenceId: examId,
    })),
  ]);
};

const sheetEvaluated = async (sheetId: string) => {
  const sheet = await Scanner.findOne({ where: { sheetId }, attributes: ["examId"] });
  if (sheet?.examId) await checkExamEvaluated(sheet.examId);
};

let watching = false;

/** Called once at startup (db/connect). */
export const watchEvaluationProgress = () => {
  if (watching) return;
  watching = true;
  AIEvaluation.afterSave((evaluation: any, options: any) => {
    // A sheet that just got its marks (not a correction of marks it already had).
    if (evaluation.status !== "Success" || evaluation.previous("status") === "Success") return;
    const run = () => {
      sheetEvaluated(evaluation.sheetId).catch((e) => logger.warn(`Evaluation progress check failed for sheet ${evaluation.sheetId}: ${e?.message ?? e}`));
    };
    if (options?.transaction) options.transaction.afterCommit(run);
    else setImmediate(run);
  });
};
