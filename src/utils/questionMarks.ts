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

/**
 * A structured paper's totals from its question tree (AIEvaluation.resultTree) and the parts'
 * current marks: parents add up their parts, "attempt any N" keeps the best N, and a question
 * with an OR counts the side the student answered (the better one when they answered both).
 * Decided on the current marks, so a part an evaluator raises above a counted one replaces it.
 */
export const treeTotals = (tree: unknown, evaluations: unknown): { obtained: number; maximum: number } | null => {
  const roots = Array.isArray(tree) ? tree : [];
  if (!roots.length) return null;
  const marksOf = new Map<string, { obtained: number | null; maximum: number | null }>();
  (Array.isArray(evaluations) ? evaluations : []).forEach((q: any) => {
    const id = clean(q?.questionId ?? q?.question_id);
    if (id) marksOf.set(id, { obtained: obtainedOf(q), maximum: maximumOf(q) });
  });

  const side = (node: any): { obtained: number; maximum: number } => {
    const parts: any[] = Array.isArray(node?.parts) ? node.parts : [];
    if (!parts.length) {
      const own = marksOf.get(clean(node?.id));
      return {
        obtained: own?.obtained ?? numOrNull(node?.marks?.obtained) ?? 0,
        maximum: own?.maximum ?? numOrNull(node?.marks?.maximum) ?? 0,
      };
    }
    const kids = parts.map(score);
    const n = Number(node?.attemptAny);
    if (Number.isFinite(n) && n > 0 && n < kids.length) {
      const best = [...kids].sort((a, b) => b.obtained - a.obtained || b.maximum - a.maximum).slice(0, n);
      const maxima = kids.map((k) => k.maximum).sort((a, b) => b - a).slice(0, n);
      return { obtained: best.reduce((s, k) => s + k.obtained, 0), maximum: maxima.reduce((s, m) => s + m, 0) };
    }
    return { obtained: kids.reduce((s, k) => s + k.obtained, 0), maximum: kids.reduce((s, k) => s + k.maximum, 0) };
  };

  const score = (node: any): { obtained: number; maximum: number } => {
    const main = side(node);
    if (!node?.or) return main;
    const alt = score(node.or);
    if (node.chosen === "or") return alt;
    if (node.chosen === "both") return alt.obtained > main.obtained ? alt : main;
    return main;
  };

  const sum = roots.map(score).reduce((s, k) => ({ obtained: s.obtained + k.obtained, maximum: s.maximum + k.maximum }), { obtained: 0, maximum: 0 });
  return { obtained: round2(sum.obtained), maximum: round2(sum.maximum) };
};

/**
 * The total of a paper's question marks (null when none has marks). With the question tree,
 * by its rules (treeTotals); without one, every part the evaluator counted.
 */
export const totalOf = (evaluations: unknown, tree?: unknown): number | null => {
  const byTree = tree ? treeTotals(tree, evaluations) : null;
  if (byTree) return byTree.obtained;
  const list = (Array.isArray(evaluations) ? evaluations : []).filter((q: any) => q?.counted !== false);
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
