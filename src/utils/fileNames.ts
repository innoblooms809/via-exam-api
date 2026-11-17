/**
 * File names in any script, in uploads and downloads.
 *
 * Uploads: browsers send a multipart file name as UTF-8, but busboy (under multer) reads it as
 * latin1, so "ورقة ١٠١.pdf" arrives as "ÙˆØ±Ù‚Ø© Ù¡Ù Ù¡.pdf". decodeUploadName reads those
 * characters back as the UTF-8 bytes they are. A name that isn't valid UTF-8 read that way (a
 * real latin1 name such as "José.pdf") is kept as it came.
 *
 * Downloads: a header may only carry latin1, and Node throws on anything else, so a stored
 * Arabic name needs the RFC 6266 / 5987 form (filename*=UTF-8''…) beside a plain fallback.
 */

/** Longest name kept (the column is 255 characters); the extension always stays. */
const MAX_NAME_CHARS = 180;

// Control characters, and the direction controls that can make "invoice‮fdp.exe" read as a PDF.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** A file name made safe to store and show: no control or direction characters, NFC, trimmed, length capped. */
export const cleanFileName = (raw: unknown): string => {
  const name = String(raw ?? "").normalize("NFC").replace(UNSAFE_CHARS, "").trim();
  const chars = Array.from(name);
  if (chars.length <= MAX_NAME_CHARS) return name;
  const ext = name.match(/\.[^.\s]{1,10}$/)?.[0] ?? "";
  return chars.slice(0, MAX_NAME_CHARS - ext.length).join("").trimEnd() + ext;
};

/** The name a browser meant, from multer's `file.originalname` (see above). */
export const decodeUploadName = (raw: unknown): string => {
  const name = String(raw ?? "");
  // Only text made of U+0000–U+00FF, with something above ASCII, can be UTF-8 read as latin1.
  if (/[\u0080-\u00ff]/.test(name) && !/[^\u0000-\u00ff]/.test(name)) {
    const utf8 = Buffer.from(name, "latin1").toString("utf8");
    if (!utf8.includes("\ufffd")) return cleanFileName(utf8);
  }
  return cleanFileName(name);
};

/** A Content-Disposition header for a file of any name: `inline` to show it, `attachment` to save it. */
export const contentDisposition = (type: "inline" | "attachment", fileName: unknown): string => {
  const name = cleanFileName(fileName) || "file";
  // Old clients read the plain name: latin1 only, with no quote or backslash to break out of it.
  const fallback = name.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};
