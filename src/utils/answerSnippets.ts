// The evaluation service returns only the first 300 characters of each question's student answer and
// model answer. The full texts it read them from (the sheet's OCR, the answer key) are kept with the
// evaluation, so each cut answer is continued from there up to where the next question's answer begins.
//
//   snippet  "Q.6. उत्तर: मेरा विद्यालय … हमारे व"          (300 characters)
//   full     "… --- Q.6 उत्तर: मेरा विद्यालय … हमारे विद्यालय में … --- Q.7 उत्तर: …"
//   result   "Q.6. उत्तर: मेरा विद्यालय … हमारे विद्यालय में …"
//
// Headers differ between the two ("Q.6." / "--- Q.6", line breaks), so texts are matched with their
// whitespace collapsed and question headers left out.

type AnswerLike = { studentAnswer?: unknown; expectedAnswer?: unknown };

/** Cut snippets are 300 characters, or a little less once trimmed. Longer ones are already whole. */
const isCut = (s: string) => s.length >= 290 && s.length <= 300;
/** At most this much text is added after a cut answer when no later question bounds it. */
const MAX_REST = 6000;

// "--- Q.6. उत्तर:", "Q6)", "7. Expected Answer:", "Ans." at the start of an answer (whitespace collapsed).
const HEADER = /^(?:-{2,}\s*)?(?:(?:Q(?:uestion)?\s*\.?\s*)?\d+[a-z]?\s*[.):-]?\s*)?(?:(?:उत्तर|Ans(?:wer)?|Expected Answer)\s*[.:-]?\s*)?/i;
// The same header at the end of the text before the next answer.
const TRAILING_HEADER = /\s*(?:-{2,}\s*)?(?:(?:Q(?:uestion)?\s*\.?\s*)?\d+[a-z]?\s*[.):-]?\s*)?(?:(?:उत्तर|Ans(?:wer)?|Expected Answer)\s*[.:-]?\s*)?$/i;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The text with whitespace collapsed, and where each of its characters sits in the original. */
function indexed(text: string) {
  const chars: string[] = [];
  const at: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!space) {
        chars.push(" ");
        at.push(i);
        space = true;
      }
    } else {
      chars.push(text[i]);
      at.push(i);
      space = false;
    }
  }
  return { flat: chars.join(""), at };
}

type Indexed = ReturnType<typeof indexed>;

/** Where a (collapsed) piece of text sits in the original, searching from `from`. */
function locate(full: string, ix: Indexed, needle: string, from = 0): { start: number; end: number } | null {
  if (!needle) return null;
  let k = 0;
  while (k < ix.at.length && ix.at[k] < from) k++;
  const hit = ix.flat.indexOf(needle, k);
  if (hit < 0) return null;
  return { start: ix.at[hit], end: Math.min(full.length, ix.at[hit + needle.length - 1] + 1) };
}

/** Each answer of one field continued from the full text, where it was cut. */
function restoreField(snippets: string[], full: string): string[] {
  if (!full || !snippets.some(isCut)) return snippets;
  const ix = indexed(full);
  // Where each answer's own words begin in the full text (its header left out).
  const starts = snippets.map((snip) => {
    const anchor = collapse(snip).replace(HEADER, "").slice(0, 60).trim();
    return anchor.length >= 20 ? (locate(full, ix, anchor)?.start ?? null) : null;
  });
  return snippets.map((snip, i) => {
    const start = starts[i];
    if (!isCut(snip) || start == null) return snip;
    // Where the snippet stops in the full text: its last words.
    const tail = collapse(snip).slice(-40).trim();
    const stop = locate(full, ix, tail, start);
    if (!stop) return snip;
    // Up to the next answer that begins after it (its header dropped), else a bounded rest.
    const next = starts.filter((s): s is number => s != null && s > stop.end).sort((a, b) => a - b)[0];
    let rest = full.slice(stop.end, next ?? Math.min(full.length, stop.end + MAX_REST));
    if (next != null) rest = rest.replace(TRAILING_HEADER, "");
    return rest.trim() ? `${snip}${rest}`.trimEnd() : snip;
  });
}

/**
 * The questions with their cut student answers and model answers made whole again. `student` is the
 * sheet's OCR text, `answerKey` the model-answer text the evaluation was given. Anything that can't
 * be matched stays as it was.
 */
export function restoreFullAnswers<T extends AnswerLike>(questions: T[], texts: { student?: string | null; answerKey?: string | null }): T[] {
  if (!Array.isArray(questions) || !questions.length) return questions;
  const student = restoreField(questions.map((q) => String(q?.studentAnswer ?? "")), String(texts.student ?? ""));
  const expected = restoreField(questions.map((q) => String(q?.expectedAnswer ?? "")), String(texts.answerKey ?? ""));
  return questions.map((q, i) =>
    q && typeof q === "object" && (student[i] !== String(q.studentAnswer ?? "") || expected[i] !== String(q.expectedAnswer ?? ""))
      ? { ...q, studentAnswer: student[i], expectedAnswer: expected[i] }
      : q
  );
}
