import * as path from "path";
import { Request, Response } from "express";
import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

 const handleUploadFile = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension: boolean =
      [".png", ".jpg", ".jpeg"].indexOf(
        path.extname(file.originalname).toLowerCase()
      ) >= 0;
    const mimeType: boolean =
      ["image/png", "image/jpg", "image/jpeg"].indexOf(file.mimetype) >= 0;

    if (extension && mimeType) {
      return callback(null, true);
    }

    callback(
      new Error(
        "Invalid file type. Only picture file on type PNG and JPG are allowed!"
      )
    );
  },
});

export { handleUploadFile };
