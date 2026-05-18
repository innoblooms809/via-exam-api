"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.answerPaperUpload = exports.questionPaperUpload = exports.instituteUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Create upload dirs if they don't exist
const ensureDir = (dir) => {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
};
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        let folder = "uploads/institutes/";
        if (file.fieldname === "logo")
            folder += "logos/";
        else if (file.fieldname === "banner")
            folder += "banners/";
        else if (file.fieldname === "schoolLogo")
            folder = "uploads/question-papers/school-logos/";
        else if (["diagram", "diagramUrls"].includes(file.fieldname))
            folder = "uploads/question-papers/diagrams/";
        ensureDir(folder);
        cb(null, folder);
    },
    filename: (req, file, cb) => {
        // e.g. logo-1715000000000.png
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${file.fieldname}-${Date.now()}${ext}`);
    },
});
const fileFilter = (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error("Only JPG, PNG, WEBP allowed"), false);
    }
};
exports.instituteUpload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max (banner is larger)
    },
}).fields([
    { name: "logo", maxCount: 1 },
    { name: "banner", maxCount: 1 },
]);
exports.questionPaperUpload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
}).fields([
    {
        name: "diagram",
        maxCount: 10,
    },
    {
        name: "diagramUrls",
        maxCount: 10,
    },
    {
        name: "schoolLogo",
        maxCount: 1,
    },
]);
exports.answerPaperUpload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
}).fields([
    {
        name: "diagram",
        maxCount: 10,
    },
    {
        name: "diagramUrls",
        maxCount: 10,
    },
]);
