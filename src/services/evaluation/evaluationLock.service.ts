/**
 * When a sheet's marks may change: one rule for the routes that run the AI or edit marks, and for
 * the lists and rosters that show the teacher what they can do, so a screen says why before anyone
 * clicks instead of failing after.
 *
 * In order:
 *  1. Results published: never in place. Marks change only through a recheck the admin assigns
 *     (that teacher works in a draft, recheckDraft.service).
 *  2. An open cross-check: the sheets it holds change only through the cross-checker's verdicts
 *     (their own runs and edits go into a draft, crossCheckDraft.service). A round starts only once
 *     every section is marked completed, so the evaluator's other sheets are locked by 3.
 *  3. The evaluator marked the section completed ("reviewed"): reopen it first (Mark as not
 *     completed), so marks never change behind a confirmation the admin publishes from. Reopening
 *     is refused once results are published, and while a cross-check is open (evaluationAssignment).
 *
 * 1 applies to everyone; 2 to everyone but the cross-checker (and an admin, for edits); 3 to the
 * teachers who evaluate (an admin may still correct marks before publishing). The recheck teacher
 * and the cross-checker are let through before these checks (recheckDraft.evaluationRunFor).
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import Scanner from "../../models/Scanner.model";
import StudentResult from "../../models/StudentResult.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import { CROSS_CHECK_ITEM_STATUS, CrossCheckItem, CrossCheckRound } from "../../models/CrossCheck.model";
import ApiError from "../../utils/ApiError";
import { msg, type LocalizedMessage } from "../../i18n/message";

export type EvaluationLockReason = "published" | "crossCheck" | "completed";

export interface EvaluationLock {
  reason: EvaluationLockReason;
  /** Why, in the reader's language (it goes out as a message, i18n/message.ts). */
  message: LocalizedMessage;
}

/** A refused run or edit: a 409 that names the lock, so a screen shows it as locked, never as failed. */
export class EvaluationLockedError extends ApiError {
  constructor(readonly lock: EvaluationLock) {
    super(httpStatus.CONFLICT, lock.message);
  }
}

const lockOf = (reason: EvaluationLockReason, oneSheet = false): EvaluationLock => ({
  reason,
  message:
    reason === "published"
      ? msg("This exam's results are published, so its sheets aren't evaluated again. Marks change only through a recheck the admin assigns.")
      : reason === "crossCheck"
        ? oneSheet
          ? msg("This sheet is being cross-checked. Its marks change only through the cross-checker's verdict until that's done.")
          : msg("This exam is being cross-checked. Marks change only through the cross-checker's verdicts until it's done.")
        : msg("This section's evaluation is marked as completed. To change its marks, ask the admin to reopen it."),
});

/** A section as a key: its id, or "" for students without a section (as examRoster.sectionKey). */
const keyOf = (sectionId: string | null | undefined) => String(sectionId ?? "").trim();

// ─── Exams (lists, rosters) ─────────────────────────────────────────────────────

/** What locks an exam's marks: read once for many exams. */
export interface ExamLockState {
  published: boolean;
  /** A cross-check round is open (sheets still to verify). */
  crossCheck: boolean;
  /** Sheets the open round holds. */
  heldSheets: Set<string>;
  /** Sections whose evaluator marked them completed. */
  completedSections: Set<string>;
  /** Sections that have an evaluator. */
  evaluatedSections: Set<string>;
}

export async function examLockStates(examIds: string[]): Promise<Map<string, ExamLockState>> {
  const ids = [...new Set(examIds.filter(Boolean))];
  const states = new Map<string, ExamLockState>(
    ids.map((id) => [id, { published: false, crossCheck: false, heldSheets: new Set(), completedSections: new Set(), evaluatedSections: new Set() }])
  );
  if (!ids.length) return states;

  const [published, rounds, assignments] = await Promise.all([
    StudentResult.findAll({ where: { examId: { [Op.in]: ids }, isDeleted: false }, attributes: ["examId"], group: ["examId"] }),
    CrossCheckRound.findAll({ where: { examId: { [Op.in]: ids }, isActive: true, status: "open" }, attributes: ["roundId", "examId"] }),
    EvaluationAssignment.findAll({ where: { examId: { [Op.in]: ids }, isActive: true }, attributes: ["examId", "sectionId", "reviewedAt"] }),
  ]);
  for (const r of published) states.get(r.examId)!.published = true;
  for (const r of rounds) states.get(r.examId)!.crossCheck = true;
  if (rounds.length) {
    const examOfRound = new Map(rounds.map((r) => [r.roundId, r.examId]));
    const held = await CrossCheckItem.findAll({
      where: { roundId: { [Op.in]: [...examOfRound.keys()] }, status: CROSS_CHECK_ITEM_STATUS.PENDING },
      attributes: ["roundId", "sheetId"],
    });
    for (const item of held) states.get(examOfRound.get(item.roundId) as string)?.heldSheets.add(String(item.sheetId));
  }
  for (const a of assignments) {
    const state = states.get(a.examId)!;
    state.evaluatedSections.add(keyOf(a.sectionId));
    if (a.reviewedAt) state.completedSections.add(keyOf(a.sectionId));
  }
  return states;
}

/**
 * The lock on an exam, some of its sections or one sheet, as `who` sees it. `sections` are the
 * sections in view (completed only when every one of them is); `sheetId` a sheet in view.
 */
export function lockFor(
  state: ExamLockState | undefined,
  scope: { sections?: (string | null)[]; sheetId?: string | null },
  who: { teacher: boolean }
): EvaluationLock | null {
  if (!state) return null;
  if (state.published) return lockOf("published");
  if (scope.sheetId && state.heldSheets.has(String(scope.sheetId))) return lockOf("crossCheck", true);
  if (state.crossCheck) return lockOf("crossCheck");
  if (who.teacher && scope.sections?.length) {
    const keys = scope.sections.map(keyOf).filter((k) => state.evaluatedSections.has(k));
    if (keys.length && keys.every((k) => state.completedSections.has(k))) return lockOf("completed");
  }
  return null;
}

// ─── One sheet (the run and edit routes) ────────────────────────────────────────

/**
 * The lock on one sheet for `who`, in the order above, or null when its marks may change. Older
 * sheets saved without an exam have no workflow, so nothing locks them (as before).
 */
export async function sheetEvaluationLock(sheetId: string, who: { teacher: boolean; forEdit?: boolean }): Promise<EvaluationLock | null> {
  const sheet: any = await Scanner.findOne({ where: { sheetId }, attributes: ["sheetId", "examId", "sectionId", "studentId"] });
  if (!sheet?.examId) return null;
  const state = (await examLockStates([sheet.examId])).get(sheet.examId);
  if (!state) return null;
  if (state.published) return lockOf("published");
  // An admin may correct the marks of a sheet in an open round (the cross-checker sees the change).
  if (state.heldSheets.has(String(sheet.sheetId)) && (who.teacher || !who.forEdit)) return lockOf("crossCheck", true);
  if (!who.teacher) return null;
  // The sheet's section is known once the sheet names its student or section; an older one counts
  // as completed only when every section is.
  const known = Boolean(sheet.sectionId || sheet.studentId);
  const sections = known ? [sheet.sectionId] : [...state.evaluatedSections];
  const keys = sections.map(keyOf).filter((k) => state.evaluatedSections.has(k));
  return keys.length && keys.every((k) => state.completedSections.has(k)) ? lockOf("completed") : null;
}
