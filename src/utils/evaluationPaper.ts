// The question paper as the AI evaluator reads it — schema "viaexam.paper/v1"
// (documented in AI--main/paper_structure.py; partners send the same format).
//
// The one-line-per-question text (questionPaperText.ts) flattens a question with parts into
// a single line, so the evaluator could not tell Q.5 (b) (ii) from Q.5 (c). This keeps the
// tree: every part with its own marks and type, the passage of a comprehension / case study,
// the OR alternative, "attempt any N", and each part's typed key (correct option, True/False,
// match pairs, model answer). The text version is still sent alongside, for older evaluators.

import { buildAnswerMap, getQuestionText, orderPaperQuestions, parseJson } from "./questionPaperText";

type AnyRecord = Record<string, any>;

export const PAPER_SCHEMA = "viaexam.paper/v1";

export interface PaperAnswer {
  text?: string;
  /** Index of the correct option (0 = a), or its letter. */
  correctOption?: number | string;
  trueFalse?: boolean;
  /** For each Column A row, the index of its Column B row. */
  matchKey?: (number | null)[];
  keywords?: string[];
  markingScheme?: string;
}

export interface PaperNode {
  number?: number;
  sourceId?: string;
  type: string;
  text: string;
  passage?: { title?: string; text: string };
  options?: string[];
  assertion?: string;
  reason?: string;
  match?: { left: string[]; right: string[]; headers?: [string, string] };
  wordLimit?: string;
  marks: number;
  hasDiagram?: boolean;
  numbering?: string;
  attemptAny?: number;
  answer?: PaperAnswer;
  parts?: PaperNode[];
  or?: PaperNode;
}

export interface EvaluationPaper {
  schema: typeof PAPER_SCHEMA;
  questions: PaperNode[];
}

export interface EvaluationPaperResult {
  paper: EvaluationPaper | null;
  /**
   * Typed answers kept for a whole question that has parts (answer sheets saved before
   * answers were typed part by part), as labelled text — "5. (a) … (b) …" — which the
   * evaluator splits by part like an uploaded model answer.
   */
  keyText: string;
  /** Parts that earn marks, and how many of them have a typed key. */
  leaves: number;
  keyed: number;
}

// ─── HTML → text (as the paper builder flattens it) ─────────────────────────────

const unescapeHtml = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Visible text of an HTML fragment on one line; formulas become their LaTeX, images "[diagram]". */
export const htmlToText = (html: unknown): string => {
  let clean = unescapeHtml(String(html ?? ""));
  if (!clean) return "";
  if (clean.includes("&lt;") || clean.includes("&gt;")) clean = unescapeHtml(clean);
  return unescapeHtml(
    clean
      .replace(/<(span|div)\b[^>]*\bdata-latex="([^"]*)"[^>]*>\s*<\/\1>/gi, (_m, _t, latex) => ` ${unescapeHtml(latex)} `)
      .replace(/<sup>(.*?)<\/sup>/gi, "^$1")
      .replace(/<sub>(.*?)<\/sub>/gi, "$1")
      .replace(/<img [^>]*>|<img>/gi, " [diagram] ")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
};

const oneLine = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

// ─── Types ──────────────────────────────────────────────────────────────────────

const BUILDER_TYPES: Record<string, string> = {
  "mcq": "mcq",
  "fill in the blanks": "fill_in_the_blank",
  "true/false": "true_false",
  "very short answer": "very_short_answer",
  "short answer": "short_answer",
  "long answer": "long_answer",
  "match the following": "match",
  "assertion-reason": "assertion_reason",
  "comprehension": "comprehension",
  "case study": "case_study",
  "map / diagram": "diagram",
  "group": "group",
};

/** Paper-builder type (or an older paper's loose name) → evaluator node type. */
export const nodeType = (raw: unknown, hasOptions = false): string => {
  const t = String(raw ?? "").trim().toLowerCase();
  if (BUILDER_TYPES[t]) return BUILDER_TYPES[t];
  if (t.includes("mcq") || t.includes("multiple")) return "mcq";
  if (t.includes("blank")) return "fill_in_the_blank";
  if (t.includes("true") || t.includes("false")) return "true_false";
  if (t.includes("very short") || t.includes("one word")) return "very_short_answer";
  if (t.includes("match")) return "match";
  if (t.includes("assertion")) return "assertion_reason";
  if (t.includes("comprehension") || t.includes("passage")) return "comprehension";
  if (t.includes("case") || t.includes("source")) return "case_study";
  if (t.includes("map") || t.includes("diagram")) return "diagram";
  if (t.includes("long")) return "long_answer";
  if (t.includes("short")) return "short_answer";
  if (t.includes("numer")) return "numerical";
  return hasOptions ? "mcq" : "short_answer";
};

const optionTexts = (q: AnyRecord): string[] => {
  if (Array.isArray(q.optionsHtml)) return q.optionsHtml.map(htmlToText);
  const list = Array.isArray(q.options) ? q.options : [q.optionA, q.optionB, q.optionC, q.optionD].filter((o) => o !== undefined);
  return list.map((o: unknown) => (o && typeof o === "object" ? oneLine((o as AnyRecord).text ?? (o as AnyRecord).label ?? (o as AnyRecord).value) : oneLine(o)));
};

const childrenOf = (q: AnyRecord): AnyRecord[] =>
  (Array.isArray(q.parts) ? q.parts : Array.isArray(q.subQuestions) ? q.subQuestions : []).filter(
    (p: unknown) => p && typeof p === "object"
  );

// ─── Keys ───────────────────────────────────────────────────────────────────────

/** "(b) Photosynthesis", "b)", "Option B" → "b"; null when the text doesn't start with a choice. */
const leadingOption = (text: string): string | null => {
  const m = text.match(/^\s*(?:option\s*)?\(?([a-d])\)?(?:[\s.):,-]|$)/i);
  return m ? m[1].toLowerCase() : null;
};

const keywordsOf = (raw: unknown): string[] | undefined => {
  const list = Array.isArray(raw) ? raw.map(oneLine) : typeof raw === "string" ? raw.split(/[,;]/).map(oneLine) : [];
  const out = list.filter(Boolean);
  return out.length ? out : undefined;
};

/**
 * The key of one leaf: its typed part answer, else (a question without parts on an older
 * answer sheet) the question's whole typed answer.
 */
const leafKey = (type: string, partAnswer: AnyRecord | undefined, legacy: AnyRecord | null): PaperAnswer | undefined => {
  const key: PaperAnswer = {};
  const text = htmlToText(partAnswer?.answerHtml) || (legacy ? oneLine(legacy.answer ?? legacy.expectedAnswer) : "");
  if (text) key.text = text;

  const co = partAnswer?.correctOption;
  if (typeof co === "number" && Number.isFinite(co) && co >= 0) key.correctOption = co;
  else if ((type === "mcq" || type === "assertion_reason") && text) {
    const letter = leadingOption(text);
    if (letter) key.correctOption = letter;
  }

  const tf = partAnswer?.trueFalse;
  if (tf === "True" || tf === "False") key.trueFalse = tf === "True";
  else if (type === "true_false" && /^\s*(true|false)\b/i.test(text)) key.trueFalse = /^\s*true/i.test(text);

  if (Array.isArray(partAnswer?.matchKey) && partAnswer!.matchKey.some((v: unknown) => typeof v === "number")) {
    key.matchKey = partAnswer!.matchKey.map((v: unknown) => (typeof v === "number" && v >= 0 ? v : null));
  }
  const scheme = oneLine(partAnswer?.marksScheme) || oneLine(legacy?.marksScheme ?? legacy?.markingScheme);
  if (scheme) key.markingScheme = scheme;
  const keywords = keywordsOf(legacy?.keywords);
  if (keywords) key.keywords = keywords;

  return Object.keys(key).length ? key : undefined;
};

// ─── Tree ───────────────────────────────────────────────────────────────────────

interface BuildState {
  partAnswers: AnyRecord;
  leaves: number;
  keyed: number;
}

const toNode = (q: AnyRecord, depth: number, state: BuildState, legacy: AnyRecord | null, topLevel: boolean): PaperNode => {
  const options = optionTexts(q);
  const type = nodeType(q.type ?? q.questionType, options.filter(Boolean).length > 1);
  const kids = childrenOf(q);
  // The question's own words. A stored top-level `question` is the whole question flattened
  // (parts included), so it stands in only for a question without parts.
  const own = htmlToText(q.questionHtml);
  const text = own || (kids.length ? "" : topLevel ? getQuestionText(q) : oneLine(q.question ?? q.text));
  const node: PaperNode = {
    sourceId: String(q.id ?? q.questionId ?? ""),
    type,
    text,
    marks: Number(q.marks ?? q.maxMarks) || 0,
  };

  const passageText = htmlToText(q.passageHtml) || oneLine(q.passage);
  if (passageText) node.passage = { title: oneLine(q.passageTitle) || undefined, text: passageText };
  if (type === "mcq" && options.some(Boolean)) node.options = options;
  if (type === "assertion_reason") {
    node.assertion = htmlToText(q.assertionHtml) || oneLine(q.assertion);
    node.reason = htmlToText(q.reasonHtml) || oneLine(q.reason);
  }
  if (type === "match" && Array.isArray(q.matchPairs)) {
    const pairs = q.matchPairs.filter((p: unknown) => p && typeof p === "object");
    node.match = {
      left: pairs.map((p: AnyRecord) => htmlToText(p.left)),
      right: pairs.map((p: AnyRecord) => htmlToText(p.right)),
      ...(Array.isArray(q.matchHeaders) && q.matchHeaders.length === 2
        ? { headers: [oneLine(q.matchHeaders[0]), oneLine(q.matchHeaders[1])] as [string, string] }
        : {}),
    };
  }
  if (oneLine(q.wordLimit)) node.wordLimit = oneLine(q.wordLimit);
  if (q.diagramUrl || q.diagramDataUrl || type === "diagram") node.hasDiagram = true;

  if (kids.length) {
    if (["alpha", "roman", "numeric", "upper"].includes(q.partNumbering)) node.numbering = q.partNumbering;
    else node.numbering = depth === 0 ? "alpha" : "roman";
    if (Number(q.attemptAny) > 0) node.attemptAny = Number(q.attemptAny);
    node.parts = kids.map((kid) => toNode(kid, depth + 1, state, null, false));
  } else {
    state.leaves += 1;
    const answer = leafKey(type, state.partAnswers[node.sourceId ?? ""], legacy);
    if (answer) {
      node.answer = answer;
      state.keyed += 1;
    }
  }
  return node;
};

/** "(a) … ; (b) … OR (a) …" (the composed answer text) → one part per line, for the label reader. */
const splitComposedAnswer = (text: string) =>
  text.replace(/\s;\s(?=\()/g, "\n").replace(/\s+OR\s+(?=\()/g, "\nOR\n").trim();

/**
 * Stored paper content (and its typed answer sheet) → the structured paper. `paper` is null
 * for content that is not a question list (plain text, empty), so the caller sends the text only.
 */
export const buildEvaluationPaper = (content: unknown, ansDoc?: unknown): EvaluationPaperResult => {
  const parsed = parseJson(content);
  const empty: EvaluationPaperResult = { paper: null, keyText: "", leaves: 0, keyed: 0 };
  if (!parsed || typeof parsed !== "object") return empty;

  const answerMap = buildAnswerMap(ansDoc);
  const state: BuildState = { partAnswers: {}, leaves: 0, keyed: 0 };
  const keyLines: string[] = [];

  const questions = orderPaperQuestions(parsed).map((q, index) => {
    const number = index + 1;
    const entry =
      answerMap.get(String(q.id ?? q.questionId ?? "")) ?? answerMap.get(String(number)) ?? answerMap.get(`Q${number}`) ?? null;
    state.partAnswers = entry?.partAnswers && typeof entry.partAnswers === "object" ? entry.partAnswers : {};
    const keyedBefore = state.keyed;

    const node = toNode(q, 0, state, entry, true);
    node.number = number;
    const alt = q.orQuestion && typeof q.orQuestion === "object" ? q.orQuestion : null;
    if (alt) node.or = toNode(alt, 0, state, null, false);

    // An older answer sheet keeps one answer for a question with parts: the evaluator reads
    // it part by part, by its labels.
    const whole = oneLine(entry?.answer ?? entry?.expectedAnswer);
    if (whole && (node.parts?.length || node.or) && state.keyed === keyedBefore) {
      keyLines.push(`${number}. ${splitComposedAnswer(whole)}`);
    }
    return node;
  });

  if (!questions.length) return empty;
  return {
    paper: { schema: PAPER_SCHEMA, questions },
    keyText: keyLines.join("\n"),
    leaves: state.leaves,
    keyed: state.keyed,
  };
};
