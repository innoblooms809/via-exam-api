import multer from "multer";
import fs from "fs";
import { randomUUID } from "crypto";
import { translateMulterError, verifyUploads } from "../middlewares/verifyUpload";
import { IMAGE_MIME_TYPES } from "./fileSignature";

// Every export here is [multer, translateMulterError, verifyUploads]: multer receives the bytes and
// verifyUploads decides what they really are (see middlewares/verifyUpload.ts).
// Express flattens the array, so routes use these exactly like one middleware.

// Create upload dirs if they don't exist
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = "uploads/profiles/";
    if (file.fieldname === "schoolLogo") folder = "uploads/question-papers/school-logos/";
    else if (["diagram", "diagramUrls"].includes(file.fieldname)) folder = "uploads/question-papers/diagrams/";

    ensureDir(folder);
    cb(null, folder);
  },
  // No client-supplied name or extension ever reaches the disk; verifyUploads
  // adds the extension of the type it detects.
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname.replace(/[^A-Za-z0-9_-]/g, "") || "file"}-${randomUUID()}.upload`);
  },
});

// Cheap first filter on the declared type; the real check is verifyUploads.
const imageFilter = (req: any, file: any, cb: any) => {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPG, PNG, WEBP allowed"), false);
};

const verifyImages = verifyUploads(IMAGE_MIME_TYPES, { renameOnDisk: true });

export const studentUpload = [
  multer({ storage, fileFilter: imageFilter, limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).fields([
    { name: "profilePhoto", maxCount: 1 },
  ]),
  translateMulterError,
  verifyImages,
];

export const profileUpload = [
  multer({ storage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024, files: 2 } }).fields([
    { name: "profilePhoto", maxCount: 1 },
    { name: "avatar", maxCount: 1 },
  ]),
  translateMulterError,
  verifyImages,
];

/** Institutes upload a logo only (the banner image was removed). */
export const instituteUpload = [
  // Held in memory only long enough to stream to Cloudinary — never written to local disk.
  multer({ storage: multer.memoryStorage(), fileFilter: imageFilter, limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).fields([
    { name: "logo", maxCount: 1 },
  ]),
  translateMulterError,
  verifyUploads(IMAGE_MIME_TYPES),
];

export const questionPaperUpload = [
  multer({ storage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024, files: 21 } }).fields([
    { name: "diagram", maxCount: 10 },
    { name: "diagramUrls", maxCount: 10 },
    { name: "schoolLogo", maxCount: 1 },
  ]),
  translateMulterError,
  verifyImages,
];

export const answerPaperUpload = [
  multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFilter,
    limits: { fileSize: 10 * 1024 * 1024, fieldSize: 10 * 1024 * 1024, files: 20 },
  }).fields([
    { name: "diagram", maxCount: 10 },
    { name: "diagramUrls", maxCount: 10 },
  ]),
  translateMulterError,
  verifyUploads(IMAGE_MIME_TYPES),
];

const PDF_OR_IMAGE = [...IMAGE_MIME_TYPES, "application/pdf"] as const;

export const answerPdfUpload = [
  multer({
    storage: multer.memoryStorage(),
    fileFilter: (req: any, file: any, cb: any) => {
      if ((PDF_OR_IMAGE as readonly string[]).includes(file.mimetype)) cb(null, true);
      else cb(new Error("Only JPG, PNG, WEBP, PDF allowed"), false);
    },
    limits: { fileSize: 10 * 1024 * 1024, fieldSize: 10 * 1024 * 1024, files: 5 },
  }).any(),
  translateMulterError,
  verifyUploads(PDF_OR_IMAGE),
];
