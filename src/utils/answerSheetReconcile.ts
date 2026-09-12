// ─── Keeping typed answers linked to their questions ────────────────────────────
//
// A typed answer sheet stores each answer against a question id:
//     [{ questionId, answer, keywords, marksScheme, notes, lang, diagramDataUrl, question? }]
//
// Those ids stop matching when the question paper changes underneath the answers:
//   • the paper is deleted and the set is built again (every question gets a new id)
//   • a question is removed / re-added while editing the paper
//
// To never lose a teacher's answers, every answer carries a snapshot of the question
// it answered (`question: { text, marks, type, section, number }`). When the paper
// changes, `reconcileTypedAnswers`:
//   1. refreshes snapshots from the paper the answers were written for,
//   2. keeps answers whose question still exists,
//   3. re-links the others to a question of the new paper ONLY on a confident
//      content match (same text, or ≥ 80% word overlap) — one answer per question,
//      best matches first. A wrong link is worse than none, so there is no guessing
//      by position,
//   4. keeps every answer it could not place as "unlinked" (never deleted).
// Unlinked answers are shown to the teacher in the answer sheet editor (link to a
// question or discard) and block submitting the set for approval.

import { getQuestionText, orderPaperQuestions } from "./questionPaperText";

type AnyRecord = Record<string, any>;

export interface QuestionSnapshot {
  text: string;
  marks: number | null;
  type: string;
  section: string;
  number: number;
}

export interface ReconcileResult {
  /** Answers in the stored (array) shape, with ids re-linked and snapshots refreshed. */
  answers: AnyRecord[];
  /** Answers moved to a different question id of the new paper. */
  relinked: number;
  /** Answers that match no question of the new paper (kept, need the teacher). */
  unlinked: number;
  /** True when anything differs from the stored answers. */
  changed: boolean;
}

const MIN_WORD_OVERLAP = 0.8;

const parseJson = (value: unknown): any => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Typed answers as an array, or null for uploaded (PDF) answer sheets / unknown shapes. */
export function typedAnswerList(answers: unknown): AnyRecord[] | null {
  const parsed = parseJson(answers);
  if (Array.isArray(parsed)) return parsed.filter((a) => a && typeof a === "object");
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.answers)) {
    return parsed.answers.filter((a: unknown) => a && typeof a === "object");
  }
  return null;
}

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\^{}_]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (value: string) => new Set(normalizeText(value).split(" ").filter((w) => w.length > 1));

/** Jaccard overlap of the two texts' words (0–1). */
function wordOverlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  A.forEach((w) => {
    if (B.has(w)) shared++;
  });
  return shared / (A.size + B.size - shared);
}

const questionIdOf = (q: AnyRecord) => String(q.id ?? q.questionId ?? "");

/** Questions of a paper keyed by id, each with its snapshot. */
function paperQuestions(content: unknown): Map<string, QuestionSnapshot> {
  const map = new Map<string, QuestionSnapshot>();
  const parsed = parseJson(content);
  if (!parsed || typeof parsed !== "object") return map;

  orderPaperQuestions(parsed).forEach((q, index) => {
    const id = questionIdOf(q);
    if (!id) return;
    const marks = Number(q.marks ?? q.maxMarks);
    map.set(id, {
      text: getQuestionText(q),
      marks: Number.isFinite(marks) ? marks : null,
      type: String(q.type ?? q.questionType ?? ""),
      section: String(q.section ?? ""),
      number: index + 1,
    });
  });
  return map;
}

/** How confidently an old question (snapshot) is the same as a new question (0 = not at all). */
function matchScore(old: QuestionSnapshot, next: QuestionSnapshot): number {
  if (!old.text.trim() || !next.text.trim()) return 0; // never link on an empty question text
  const exact = normalizeText(old.text) === normalizeText(next.text);
  const overlap = exact ? 1 : wordOverlap(old.text, next.text);
  if (overlap < MIN_WORD_OVERLAP) return 0;
  // Small tie-breakers between equally similar questions.
  const sameMarks = old.marks !== null && old.marks === next.marks ? 0.02 : 0;
  const sameType = old.type && old.type === next.type ? 0.01 : 0;
  return overlap + sameMarks + sameType;
}

/**
 * Re-links typed answers after the paper changed.
 * @param answersRaw  stored `answers` of the answer sheet (non-array → returns null: nothing to do)
 * @param oldContent  paper content the answers were written for (null when unknown / already deleted)
 * @param newContent  paper content they must match now (null = paper is being deleted: snapshot only)
 */
export function reconcileTypedAnswers(
  answersRaw: unknown,
  oldContent: unknown,
  newContent: unknown
): ReconcileResult | null {
  const list = typedAnswerList(answersRaw);
  if (!list) return null;

  const oldQuestions = paperQuestions(oldContent);
  const newQuestions = newContent ? paperQuestions(newContent) : null;
  const before = JSON.stringify(list);

  // 1. Refresh each answer's snapshot from the paper it was written for.
  const answers: AnyRecord[] = list.map((entry) => {
    const id = String(entry.questionId ?? "");
    const snapshot = (newQuestions?.get(id)) ?? oldQuestions.get(id) ?? entry.question ?? null;
    return snapshot ? { ...entry, question: snapshot } : { ...entry };
  });

  if (!newQuestions) {
    return { answers, relinked: 0, unlinked: 0, changed: JSON.stringify(answers) !== before };
  }

  // 2. Answers whose question still exists stay where they are.
  const taken = new Set<string>();
  const loose: number[] = [];
  answers.forEach((entry, index) => {
    const id = String(entry.questionId ?? "");
    if (newQuestions.has(id) && !taken.has(id)) taken.add(id);
    else loose.push(index);
  });

  // 3. Re-link the rest — confident content matches only, best pairs first.
  const pairs: Array<{ index: number; questionId: string; score: number }> = [];
  loose.forEach((index) => {
    const snapshot: QuestionSnapshot | undefined = answers[index].question;
    if (!snapshot) return;
    newQuestions.forEach((question, questionId) => {
      if (taken.has(questionId)) return;
      const score = matchScore(snapshot, question);
      if (score > 0) pairs.push({ index, questionId, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.index - b.index);

  let relinked = 0;
  const placed = new Set<number>();
  for (const { index, questionId } of pairs) {
    if (placed.has(index) || taken.has(questionId)) continue;
    answers[index] = { ...answers[index], questionId, question: newQuestions.get(questionId) };
    placed.add(index);
    taken.add(questionId);
    relinked++;
  }

  // 4. Everything else is kept as unlinked (only count answers that have content).
  const unlinked = loose.filter((index) => !placed.has(index) && hasContent(answers[index])).length;

  return { answers, relinked, unlinked, changed: JSON.stringify(answers) !== before };
}

const hasContent = (entry: AnyRecord) =>
  Boolean(
    String(entry.answer ?? "").trim() ||
      String(entry.keywords ?? "").trim() ||
      String(entry.marksScheme ?? "").trim() ||
      String(entry.notes ?? "").trim() ||
      entry.diagramDataUrl
  );

/** Typed answers with content that belong to no question of the given paper. */
export function countUnlinkedAnswers(answersRaw: unknown, content: unknown): number {
  const list = typedAnswerList(answersRaw);
  if (!list) return 0;
  const questions = paperQuestions(content);
  return list.filter((entry) => !questions.has(String(entry.questionId ?? "")) && hasContent(entry)).length;
}
