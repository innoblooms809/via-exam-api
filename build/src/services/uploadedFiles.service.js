"use strict";
// ─── Cleanup of files uploaded for question papers / answer sheets ─────────────
//
// When a question paper or answer sheet is deleted — or an uploaded file is
// replaced — the files it pointed to would otherwise stay behind forever:
//   • question paper diagrams / school logos → local disk, uploads/question-papers/…
//   • answer sheet PDFs and answer diagrams  → Cloudinary, folder "answer-sheets/"
//
// Rules (keep these — deleting files cannot be undone):
//   1. Run only AFTER the database change is committed.
//   2. Only files inside those two locations are ever touched (never institute logos,
//      profile pictures or other Cloudinary assets).
//   3. A file is removed only when NO remaining question paper / answer sheet still
//      refers to it (a copied paper can share a diagram).
//   4. Best effort: a failure is logged and never blocks or undoes the delete.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupUploadsInBackground = exports.removeUnusedUploads = exports.collectUploadRefs = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
const cloudinary_1 = __importDefault(require("../utils/cloudinary"));
const logger_1 = __importDefault(require("../config/logger"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const LOCAL_MARKER = "uploads/question-papers/";
const CLOUD_FOLDER = "answer-sheets/";
const LOCAL_ROOT = path_1.default.resolve(process.cwd(), LOCAL_MARKER);
const isCloudinaryAnswerFile = (value) => /^https?:\/\/res\.cloudinary\.com\//i.test(value) && value.includes(`/${CLOUD_FOLDER}`);
const isLocalPaperFile = (value) => !value.startsWith("data:") && value.includes(LOCAL_MARKER);
/** Every uploaded-file reference found anywhere inside a paper's content / an answer sheet's answers. */
function collectUploadRefs(value, found = new Set()) {
    if (typeof value === "string") {
        const v = value.trim();
        if (isCloudinaryAnswerFile(v) || isLocalPaperFile(v))
            found.add(v);
    }
    else if (Array.isArray(value)) {
        value.forEach((item) => collectUploadRefs(item, found));
    }
    else if (value && typeof value === "object") {
        Object.values(value).forEach((item) => collectUploadRefs(item, found));
    }
    return [...found];
}
exports.collectUploadRefs = collectUploadRefs;
/** The stable part of a reference, used to search for other rows that still use the file. */
function searchToken(ref) {
    if (isCloudinaryAnswerFile(ref)) {
        // ".../upload/v1712345/answer-sheets/answerSheetPdf-123.pdf" → "answer-sheets/answerSheetPdf-123"
        const tail = ref.slice(ref.indexOf(`/${CLOUD_FOLDER}`) + 1).split("?")[0];
        return tail.replace(/\.[a-z0-9]+$/i, "");
    }
    return ref.slice(ref.indexOf(LOCAL_MARKER)).split("?")[0];
}
const escapeLike = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
function isStillReferenced(ref) {
    return __awaiter(this, void 0, void 0, function* () {
        const pattern = `%${escapeLike(searchToken(ref))}%`;
        const [papers, answers] = yield Promise.all([
            QuestionPaper_modal_1.default.count({
                where: sequelize_2.sequelize.where(sequelize_2.sequelize.cast(sequelize_2.sequelize.col("content"), "text"), { [sequelize_1.Op.like]: pattern }),
            }),
            stander_answer_model_1.default.count({
                where: sequelize_2.sequelize.where(sequelize_2.sequelize.cast(sequelize_2.sequelize.col("answers"), "text"), { [sequelize_1.Op.like]: pattern }),
            }),
        ]);
        return papers + answers > 0;
    });
}
function removeCloudinaryFile(url) {
    return __awaiter(this, void 0, void 0, function* () {
        // https://res.cloudinary.com/<cloud>/<resource_type>/upload/[v123/]answer-sheets/<name>.<ext>
        const match = url.split("?")[0].match(/\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/i);
        if (!match)
            return;
        const resourceType = match[1].toLowerCase();
        // "raw" files keep their extension in the public id; images/videos do not.
        const publicId = resourceType === "raw" ? match[2] : match[2].replace(/\.[a-z0-9]+$/i, "");
        if (!publicId.startsWith(CLOUD_FOLDER))
            return;
        yield cloudinary_1.default.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
    });
}
function removeLocalFile(ref) {
    return __awaiter(this, void 0, void 0, function* () {
        const relative = ref.slice(ref.indexOf(LOCAL_MARKER)).split("?")[0];
        const filePath = path_1.default.resolve(process.cwd(), relative);
        // Never follow "../" out of uploads/question-papers/.
        if (!filePath.startsWith(LOCAL_ROOT + path_1.default.sep))
            return;
        yield fs_1.default.promises.unlink(filePath).catch((err) => {
            if (err.code !== "ENOENT")
                throw err;
        });
    });
}
/** Removes the given uploaded files that nothing refers to any more. */
function removeUnusedUploads(refs, context) {
    return __awaiter(this, void 0, void 0, function* () {
        let removed = 0;
        for (const ref of new Set(refs)) {
            try {
                if (yield isStillReferenced(ref))
                    continue;
                if (isCloudinaryAnswerFile(ref))
                    yield removeCloudinaryFile(ref);
                else if (isLocalPaperFile(ref))
                    yield removeLocalFile(ref);
                else
                    continue;
                removed++;
            }
            catch (err) {
                logger_1.default.warn(`[Uploads] Could not remove ${ref} (${context}): ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
            }
        }
        if (removed)
            logger_1.default.info(`[Uploads] Removed ${removed} unused file(s) after ${context}.`);
        return removed;
    });
}
exports.removeUnusedUploads = removeUnusedUploads;
/** Fire-and-forget version for request handlers (the response does not wait for it). */
function cleanupUploadsInBackground(refs, context) {
    if (!refs.length)
        return;
    removeUnusedUploads(refs, context).catch((err) => logger_1.default.warn(`[Uploads] Cleanup after ${context} failed: ${(err === null || err === void 0 ? void 0 : err.message) || err}`));
}
exports.cleanupUploadsInBackground = cleanupUploadsInBackground;
