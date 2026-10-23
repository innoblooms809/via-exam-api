// Question-wise marks of an evaluation (AIEvaluation.evaluations), shared by the recheck,
// the evaluator's edits and the marks history: how a question is named and which
// questions' marks differ between two versions of a paper.

import type { QuestionChange } from "../models/RecheckAssignment.model";

const clean = (v: unknown) => String(v ?? "").trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const numOrNull = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : round2(Number(v)));

/** "1" → "Q1", "q2b" → "Q2b", "Q3(a)" stays. */
export const questionLabel = (id: string, n: number) => {
  const raw = clean(id);
  if (!raw) return `Q${n}`;
  return /^\d/.test(raw) ? `Q${raw}` : raw.replace(/^q(?=\d)/, "Q");
};

export const obtainedOf = (q: any) => numOrNull(q?.marks?.obtained ?? q?.obtainedMarks ?? q?.score);
export const maximumOf = (q: any) => numOrNull(q?.marks?.maximum ?? q?.maxMarks ?? q?.max_marks);

/** The sum of a paper's question marks (null when none has marks). */
export const totalOf = (evaluations: unknown): number | null => {
  const list = Array.isArray(evaluations) ? evaluations : [];
  const marks = list.map(obtainedOf).filter((m): m is number => m != null);
  return marks.length ? round2(marks.reduce((a, b) => a + b, 0)) : null;
};

/**
 * The questions whose marks differ between two versions of a paper, matched by question id
 * (by position when ids are missing), in the order of the newer version.
 */
export const questionChanges = (before: unknown, after: unknown): QuestionChange[] => {
  const oldList = Array.isArray(before) ? before : [];
  const newList = Array.isArray(after) ? after : [];
  const idOf = (q: any) => clean(q?.questionId ?? q?.question_id);
  const oldById = new Map<string, any>();
  oldList.forEach((q, i) => oldById.set(idOf(q) || `#${i}`, q));
  const changes: QuestionChange[] = [];
  newList.forEach((q: any, i: number) => {
    const key = idOf(q) || `#${i}`;
    const prev = oldById.get(key) ?? (idOf(q) ? undefined : oldList[i]);
    const from = prev ? obtainedOf(prev) : null;
    const to = obtainedOf(q);
    if (from === to) return;
    if (from != null && to != null && Math.abs(from - to) < 0.005) return;
    changes.push({ questionId: idOf(q) || String(i + 1), label: questionLabel(idOf(q), i + 1), from, to, max: maximumOf(q) ?? (prev ? maximumOf(prev) : null) });
  });
  return changes;
};

/** "Q3(b) 2 → 4, Q5 3 → 1" */
export const describeChanges = (changes: QuestionChange[] | null | undefined) =>
  (changes ?? []).map((c) => `${c.label} ${c.from ?? "—"} → ${c.to ?? "—"}`).join(", ");
