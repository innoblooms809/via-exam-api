"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatQuestionPaper = exports.getAnswerKeyFileUrl = exports.orderPaperQuestions = exports.getQuestionText = void 0;
const parseJson = (value) => {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch (_a) {
        return value;
    }
};
const oneLine = (value) => String(value !== null && value !== void 0 ? value : "").replace(/\s+/g, " ").trim();
const sectionToken = (value) => String(value !== null && value !== void 0 ? value : "")
    .toUpperCase()
    .replace(/SECTION/g, "")
    .replace(/[^A-Z0-9]/g, "");
const getQuestionText = (q) => {
    var _a, _b, _c, _d, _e, _f;
    const raw = (_d = (_c = (_b = (_a = q.question) !== null && _a !== void 0 ? _a : q.questionText) !== null && _b !== void 0 ? _b : q.text) !== null && _c !== void 0 ? _c : q.title) !== null && _d !== void 0 ? _d : "";
    if (raw && typeof raw === "object")
        return oneLine((_f = (_e = raw.text) !== null && _e !== void 0 ? _e : raw.question) !== null && _f !== void 0 ? _f : "");
    return oneLine(raw);
};
exports.getQuestionText = getQuestionText;
const getOptionText = (opt) => {
    var _a, _b, _c, _d;
    if (opt && typeof opt === "object") {
        const o = opt;
        return oneLine((_d = (_c = (_b = (_a = o.text) !== null && _a !== void 0 ? _a : o.label) !== null && _b !== void 0 ? _b : o.value) !== null && _c !== void 0 ? _c : o.option) !== null && _d !== void 0 ? _d : "");
    }
    return oneLine(opt);
};
/** Questions in printed order: section by section, then anything not in a section. */
const orderPaperQuestions = (content) => {
    const sections = Array.isArray(content === null || content === void 0 ? void 0 : content.sections) ? content.sections : [];
    const topLevel = (Array.isArray(content === null || content === void 0 ? void 0 : content.questions) ? content.questions : []).filter((q) => q && typeof q === "object");
    const ordered = [];
    const used = new Set();
    sections.forEach((section, index) => {
        var _a, _b;
        if (!section || typeof section !== "object")
            return;
        const nested = Array.isArray(section.questions) ? section.questions : [];
        nested.forEach((q) => {
            if (q && typeof q === "object" && !used.has(q)) {
                ordered.push(q);
                used.add(q);
            }
        });
        // The positional letter is only a fallback: builder keys can be out of order (B, C, A).
        const tokens = new Set([(_b = (_a = section.key) !== null && _a !== void 0 ? _a : section.id) !== null && _b !== void 0 ? _b : String.fromCharCode(65 + index), section.name]
            .map(sectionToken)
            .filter(Boolean));
        topLevel.forEach((q) => {
            var _a, _b;
            if (used.has(q))
                return;
            const token = sectionToken((_b = (_a = q.section) !== null && _a !== void 0 ? _a : q.sectionId) !== null && _b !== void 0 ? _b : q.sectionName);
            if (token && tokens.has(token)) {
                ordered.push(q);
                used.add(q);
            }
        });
    });
    topLevel.forEach((q) => {
        if (!used.has(q))
            ordered.push(q);
    });
    return ordered;
};
exports.orderPaperQuestions = orderPaperQuestions;
/** URL of an uploaded answer-key file (the PDF upload flow stores `{ pdfUrl }`). */
const getAnswerKeyFileUrl = (ansDoc) => {
    var _a;
    const parsed = parseJson(ansDoc);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
    const url = (_a = parsed.pdfUrl) !== null && _a !== void 0 ? _a : parsed.fileUrl;
    return typeof url === "string" && url.trim() ? url.trim() : null;
};
exports.getAnswerKeyFileUrl = getAnswerKeyFileUrl;
const buildAnswerMap = (ansDoc) => {
    const map = new Map();
    const parsed = parseJson(ansDoc);
    if (!parsed || typeof parsed !== "object")
        return map;
    const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.answers)
            ? parsed.answers
            : null;
    if (list) {
        list.forEach((item) => {
            var _a, _b, _c;
            if (!item || typeof item !== "object")
                return;
            const a = item;
            const id = String((_c = (_b = (_a = a.questionId) !== null && _a !== void 0 ? _a : a.question_id) !== null && _b !== void 0 ? _b : a.id) !== null && _c !== void 0 ? _c : "");
            if (id)
                map.set(id, a);
        });
        return map;
    }
    Object.entries(parsed).forEach(([key, item]) => {
        var _a;
        // Uploaded answer key: file URL + saved OCR cache, not per-question answers.
        if (key === "pdfUrl" || key === "fileUrl" || key === "ocr")
            return;
        const a = item && typeof item === "object" ? item : { answer: item };
        map.set(String((_a = a.questionId) !== null && _a !== void 0 ? _a : key), a);
    });
    return map;
};
const formatQuestionPaper = (content, ansDoc) => {
    const answerKeyFileUrl = (0, exports.getAnswerKeyFileUrl)(ansDoc);
    const parsed = parseJson(content);
    if (!parsed) {
        return { questions: "", answers: "", calculatedTotalMarks: 0, answerKeyFileUrl };
    }
    if (typeof parsed !== "object") {
        return { questions: String(parsed), answers: "", calculatedTotalMarks: 0, answerKeyFileUrl };
    }
    const answerMap = buildAnswerMap(ansDoc);
    const questionLines = [];
    const answerLines = [];
    let calculatedTotalMarks = 0;
    (0, exports.orderPaperQuestions)(parsed).forEach((q, index) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const number = index + 1;
        const marks = Number((_a = q.marks) !== null && _a !== void 0 ? _a : q.maxMarks);
        const hasMarks = Number.isFinite(marks) && marks > 0;
        if (hasMarks)
            calculatedTotalMarks += marks;
        const type = String((_c = (_b = q.type) !== null && _b !== void 0 ? _b : q.questionType) !== null && _c !== void 0 ? _c : "").toUpperCase();
        const options = (Array.isArray(q.options) ? q.options : []).map(getOptionText).filter(Boolean);
        const showOptions = options.length > 1 && (!type || type.includes("MCQ") || type.includes("MULTIPLE"));
        const optionsText = showOptions
            ? " " + options.map((opt, i) => `(${String.fromCharCode(97 + i)}) ${opt}`).join(" ")
            : "";
        questionLines.push(`${number}. ${(0, exports.getQuestionText)(q) || "(question text missing)"}${optionsText}${hasMarks ? ` [Marks: ${marks}]` : ""}`);
        const key = (_g = (_f = answerMap.get(String((_e = (_d = q.id) !== null && _d !== void 0 ? _d : q.questionId) !== null && _e !== void 0 ? _e : ""))) !== null && _f !== void 0 ? _f : answerMap.get(String(number))) !== null && _g !== void 0 ? _g : answerMap.get(`Q${number}`);
        const expected = oneLine((_l = (_k = (_j = (_h = key === null || key === void 0 ? void 0 : key.answer) !== null && _h !== void 0 ? _h : key === null || key === void 0 ? void 0 : key.expectedAnswer) !== null && _j !== void 0 ? _j : q.answer) !== null && _k !== void 0 ? _k : q.expectedAnswer) !== null && _l !== void 0 ? _l : "");
        if (!expected)
            return;
        const extras = [
            (key === null || key === void 0 ? void 0 : key.keywords) ? `Keywords: ${oneLine(Array.isArray(key.keywords) ? key.keywords.join(", ") : key.keywords)}` : "",
            (key === null || key === void 0 ? void 0 : key.marksScheme) ? `Marking scheme: ${oneLine(key.marksScheme)}` : "",
        ].filter(Boolean);
        answerLines.push(`${number}. Expected Answer: ${expected}${extras.length ? ` (${extras.join("; ")})` : ""}`);
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
exports.formatQuestionPaper = formatQuestionPaper;
