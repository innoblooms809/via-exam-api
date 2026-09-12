"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.countUnlinkedAnswers = exports.reconcileTypedAnswers = exports.typedAnswerList = void 0;
const questionPaperText_1 = require("./questionPaperText");
const MIN_WORD_OVERLAP = 0.8;
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
/** Typed answers as an array, or null for uploaded (PDF) answer sheets / unknown shapes. */
function typedAnswerList(answers) {
    const parsed = parseJson(answers);
    if (Array.isArray(parsed))
        return parsed.filter((a) => a && typeof a === "object");
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.answers)) {
        return parsed.answers.filter((a) => a && typeof a === "object");
    }
    return null;
}
exports.typedAnswerList = typedAnswerList;
const normalizeText = (value) => value
    .toLowerCase()
    .replace(/[\^{}_]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const words = (value) => new Set(normalizeText(value).split(" ").filter((w) => w.length > 1));
/** Jaccard overlap of the two texts' words (0–1). */
function wordOverlap(a, b) {
    const A = words(a);
    const B = words(b);
    if (A.size === 0 || B.size === 0)
        return 0;
    let shared = 0;
    A.forEach((w) => {
        if (B.has(w))
            shared++;
    });
    return shared / (A.size + B.size - shared);
}
const questionIdOf = (q) => { var _a, _b; return String((_b = (_a = q.id) !== null && _a !== void 0 ? _a : q.questionId) !== null && _b !== void 0 ? _b : ""); };
/** Questions of a paper keyed by id, each with its snapshot. */
function paperQuestions(content) {
    const map = new Map();
    const parsed = parseJson(content);
    if (!parsed || typeof parsed !== "object")
        return map;
    (0, questionPaperText_1.orderPaperQuestions)(parsed).forEach((q, index) => {
        var _a, _b, _c, _d;
        const id = questionIdOf(q);
        if (!id)
            return;
        const marks = Number((_a = q.marks) !== null && _a !== void 0 ? _a : q.maxMarks);
        map.set(id, {
            text: (0, questionPaperText_1.getQuestionText)(q),
            marks: Number.isFinite(marks) ? marks : null,
            type: String((_c = (_b = q.type) !== null && _b !== void 0 ? _b : q.questionType) !== null && _c !== void 0 ? _c : ""),
            section: String((_d = q.section) !== null && _d !== void 0 ? _d : ""),
            number: index + 1,
        });
    });
    return map;
}
/** How confidently an old question (snapshot) is the same as a new question (0 = not at all). */
function matchScore(old, next) {
    if (!old.text.trim() || !next.text.trim())
        return 0; // never link on an empty question text
    const exact = normalizeText(old.text) === normalizeText(next.text);
    const overlap = exact ? 1 : wordOverlap(old.text, next.text);
    if (overlap < MIN_WORD_OVERLAP)
        return 0;
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
function reconcileTypedAnswers(answersRaw, oldContent, newContent) {
    const list = typedAnswerList(answersRaw);
    if (!list)
        return null;
    const oldQuestions = paperQuestions(oldContent);
    const newQuestions = newContent ? paperQuestions(newContent) : null;
    const before = JSON.stringify(list);
    // 1. Refresh each answer's snapshot from the paper it was written for.
    const answers = list.map((entry) => {
        var _a, _b, _c, _d;
        const id = String((_a = entry.questionId) !== null && _a !== void 0 ? _a : "");
        const snapshot = (_d = (_c = (_b = (newQuestions === null || newQuestions === void 0 ? void 0 : newQuestions.get(id))) !== null && _b !== void 0 ? _b : oldQuestions.get(id)) !== null && _c !== void 0 ? _c : entry.question) !== null && _d !== void 0 ? _d : null;
        return snapshot ? Object.assign(Object.assign({}, entry), { question: snapshot }) : Object.assign({}, entry);
    });
    if (!newQuestions) {
        return { answers, relinked: 0, unlinked: 0, changed: JSON.stringify(answers) !== before };
    }
    // 2. Answers whose question still exists stay where they are.
    const taken = new Set();
    const loose = [];
    answers.forEach((entry, index) => {
        var _a;
        const id = String((_a = entry.questionId) !== null && _a !== void 0 ? _a : "");
        if (newQuestions.has(id) && !taken.has(id))
            taken.add(id);
        else
            loose.push(index);
    });
    // 3. Re-link the rest — confident content matches only, best pairs first.
    const pairs = [];
    loose.forEach((index) => {
        const snapshot = answers[index].question;
        if (!snapshot)
            return;
        newQuestions.forEach((question, questionId) => {
            if (taken.has(questionId))
                return;
            const score = matchScore(snapshot, question);
            if (score > 0)
                pairs.push({ index, questionId, score });
        });
    });
    pairs.sort((a, b) => b.score - a.score || a.index - b.index);
    let relinked = 0;
    const placed = new Set();
    for (const { index, questionId } of pairs) {
        if (placed.has(index) || taken.has(questionId))
            continue;
        answers[index] = Object.assign(Object.assign({}, answers[index]), { questionId, question: newQuestions.get(questionId) });
        placed.add(index);
        taken.add(questionId);
        relinked++;
    }
    // 4. Everything else is kept as unlinked (only count answers that have content).
    const unlinked = loose.filter((index) => !placed.has(index) && hasContent(answers[index])).length;
    return { answers, relinked, unlinked, changed: JSON.stringify(answers) !== before };
}
exports.reconcileTypedAnswers = reconcileTypedAnswers;
const hasContent = (entry) => {
    var _a, _b, _c, _d;
    return Boolean(String((_a = entry.answer) !== null && _a !== void 0 ? _a : "").trim() ||
        String((_b = entry.keywords) !== null && _b !== void 0 ? _b : "").trim() ||
        String((_c = entry.marksScheme) !== null && _c !== void 0 ? _c : "").trim() ||
        String((_d = entry.notes) !== null && _d !== void 0 ? _d : "").trim() ||
        entry.diagramDataUrl);
};
/** Typed answers with content that belong to no question of the given paper. */
function countUnlinkedAnswers(answersRaw, content) {
    const list = typedAnswerList(answersRaw);
    if (!list)
        return 0;
    const questions = paperQuestions(content);
    return list.filter((entry) => { var _a; return !questions.has(String((_a = entry.questionId) !== null && _a !== void 0 ? _a : "")) && hasContent(entry); }).length;
}
exports.countUnlinkedAnswers = countUnlinkedAnswers;
