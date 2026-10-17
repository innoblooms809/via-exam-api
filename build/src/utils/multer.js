"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.answerPdfUpload = exports.answerPaperUpload = exports.questionPaperUpload = exports.instituteUpload = exports.profileUpload = exports.studentUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = require("crypto");
const verifyUpload_1 = require("../middlewares/verifyUpload");
const fileSignature_1 = require("./fileSignature");
// Every export here is [multer, translateMulterError, verifyUploads]: multer receives the bytes and
// verifyUploads decides what they really are (see middlewares/verifyUpload.ts).
// Express flattens the array, so routes use these exactly like one middleware.
// Create upload dirs if they don't exist
const ensureDir = (dir) => {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
};
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        let folder = "uploads/profiles/";
        if (file.fieldname === "schoolLogo")
            folder = "uploads/question-papers/school-logos/";
        else if (["diagram", "diagramUrls"].includes(file.fieldname))
            folder = "uploads/question-papers/diagrams/";
        ensureDir(folder);
        cb(null, folder);
    },
    // No client-supplied name or extension ever reaches the disk; verifyUploads
    // adds the extension of the type it detects.
    filename: (req, file, cb) => {
        cb(null, `${file.fieldname.replace(/[^A-Za-z0-9_-]/g, "") || "file"}-${(0, crypto_1.randomUUID)()}.upload`);
    },
});
// Cheap first filter on the declared type; the real check is verifyUploads.
const imageFilter = (req, file, cb) => {
    if (fileSignature_1.IMAGE_MIME_TYPES.includes(file.mimetype))
        cb(null, true);
    else
        cb(new Error("Only JPG, PNG, WEBP allowed"), false);
};
const verifyImages = (0, verifyUpload_1.verifyUploads)(fileSignature_1.IMAGE_MIME_TYPES, { renameOnDisk: true });
exports.studentUpload = [
    (0, multer_1.default)({ storage, fileFilter: imageFilter, limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).fields([
        { name: "profilePhoto", maxCount: 1 },
    ]),
    verifyUpload_1.translateMulterError,
    verifyImages,
];
exports.profileUpload = [
    (0, multer_1.default)({ storage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024, files: 2 } }).fields([
        { name: "profilePhoto", maxCount: 1 },
        { name: "avatar", maxCount: 1 },
    ]),
    verifyUpload_1.translateMulterError,
    verifyImages,
];
/** Institutes upload a logo only (the banner image was removed). */
exports.instituteUpload = [
    // Held in memory only long enough to stream to Cloudinary — never written to local disk.
    (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), fileFilter: imageFilter, limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).fields([
        { name: "logo", maxCount: 1 },
    ]),
    verifyUpload_1.translateMulterError,
    (0, verifyUpload_1.verifyUploads)(fileSignature_1.IMAGE_MIME_TYPES),
];
exports.questionPaperUpload = [
    (0, multer_1.default)({ storage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024, files: 21 } }).fields([
        { name: "diagram", maxCount: 10 },
        { name: "diagramUrls", maxCount: 10 },
        { name: "schoolLogo", maxCount: 1 },
    ]),
    verifyUpload_1.translateMulterError,
    verifyImages,
];
exports.answerPaperUpload = [
    (0, multer_1.default)({
        storage: multer_1.default.memoryStorage(),
        fileFilter: imageFilter,
        limits: { fileSize: 10 * 1024 * 1024, fieldSize: 10 * 1024 * 1024, files: 20 },
    }).fields([
        { name: "diagram", maxCount: 10 },
        { name: "diagramUrls", maxCount: 10 },
    ]),
    verifyUpload_1.translateMulterError,
    (0, verifyUpload_1.verifyUploads)(fileSignature_1.IMAGE_MIME_TYPES),
];
const PDF_OR_IMAGE = [...fileSignature_1.IMAGE_MIME_TYPES, "application/pdf"];
exports.answerPdfUpload = [
    (0, multer_1.default)({
        storage: multer_1.default.memoryStorage(),
        fileFilter: (req, file, cb) => {
            if (PDF_OR_IMAGE.includes(file.mimetype))
                cb(null, true);
            else
                cb(new Error("Only JPG, PNG, WEBP, PDF allowed"), false);
        },
        limits: { fileSize: 10 * 1024 * 1024, fieldSize: 10 * 1024 * 1024, files: 5 },
    }).any(),
    verifyUpload_1.translateMulterError,
    (0, verifyUpload_1.verifyUploads)(PDF_OR_IMAGE),
];
