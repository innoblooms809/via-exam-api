import multer from "multer";
import path from "path";
import fs from "fs";

// Create upload dirs if they don't exist
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = "uploads/institutes/";
    if (file.fieldname === "logo") folder += "logos/";
    else if (file.fieldname === "banner") folder += "banners/";
    else if (file.fieldname === "schoolLogo")
      folder = "uploads/question-papers/school-logos/";
    else if (["diagram", "diagramUrls"].includes(file.fieldname))
      folder = "uploads/question-papers/diagrams/";

    ensureDir(folder);
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    // e.g. logo-1715000000000.png
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  },
});

const fileFilter = (req: any, file: any, cb: any) => {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, PNG, WEBP allowed"), false);
  }
};

export const instituteUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max (banner is larger)
  },
}).fields([
  { name: "logo", maxCount: 1 },
  { name: "banner", maxCount: 1 },
]);


export const questionPaperUpload = multer({
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

export const answerPaperUpload = multer({
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