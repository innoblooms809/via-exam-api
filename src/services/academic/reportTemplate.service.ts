/**
 * The school's result sheet template: what the printed class result sheet shows and how
 * it looks (header, title, colour, paper, columns, blocks, signatures, footer).
 *
 * Header lines are dynamic: a field left as null follows the institute's profile (name,
 * board, address, phone…) so a change there shows on the next PDF; "" hides the line;
 * any other text replaces it. Nothing saved yet → the defaults below, so a new school
 * prints a complete sheet before anyone opens the template page.
 */

import httpStatus from "http-status";
import Institute from "../../models/Institute.model";
import ReportTemplate from "../../models/ReportTemplate.model";
import { settingsOf } from "./instituteSettings.service";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

export interface ResultSheetTemplate {
  header: {
    layout: "left" | "center";
    showLogo: boolean;
    /** null: the institute's name. */
    schoolName: string | null;
    /** null: board, affiliation / registration number, year established. "" hides it. */
    tagline: string | null;
    /** null: the institute's address. "" hides it. */
    address: string | null;
    /** null: phone, email and website. "" hides it. */
    contact: string | null;
  };
  /** "Result sheet", "Mid Term result", "Consolidated marks register"… */
  title: string;
  /** Colour of the title, the table header and the rules, as #rrggbb. */
  accent: string;
  paper: { size: "a4" | "letter" | "legal"; orientation: "auto" | "portrait" | "landscape" };
  columns: { rank: boolean; roll: boolean; section: boolean; total: boolean; percentage: boolean; grade: boolean; result: boolean };
  blocks: {
    /** Students, passed, failed, average, topper boxes. */
    summary: boolean;
    subjectAverages: boolean;
    passCounts: boolean;
    /** What AB and "-" mean. */
    legend: boolean;
    /** The school's grade bands (Master Data → Marks & grading). */
    gradingKey: boolean;
    /** "PROVISIONAL" across the page while a subject isn't published. */
    provisionalStamp: boolean;
  };
  /** One student's report card (same header, colour, signatures and footer). */
  reportCard: {
    /** "Report card", "Progress report"… */
    title: string;
    /** Each subject's class average next to the student's marks. */
    classAverage: boolean;
    /** "Rank 3 of 38". */
    rank: boolean;
    /** A box for the class teacher's remarks, with the grade's remark in it. */
    remarks: boolean;
  };
  /** Signature lines at the end, left to right (0 to 4). */
  signatures: string[];
  /** One line above the page footer ("This is a computer-generated document."). "" for none. */
  footerNote: string;
  showGeneratedAt: boolean;
  /** What a student sees of a published result on My Results, besides the marks of each subject. */
  studentView: {
    /** Each question's marks, as evaluated. */
    questionMarks: boolean;
    /** The evaluation's feedback and remarks (overall and per question). */
    feedback: boolean;
  };
}

export const DEFAULT_RESULT_SHEET: ResultSheetTemplate = {
  header: { layout: "left", showLogo: true, schoolName: null, tagline: null, address: null, contact: null },
  title: "Result sheet",
  accent: "#4338CA",
  paper: { size: "a4", orientation: "auto" },
  columns: { rank: true, roll: true, section: true, total: true, percentage: true, grade: true, result: true },
  blocks: { summary: true, subjectAverages: true, passCounts: true, legend: true, gradingKey: true, provisionalStamp: true },
  reportCard: { title: "Report card", classAverage: true, rank: true, remarks: true },
  signatures: ["Class teacher", "Exam in-charge", "Principal"],
  footerNote: "",
  showGeneratedAt: true,
  studentView: { questionMarks: true, feedback: true },
};

// ─── Validation ───────────────────────────────────────────────────────────────

/** Trimmed one-line text without control characters, at most `max` characters. */
const line = (v: unknown, max: number) =>
  String(v ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
/** null stays null (follow the institute); anything else is text ("" hides the line). */
const auto = (v: unknown, fallback: string | null, max: number) => (v === undefined ? fallback : v === null ? null : line(v, max));
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T) => (options.includes(v as T) ? (v as T) : fallback);
const pick = <K extends string>(input: any, base: Record<K, boolean>) =>
  Object.fromEntries(Object.entries(base).map(([k, d]) => [k, flag(input?.[k], d as boolean)])) as Record<K, boolean>;

/** A template from what the page sent, on top of `base`; a message when something can't be used. */
export const checkTemplate = (input: any, base: ResultSheetTemplate = DEFAULT_RESULT_SHEET): { template: ResultSheetTemplate } | { message: string } => {
  if (!input || typeof input !== "object") return { message: "Send the template's settings." };
  const h = input.header ?? {};
  const title = input.title === undefined ? base.title : line(input.title, 60);
  if (!title) return { message: "Give the sheet a title, like “Result sheet”." };
  const accent = input.accent === undefined ? base.accent : String(input.accent).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return { message: "Pick the colour as #RRGGBB, like #4338CA." };
  let signatures = base.signatures;
  if (input.signatures !== undefined) {
    if (!Array.isArray(input.signatures) || input.signatures.length > 4) return { message: "Give up to 4 signature lines." };
    signatures = input.signatures.map((s: unknown) => line(s, 40)).filter(Boolean);
  }
  const schoolName = auto(h.schoolName, base.header.schoolName, 120);
  const rc = input.reportCard ?? {};
  const cardTitle = rc.title === undefined ? base.reportCard.title : line(rc.title, 60);
  if (!cardTitle) return { message: "Give the report card a title, like “Report card”." };
  return {
    template: {
      header: {
        layout: oneOf(h.layout, ["left", "center"] as const, base.header.layout),
        showLogo: flag(h.showLogo, base.header.showLogo),
        // The name can follow the institute or be replaced, never hidden.
        schoolName: schoolName === "" ? null : schoolName,
        tagline: auto(h.tagline, base.header.tagline, 160),
        address: auto(h.address, base.header.address, 200),
        contact: auto(h.contact, base.header.contact, 160),
      },
      title,
      accent: accent.toUpperCase(),
      paper: {
        size: oneOf(input.paper?.size, ["a4", "letter", "legal"] as const, base.paper.size),
        orientation: oneOf(input.paper?.orientation, ["auto", "portrait", "landscape"] as const, base.paper.orientation),
      },
      columns: pick(input.columns, base.columns),
      blocks: pick(input.blocks, base.blocks),
      reportCard: { title: cardTitle, ...pick(rc, { classAverage: base.reportCard.classAverage, rank: base.reportCard.rank, remarks: base.reportCard.remarks }) },
      signatures,
      footerNote: input.footerNote === undefined ? base.footerNote : line(input.footerNote ?? "", 160),
      showGeneratedAt: flag(input.showGeneratedAt, base.showGeneratedAt),
      studentView: pick(input.studentView, base.studentView),
    },
  };
};

/** Saved settings on top of the defaults (older rows miss newer options). */
const stored = (row: ReportTemplate | null): ResultSheetTemplate => {
  if (!row) return DEFAULT_RESULT_SHEET;
  const checked = checkTemplate(row.settings);
  return "template" in checked ? checked.template : DEFAULT_RESULT_SHEET;
};

// ─── The institute's own lines ────────────────────────────────────────────────

/** What the header shows for each "follow the institute" line. */
const instituteLines = (i: Institute | null) => {
  const join = (parts: (string | null | undefined)[], sep: string) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);
  return {
    name: i?.instituteName ?? "",
    tagline: join([i?.boardType && i.boardType !== "Other" ? `${i.boardType}` : "", i?.registrationNumber ? `Affiliation / Reg. No. ${i.registrationNumber}` : "", i?.establishedYear ? `Estd. ${i.establishedYear}` : ""], " · "),
    address: join([i?.addressLine1, i?.addressLine2, i?.city, join([i?.state, i?.pincode], " - ")], ", "),
    contact: join([i?.contactPhone ? `Phone ${i.contactPhone}` : "", i?.contactEmail, i?.websiteUrl], " · "),
    logoUrl: i?.logoUrl ?? null,
  };
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

const KIND = "result-sheet" as const;

/** The school's saved template (the defaults when none is saved). */
export const resultTemplateOf = async (instituteId: string) => stored(await ReportTemplate.findOne({ where: { instituteId, kind: KIND } }));

/**
 * What a student's own report card needs besides the marks: the school's template, its
 * header lines and grade bands. Read-only, for the student's download (the same PDF the
 * admin prints for them).
 */
export const printBitsOf = async (instituteId: string) => {
  const [template, institute, settings] = await Promise.all([resultTemplateOf(instituteId), Institute.findOne({ where: { instituteId, isDeleted: false } }), settingsOf(instituteId)]);
  return { template, institute: instituteLines(institute), gradingScale: settings.gradingScale };
};

/** The template, the defaults, the institute's lines and grade bands (all a PDF needs besides the marks). */
const getResultSheet = async (user: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const [row, institute, settings] = await Promise.all([
    ReportTemplate.findOne({ where: { instituteId, kind: KIND } }),
    Institute.findOne({ where: { instituteId, isDeleted: false } }),
    settingsOf(instituteId),
  ]);
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: "Template loaded.",
    data: {
      template: stored(row),
      defaults: DEFAULT_RESULT_SHEET,
      institute: instituteLines(institute),
      gradingScale: settings.gradingScale,
      saved: Boolean(row),
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    },
  };
};

const saveResultSheet = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  // The whole template, as the page edits it (an empty request is refused, not saved as the default).
  const checked = checkTemplate(body?.template, DEFAULT_RESULT_SHEET);
  if ("message" in checked) return fail(httpStatus.BAD_REQUEST, checked.message);
  const [row] = await ReportTemplate.findOrCreate({ where: { instituteId, kind: KIND }, defaults: { instituteId, kind: KIND, settings: {} } });
  await row.update({ settings: checked.template as unknown as Record<string, unknown>, updatedBy: user.userId });
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: "Template saved. Every result sheet you download now uses it.",
    data: { template: checked.template, saved: true, updatedAt: new Date(row.updatedAt).toISOString() },
  };
};

/** Back to the defaults (the row goes, so later default changes reach this school too). */
const resetResultSheet = async (user: any) => {
  const instituteId = String(user?.instituteId ?? "");
  await ReportTemplate.destroy({ where: { instituteId, kind: KIND } });
  return { error: false, statusCode: httpStatus.OK, message: "Template reset to the default.", data: { template: DEFAULT_RESULT_SHEET, saved: false, updatedAt: null } };
};

export default { getResultSheet, saveResultSheet, resetResultSheet };
