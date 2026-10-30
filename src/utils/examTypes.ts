// The exam types a school runs in a session. Results are grouped by them (Mid Term
// report, Final report), so every exam must use exactly one of these names.

export const EXAM_TYPES = ["Mid Term", "Final"] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

const ALIASES: Record<string, ExamType> = {
  midterm: "Mid Term",
  midterms: "Mid Term",
  midtermexam: "Mid Term",
  halfyearly: "Mid Term",
  final: "Final",
  finals: "Final",
  finalexam: "Final",
  annual: "Final",
  annualexam: "Final",
};

/** "mid-term", "Mid Term Exam", "half yearly" → "Mid Term"; anything unknown → null. */
export const normalizeExamType = (value: unknown): ExamType | null => {
  const key = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return key ? ALIASES[key] ?? null : null;
};

export const EXAM_TYPE_HINT = `Exam type must be ${EXAM_TYPES.join(" or ")}.`;
