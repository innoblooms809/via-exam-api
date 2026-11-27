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
  /** The examiner's notes ("accept alternative answers such as …"). */
  notes?: string;
  /**
   * Reference diagram(s): the "separate answer diagram" and pictures inside answer boxes.
   * Upload paths here; inlinePaperImages turns them into data URLs before the AI call.
   */
  diagrams?: string[];
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
  /** The question's own figure(s) ("label the given diagram", "mark on this map"). */
  figures?: string[];
  numbering?: string;
  attemptAny?: number;
  /**
   * On a question WITH parts: what the teacher wrote for the whole question (keywords,
   * marking scheme, notes, answer diagram) — the evaluator applies it to every part.
   */
  answer?: PaperAnswer;
  parts?: PaperNode[];
  or?: PaperNode;
}

export interface EvaluationPaper {
  schema: typeof PAPER_SCHEMA;
  /**
   * The language the paper is printed in, when it is not English. On an Arabic paper students
   * label parts (أ) (ب) (ج), write صح / خطأ, س1, أو — the evaluator reads those, prints its labels
   * the same way and writes its feedback in Arabic.
   */
  language?: "ar";
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

/** The `src` of every picture in an HTML fragment (data URLs and upload paths). */
export const imageRefsIn = (html: unknown): string[] => {
  const out: string[] = [];
  let clean = unescapeHtml(String(html ?? ""));
  if (clean.includes("&lt;")) clean = unescapeHtml(clean);
  for (const m of clean.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    const src = m[2].trim();
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
};

/** Image references from loose values (strings / arrays), without blanks or duplicates. */
const imageRefs = (...values: unknown[]): string[] => {
  const out: string[] = [];
  for (const value of values) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const ref = typeof item === "string" ? item.trim() : "";
      if (ref && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
};

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

/** Arabic option letters (abjad order, as an Arabic paper prints them) → a–d. */
const ARABIC_OPTION_LETTERS: Record<string, string> = { "أ": "a", "ا": "a", "إ": "a", "آ": "a", "ب": "b", "ج": "c", "د": "d" };

/**
 * "(b) Photosynthesis", "b)", "Option B", "(ب) البناء الضوئي", "ب-" → "b"; null when the text
 * doesn't start with a choice.
 */
const leadingOption = (text: string): string | null => {
  const m = text.match(/^\s*(?:option\s*)?\(?([a-d])\)?(?:[\s.):,-]|$)/i);
  if (m) return m[1].toLowerCase();
  const ar = text.match(/^\s*(?:الإجابة الصحيحة|الاجابة الصحيحة|الخيار)?\s*[:：]?\s*\(?\s*([أاإآبجد])\s*\)?(?=[\s.):،,\-–]|$)/);
  return ar ? ARABIC_OPTION_LETTERS[ar[1]] : null;
};

/** "True …" / "صح" / "صحيح" → true, "False …" / "خطأ" / "غير صحيح" → false; null otherwise. */
const leadingTrueFalse = (text: string): boolean | null => {
  if (/^\s*true\b/i.test(text)) return true;
  if (/^\s*false\b/i.test(text)) return false;
  if (/^\s*(?:غير|ليس|ليست)\s+صح/.test(text)) return false;
  if (/^\s*(?:صحيحة|صحيحه|صحيح|صح|صواب)(?![\u0621-\u064A])/.test(text)) return true;
  if (/^\s*(?:خاطئة|خاطئه|خاطئ|خطأ|خطا|غلط)(?![\u0621-\u064A])/.test(text)) return false;
  return null;
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
  else if (type === "true_false") {
    const said = leadingTrueFalse(text);
    if (said !== null) key.trueFalse = said;
  }

  if (Array.isArray(partAnswer?.matchKey) && partAnswer!.matchKey.some((v: unknown) => typeof v === "number")) {
    key.matchKey = partAnswer!.matchKey.map((v: unknown) => (typeof v === "number" && v >= 0 ? v : null));
  }
  const scheme = oneLine(partAnswer?.marksScheme) || oneLine(legacy?.marksScheme ?? legacy?.markingScheme);
  if (scheme) key.markingScheme = scheme;
  const keywords = keywordsOf(legacy?.keywords);
  if (keywords) key.keywords = keywords;
  const notes = oneLine(legacy?.notes);
  if (notes) key.notes = notes;
  // The teacher's drawing: pictures in this part's answer box, else (a question without parts)
  // the question's separate answer diagram and the pictures in its overall answer.
  const diagrams = imageRefs(
    imageRefsIn(partAnswer?.answerHtml),
    legacy ? [legacy.diagramUrl, legacy.diagramDataUrl, ...imageRefsIn(legacy.overallHtml)] : []
  );
  if (diagrams.length) key.diagrams = diagrams;

  return Object.keys(key).length ? key : undefined;
};

/**
 * What the teacher wrote for a whole question with parts (keywords, marking scheme, notes,
 * answer diagram). The evaluator gives it to every part: until now it was dropped.
 */
const questionGuidance = (entry: AnyRecord | null): PaperAnswer | undefined => {
  if (!entry) return undefined;
  const g: PaperAnswer = {};
  const scheme = oneLine(entry.marksScheme ?? entry.markingScheme);
  if (scheme) g.markingScheme = scheme;
  const keywords = keywordsOf(entry.keywords);
  if (keywords) g.keywords = keywords;
  const notes = oneLine(entry.notes);
  if (notes) g.notes = notes;
  const diagrams = imageRefs([entry.diagramUrl, entry.diagramDataUrl, ...imageRefsIn(entry.overallHtml)]);
  if (diagrams.length) g.diagrams = diagrams;
  return Object.keys(g).length ? g : undefined;
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
  const figures = imageRefs([q.diagramDataUrl, q.diagramUrl, ...imageRefsIn(q.questionHtml)]);
  if (figures.length) node.figures = figures;

  if (kids.length) {
    if (["alpha", "roman", "numeric", "upper"].includes(q.partNumbering)) node.numbering = q.partNumbering;
    else node.numbering = depth === 0 ? "alpha" : "roman";
    if (Number(q.attemptAny) > 0) node.attemptAny = Number(q.attemptAny);
    node.parts = kids.map((kid) => toNode(kid, depth + 1, state, null, false));
    const guidance = questionGuidance(legacy);
    if (guidance) node.answer = guidance;
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
    if (alt) {
      node.or = toNode(alt, 0, state, null, false);
      // The examiner's notes are written for the whole question: the OR alternative follows them too.
      const notes = oneLine(entry?.notes);
      if (notes) node.or.answer = { ...(node.or.answer ?? {}), notes };
    }

    // An older answer sheet keeps one answer for a question with parts: the evaluator reads
    // it part by part, by its labels.
    const whole = oneLine(entry?.answer ?? entry?.expectedAnswer);
    if (whole && (node.parts?.length || node.or) && state.keyed === keyedBefore) {
      keyLines.push(`${number}. ${splitComposedAnswer(whole)}`);
    }
    return node;
  });

  if (!questions.length) return empty;
  // The paper builder stores the printed language in meta.language; papers without one are English.
  const meta = (parsed as AnyRecord).meta;
  const language = meta && typeof meta === "object" && String(meta.language ?? "").toLowerCase().startsWith("ar") ? "ar" : null;
  return {
    paper: { schema: PAPER_SCHEMA, ...(language ? { language } : {}), questions },
    keyText: keyLines.join("\n"),
    leaves: state.leaves,
    keyed: state.keyed,
  };
};

// ─── Pictures for the evaluator ─────────────────────────────────────────────────

export interface InlineImageLimits {
  /** Largest single picture sent (bytes of the data URL). */
  maxImageChars: number;
  /** All pictures of one paper together. */
  maxTotalChars: number;
  /** Pictures per question / part. */
  maxPerNode: number;
}

const DEFAULT_INLINE_LIMITS: InlineImageLimits = { maxImageChars: 4_000_000, maxTotalChars: 24_000_000, maxPerNode: 3 };

/**
 * The evaluator reads pictures only as data URLs (it never downloads a link from a paper), so
 * the answer diagrams and question figures are inlined here. `load` turns one reference into a
 * data URL, or null when it can't (a remote link, a missing file). Pictures over the limits are
 * left out. Changes `paper` in place; returns what was sent and dropped.
 */
export const inlinePaperImages = async (
  paper: EvaluationPaper | null,
  load: (ref: string) => Promise<string | null>,
  limits: InlineImageLimits = DEFAULT_INLINE_LIMITS
): Promise<{ inlined: number; dropped: number; chars: number }> => {
  const stats = { inlined: 0, dropped: 0, chars: 0 };
  if (!paper) return stats;
  const cache = new Map<string, string | null>();

  const convert = async (refs: string[] | undefined): Promise<string[] | undefined> => {
    if (!refs?.length) return refs;
    const out: string[] = [];
    for (const ref of refs.slice(0, limits.maxPerNode)) {
      if (!cache.has(ref)) {
        let url: string | null = null;
        try {
          url = await load(ref);
        } catch {
          url = null;
        }
        cache.set(ref, url);
      }
      const url = cache.get(ref) ?? null;
      if (!url || url.length > limits.maxImageChars || stats.chars + url.length > limits.maxTotalChars) {
        stats.dropped += 1;
        continue;
      }
      stats.chars += url.length;
      stats.inlined += 1;
      out.push(url);
    }
    stats.dropped += Math.max(refs.length - limits.maxPerNode, 0);
    return out.length ? out : undefined;
  };

  const walk = async (node: PaperNode): Promise<void> => {
    node.figures = await convert(node.figures);
    if (!node.figures) delete node.figures;
    if (node.answer?.diagrams) {
      node.answer.diagrams = await convert(node.answer.diagrams);
      if (!node.answer.diagrams) delete node.answer.diagrams;
    }
    for (const part of node.parts ?? []) await walk(part);
    if (node.or) await walk(node.or);
  };
  for (const q of paper.questions) await walk(q);
  return stats;
};

// ─── Uploaded model answer ──────────────────────────────────────────────────────

/** Every part that earns marks, the OR alternatives' parts included. */
const leavesOf = (nodes: PaperNode[]): PaperNode[] =>
  nodes.flatMap((n) => [...(n.parts?.length ? leavesOf(n.parts) : [n]), ...(n.or ? leavesOf([n.or]) : [])]);

const hasKey = (a?: PaperAnswer) =>
  Boolean(a && (a.text?.trim() || a.correctOption !== undefined || a.trueFalse !== undefined || a.matchKey?.some((v) => v !== null)));

/**
 * An uploaded model answer's OCR text as a part's key: the OCR server's "--- Page N ---"
 * lines and a leading "Answer:" label left out.
 */
export const uploadedKeyText = (raw: unknown): string =>
  String(raw ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*-{2,}\s*page\s*\d+\s*-{2,}\s*$/i.test(line))
    .join("\n")
    .replace(/^\s*(?:expected\s+answer|model\s+answer|answer\s+key|answer|ans|उत्तर)\s*[:.\-]\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Puts an uploaded model answer on a paper that has ONE part to mark, as that part's key.
 * The evaluator places an uploaded key on parts by the labels written in it ("1.", "Q1",
 * "(a)"); the model answer of a one-question paper usually has none, so that part was marked
 * from the question alone ("No model answer for this part"). A paper with more parts is left
 * to the evaluator, which reads the labels and asks its model for the rest. Changes `paper`
 * in place; returns the part's source id and the key text placed, or null when nothing was.
 */
export const placeUploadedKey = (paper: EvaluationPaper | null, rawKey: unknown): { sourceId: string; text: string } | null => {
  const text = uploadedKeyText(rawKey);
  if (!paper || !text) return null;
  const leaves = leavesOf(paper.questions);
  if (leaves.length !== 1 || hasKey(leaves[0].answer)) return null;
  leaves[0].answer = { ...(leaves[0].answer ?? {}), text };
  return { sourceId: leaves[0].sourceId ?? "", text };
};
