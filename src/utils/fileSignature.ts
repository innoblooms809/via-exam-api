/**
 * Identifies uploaded files by their bytes, not by the name or the
 * Content-Type the browser sent — both are chosen by the client and prove
 * nothing. A file named `photo.png` that is really HTML must never be stored
 * under a name the static server would hand back as a web page.
 *
 * PDFs get one more check: a scan from a real scanner never carries
 * JavaScript, launch actions or embedded files, so any PDF that does is
 * refused before it reaches storage or a teacher's browser.
 */

import zlib from "zlib";

export interface DetectedType {
  mime: string;
  ext: string;
}

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/**
 * What a new answer sheet may be, by its bytes: a PDF only (one file per student, every page
 * in it). Older sheets stored as images still open; only new uploads are held to this.
 */
export const ANSWER_SHEET_DETECTED_TYPES = ["application/pdf"] as const;

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Reads the magic number at the start of a file. Returns null when unknown. */
export const sniffFileType = (head: Buffer): DetectedType | null => {
  if (!head || head.length < 4) return null;

  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: ".jpg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: ".png" };
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && head.toString("latin1", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: ".webp" };
  }
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { mime: "image/tiff", ext: ".tif" };
  }
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "ftyp" && HEIC_BRANDS.has(head.toString("latin1", 8, 12))) {
    return { mime: "image/heic", ext: ".heic" };
  }
  // The PDF header may follow a little junk some scanners prepend (spec: first 1024 bytes).
  if (head.subarray(0, 1024).includes("%PDF-", 0, "latin1")) return { mime: "application/pdf", ext: ".pdf" };

  return null;
};

// Names that turn a document into a program. /OpenAction and /AA alone are not
// listed: scanners use them for the initial view, and the dangerous actions
// they could point at are caught by these names anyway. /EmbeddedFile is not
// listed either: Adobe Scan attaches a small JSON file to every page, and an
// attachment cannot run unless the reader opens it — /GoToE (jump into one)
// and /Launch (run one) are what make it dangerous, and both are refused.
const ACTIVE_PDF_NAMES =
  /\/(JavaScript|JS|Launch|RichMedia|XFA|SubmitForm|ImportData|GoToE)(?=[\s/<>[\]()%]|$)/;

// PDF names may hide letters as #xx escapes (/J#61vaScript).
const decodeNameEscapes = (text: string): string =>
  text.replace(/\/[^\s/<>[\]()%{}]+/g, (name) =>
    name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  );

const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

/**
 * Returns why a PDF is unsafe, or null when it looks like a plain document.
 *
 * Stream bodies are skipped (they are page images and drawing commands, and
 * random binary would otherwise produce false matches) — except object streams,
 * which hold dictionaries and are inflated and searched like the rest.
 */
export const findPdfActiveContent = (pdf: Buffer): string | null => {
  const text = pdf.toString("latin1");
  const outside: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(text)) !== null) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = text.indexOf("endstream", bodyStart);
    if (bodyEnd === -1) break;

    const before = text.slice(cursor, match.index);
    outside.push(before);

    // The stream's own dictionary sits just before the keyword.
    const dictStart = before.lastIndexOf("obj");
    const dict = decodeNameEscapes(dictStart === -1 ? before.slice(-2048) : before.slice(dictStart));
    if (/\/ObjStm(?=[\s/<>[\]()%])/.test(dict)) {
      if (!/\/FlateDecode(?=[\s/<>[\]()%])/.test(dict)) {
        return "The PDF uses an unsupported internal compression. Export or print it to PDF again.";
      }
      try {
        const body = pdf.subarray(bodyStart, bodyEnd);
        outside.push(zlib.inflateSync(body, { maxOutputLength: MAX_INFLATED_BYTES }).toString("latin1"));
      } catch {
        try {
          // Some writers end the body with a stray EOL that zlib rejects.
          const trimmed = pdf.subarray(bodyStart, bodyEnd).toString("latin1").replace(/\r?\n$/, "");
          outside.push(zlib.inflateSync(Buffer.from(trimmed, "latin1"), { maxOutputLength: MAX_INFLATED_BYTES }).toString("latin1"));
        } catch {
          return "The PDF could not be read. Export or print it to PDF again.";
        }
      }
    }

    cursor = bodyEnd + "endstream".length;
    streamPattern.lastIndex = cursor;
  }
  outside.push(text.slice(cursor));

  const structure = decodeNameEscapes(outside.join("\n"));
  // Encrypted object streams can't be inspected, and scanners never encrypt.
  if (/\/Encrypt(?=[\s/<>[\]()%])/.test(structure)) {
    return "The PDF is password-protected or encrypted. Export it again without a password.";
  }

  const found = structure.match(ACTIVE_PDF_NAMES);
  if (found) {
    return `The PDF contains active content (${found[1]}), which is not allowed in an answer sheet or document upload.`;
  }
  return null;
};
