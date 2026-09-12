// Turns a stored question paper (and its standard answer key) into the plain
// text the AI evaluation services read:
//
//   1. Question text (a) option (b) option [Marks: 2]
//   1. Expected Answer: ... (Keywords: ...; Marking scheme: ...)
//
// Questions are numbered in section order — exactly how the paper is printed —
// so "Q3" on a student's answer sheet lines up with question 3 here. Every entry
// stays on one line: the Python parsers treat any line that starts with a number
// as a new question/answer, so multi-line text would otherwise be split apart.

type AnyRecord = Record<string, any>;

export interface FormattedQuestionPaper {
  questions: string;
  answers: string;
  calculatedTotalMarks: number;
  /** Set when the answer key is an uploaded file (PDF/image) instead of typed answers. */
  answerKeyFileUrl: string | null;
}

const parseJson = (value: unknown): any => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const oneLine = (value: unknown): string =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const sectionToken = (value: unknown): string =>
  String(value ?? "")
    .toUpperCase()
    .replace(/SECTION/g, "")
    .replace(/[^A-Z0-9]/g, "");

export const getQuestionText = (q: AnyRecord): string => {
  const raw = q.question ?? q.questionText ?? q.text ?? q.title ?? "";
  if (raw && typeof raw === "object") return oneLine(raw.text ?? raw.question ?? "");
  return oneLine(raw);
};

const getOptionText = (opt: unknown): string => {
  if (opt && typeof opt === "object") {
    const o = opt as AnyRecord;
    return oneLine(o.text ?? o.label ?? o.value ?? o.option ?? "");
  }
  return oneLine(opt);
};

/** Questions in printed order: section by section, then anything not in a section. */
export const orderPaperQuestions = (content: AnyRecord): AnyRecord[] => {
  const sections: AnyRecord[] = Array.isArray(content?.sections) ? content.sections : [];
  const topLevel: AnyRecord[] = (Array.isArray(content?.questions) ? content.questions : []).filter(
    (q: unknown) => q && typeof q === "object"
  );
  const ordered: AnyRecord[] = [];
  const used = new Set<AnyRecord>();

  sections.forEach((section, index) => {
    if (!section || typeof section !== "object") return;
    const nested: AnyRecord[] = Array.isArray(section.questions) ? section.questions : [];
    nested.forEach((q) => {
      if (q && typeof q === "object" && !used.has(q)) {
        ordered.push(q);
        used.add(q);
      }
    });

    // The positional letter is only a fallback: builder keys can be out of order (B, C, A).
    const tokens = new Set(
      [section.key ?? section.id ?? String.fromCharCode(65 + index), section.name]
        .map(sectionToken)
        .filter(Boolean)
    );
    topLevel.forEach((q) => {
      if (used.has(q)) return;
      const token = sectionToken(q.section ?? q.sectionId ?? q.sectionName);
      if (token && tokens.has(token)) {
        ordered.push(q);
        used.add(q);
      }
    });
  });

  topLevel.forEach((q) => {
    if (!used.has(q)) ordered.push(q);
  });

  return ordered;
};

/** URL of an uploaded answer-key file (the PDF upload flow stores `{ pdfUrl }`). */
export const getAnswerKeyFileUrl = (ansDoc: unknown): string | null => {
  const parsed = parseJson(ansDoc);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const url = parsed.pdfUrl ?? parsed.fileUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
};

const buildAnswerMap = (ansDoc: unknown): Map<string, AnyRecord> => {
  const map = new Map<string, AnyRecord>();
  const parsed = parseJson(ansDoc);
  if (!parsed || typeof parsed !== "object") return map;

  const list: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.answers)
      ? parsed.answers
      : null;

  if (list) {
    list.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const a = item as AnyRecord;
      const id = String(a.questionId ?? a.question_id ?? a.id ?? "");
      if (id) map.set(id, a);
    });
    return map;
  }

  Object.entries(parsed as AnyRecord).forEach(([key, item]) => {
    // Uploaded answer key: file URL + saved OCR cache, not per-question answers.
    if (key === "pdfUrl" || key === "fileUrl" || key === "ocr") return;
    const a: AnyRecord = item && typeof item === "object" ? item : { answer: item };
    map.set(String(a.questionId ?? key), a);
  });
  return map;
};

export const formatQuestionPaper = (content: unknown, ansDoc?: unknown): FormattedQuestionPaper => {
  const answerKeyFileUrl = getAnswerKeyFileUrl(ansDoc);
  const parsed = parseJson(content);

  if (!parsed) {
    return { questions: "", answers: "", calculatedTotalMarks: 0, answerKeyFileUrl };
  }
  if (typeof parsed !== "object") {
    return { questions: String(parsed), answers: "", calculatedTotalMarks: 0, answerKeyFileUrl };
  }

  const answerMap = buildAnswerMap(ansDoc);
  const questionLines: string[] = [];
  const answerLines: string[] = [];
  let calculatedTotalMarks = 0;

  orderPaperQuestions(parsed).forEach((q, index) => {
    const number = index + 1;
    const marks = Number(q.marks ?? q.maxMarks);
    const hasMarks = Number.isFinite(marks) && marks > 0;
    if (hasMarks) calculatedTotalMarks += marks;

    const type = String(q.type ?? q.questionType ?? "").toUpperCase();
    const options = (Array.isArray(q.options) ? q.options : []).map(getOptionText).filter(Boolean);
    const showOptions = options.length > 1 && (!type || type.includes("MCQ") || type.includes("MULTIPLE"));
    const optionsText = showOptions
      ? " " + options.map((opt: string, i: number) => `(${String.fromCharCode(97 + i)}) ${opt}`).join(" ")
      : "";

    questionLines.push(
      `${number}. ${getQuestionText(q) || "(question text missing)"}${optionsText}${hasMarks ? ` [Marks: ${marks}]` : ""}`
    );

    const key =
      answerMap.get(String(q.id ?? q.questionId ?? "")) ??
      answerMap.get(String(number)) ??
      answerMap.get(`Q${number}`);
    const expected = oneLine(key?.answer ?? key?.expectedAnswer ?? q.answer ?? q.expectedAnswer ?? "");
    if (!expected) return;

    const extras = [
      key?.keywords ? `Keywords: ${oneLine(Array.isArray(key.keywords) ? key.keywords.join(", ") : key.keywords)}` : "",
      key?.marksScheme ? `Marking scheme: ${oneLine(key.marksScheme)}` : "",
    ].filter(Boolean);
    answerLines.push(
      `${number}. Expected Answer: ${expected}${extras.length ? ` (${extras.join("; ")})` : ""}`
    );
  });

  if (questionLines.length === 0) {
    return {
      questions: JSON.stringify(parsed, null, 2),
      answers: "",
      calculatedTotalMarks: 0,
      answerKeyFileUrl,
    };
  }

  return {
    questions: questionLines.join("\n"),
    answers: answerLines.join("\n"),
    calculatedTotalMarks,
    answerKeyFileUrl,
  };
};
