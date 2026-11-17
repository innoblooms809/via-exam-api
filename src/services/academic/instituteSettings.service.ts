/**
 * The school's own rules (Master Data): grade bands, the marks a subject starts with,
 * cross-checking, scan quality and the recheck claim window. One InstituteSettings row per
 * institute; anything not set falls back to the defaults below, so a new school works
 * before anyone opens these pages.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import Subject from "../../models/Subject.model";
import InstituteSettings, { type CrossCheckRule, type GradeBand, type MarksDefault, type RecheckPolicyRule, type ScanQualityRule } from "../../models/InstituteSettings.model";
import MarksAudit, { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import { EXAM_TYPES } from "../../utils/examTypes";
import { DEFAULT_SCAN_QUALITY } from "../../utils/sheetQuality";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** The bands results have always used; schools can switch to their board's (e.g. CBSE A1–E). */
export const DEFAULT_GRADING_SCALE: GradeBand[] = [
  { min: 90, grade: "A+", remark: "Outstanding" },
  { min: 80, grade: "A", remark: "Excellent" },
  { min: 70, grade: "B+", remark: "Very good" },
  { min: 60, grade: "B", remark: "Good" },
  { min: 50, grade: "C+", remark: "Above average" },
  { min: 40, grade: "C", remark: "Average" },
  { min: 33, grade: "D", remark: "Pass" },
  { min: 0, grade: "E", remark: "Needs improvement" },
];

export const DEFAULT_MARKS: Record<string, MarksDefault> = Object.fromEntries(EXAM_TYPES.map((t) => [t, { maxMarks: 80, passPercent: 33 }]));

export const DEFAULT_CROSS_CHECK: CrossCheckRule = { mode: "off", below: null, above: null, nearPass: null, subjectIds: null };

/** Whether the policy covers an exam of this subject. */
export const crossCheckCovers = (rule: CrossCheckRule, subjectId: string | null | undefined) =>
  rule.mode !== "off" && (rule.subjectIds == null || (Boolean(subjectId) && rule.subjectIds.includes(subjectId as string)));

/** Students can claim a recheck on every exam, within six days of its results being published, unless the school sets otherwise. */
export const DEFAULT_RECHECK_POLICY: RecheckPolicyRule = { enabled: true, days: 6, examTypes: null, subjectIds: null };
export const RECHECK_WINDOW_LIMITS = { min: 1, max: 60 } as const;

/** Whether the policy lets students claim a recheck on a result of this exam type and subject (its deadline aside). */
export const recheckCovers = (policy: RecheckPolicyRule, examType: string | null | undefined, subjectId: string | null | undefined) =>
  policy.enabled &&
  (policy.examTypes == null || (Boolean(examType) && policy.examTypes.includes(examType as string))) &&
  (policy.subjectIds == null || (Boolean(subjectId) && policy.subjectIds.includes(subjectId as string)));

const DAY_MS = 24 * 60 * 60 * 1000;

/** When claims on a result published at `publishedAt` close, under a window of `days`. */
export const recheckClosesAt = (publishedAt: Date | string, days: number) => new Date(new Date(publishedAt).getTime() + days * DAY_MS);

/** A result's claim deadline: the one it was published with, else (published before windows existed) the school's window now. */
export const recheckDeadlineOf = (result: { publishedAt: Date | string; recheckClosesAt?: Date | string | null }, days: number) =>
  result.recheckClosesAt ? new Date(result.recheckClosesAt) : recheckClosesAt(result.publishedAt, days);

export interface Settings {
  gradingScale: GradeBand[];
  marksDefaults: Record<string, MarksDefault>;
  crossCheck: CrossCheckRule;
  scanQuality: ScanQualityRule;
  recheckPolicy: RecheckPolicyRule;
  updatedAt: string | null;
}

/** A stored list of ids or names: a non-empty list of strings, else null (every one). */
const listOf = (v: unknown) => (Array.isArray(v) && v.length ? [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))] : null);

/** A stored policy, with the defaults for anything missing or broken (on, every exam, 6 days). */
const policyOf = (stored: Partial<RecheckPolicyRule> | null | undefined): RecheckPolicyRule => {
  const days = Number(stored?.days);
  const examTypes = listOf(stored?.examTypes);
  const subjectIds = listOf(stored?.subjectIds);
  return {
    enabled: stored?.enabled !== false,
    days: Number.isInteger(days) && days >= RECHECK_WINDOW_LIMITS.min && days <= RECHECK_WINDOW_LIMITS.max ? days : DEFAULT_RECHECK_POLICY.days,
    examTypes: examTypes?.length ? examTypes : null,
    subjectIds: subjectIds?.length ? subjectIds : null,
  };
};

// Read on every result and grade; kept for a few seconds per institute.
const cache = new Map<string, { at: number; value: Settings }>();
const CACHE_MS = 10_000;

export const settingsOf = async (instituteId: string): Promise<Settings> => {
  const hit = cache.get(instituteId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const row = await InstituteSettings.findOne({ where: { instituteId } });
  const value: Settings = {
    gradingScale: row?.gradingScale?.length ? row.gradingScale : DEFAULT_GRADING_SCALE,
    marksDefaults: { ...DEFAULT_MARKS, ...(row?.marksDefaults ?? {}) },
    crossCheck: { ...DEFAULT_CROSS_CHECK, ...(row?.crossCheck ?? {}) },
    scanQuality: { ...DEFAULT_SCAN_QUALITY, ...(row?.scanQuality ?? {}) },
    recheckPolicy: policyOf(row?.recheckPolicy),
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
  cache.set(instituteId, { at: Date.now(), value });
  return value;
};

/** The grade for a percentage on a scale (highest band first). */
export const gradeOn = (scale: GradeBand[], percentage: number | null): string | null => {
  if (percentage == null || !Number.isFinite(percentage)) return null;
  const band = [...scale].sort((a, b) => b.min - a.min).find((b) => percentage >= b.min);
  return band?.grade ?? null;
};

const upsert = async (instituteId: string, userId: string, patch: Partial<Pick<InstituteSettings, "gradingScale" | "marksDefaults" | "crossCheck" | "scanQuality" | "recheckPolicy">>) => {
  const [row] = await InstituteSettings.findOrCreate({ where: { instituteId }, defaults: { instituteId } });
  await row.update({ ...patch, updatedBy: userId });
  cache.delete(instituteId);
  return row;
};

// ─── Grade bands ──────────────────────────────────────────────────────────────

/** Bands must be distinct grades, minimums from 0 to 100, highest first, ending at 0. */
const checkScale = (input: unknown): { bands: GradeBand[] } | { message: string } => {
  if (!Array.isArray(input) || input.length < 2 || input.length > 15) return { message: "Give between 2 and 15 grades." };
  const bands: GradeBand[] = [];
  for (const b of input) {
    const grade = String(b?.grade ?? "").trim().slice(0, 8);
    const min = Number(b?.min);
    const remark = String(b?.remark ?? "").trim().slice(0, 60);
    if (!grade) return { message: "Every band needs a grade, like A1." };
    if (!Number.isFinite(min) || min < 0 || min > 100) return { message: `${grade}: the lowest percentage must be from 0 to 100.` };
    bands.push({ grade, min: Math.round(min * 100) / 100, ...(remark ? { remark } : {}) });
  }
  bands.sort((a, b) => b.min - a.min);
  const grades = new Set(bands.map((b) => b.grade.toLowerCase()));
  if (grades.size !== bands.length) return { message: "Each grade can appear once." };
  if (new Set(bands.map((b) => b.min)).size !== bands.length) return { message: "Two grades start at the same percentage." };
  if (bands[bands.length - 1].min !== 0) return { message: "The lowest grade must start at 0%, so every result gets a grade." };
  return { bands };
};

const describeScale = (bands: GradeBand[]) => bands.map((b) => `${b.grade} ≥ ${b.min}%`).join(", ");

// ─── Handlers ─────────────────────────────────────────────────────────────────

const getSettings = async (user: any) => {
  const settings = await settingsOf(String(user?.instituteId ?? ""));
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: "Settings loaded.",
    data: {
      ...settings,
      examTypes: EXAM_TYPES,
      defaultGradingScale: DEFAULT_GRADING_SCALE,
      defaultScanQuality: DEFAULT_SCAN_QUALITY,
      defaultRecheckPolicy: DEFAULT_RECHECK_POLICY,
      recheckWindowLimits: RECHECK_WINDOW_LIMITS,
    },
  };
};

const saveGradingScale = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const checked = checkScale(body?.bands);
  if ("message" in checked) return fail(httpStatus.BAD_REQUEST, checked.message);
  const before = (await settingsOf(instituteId)).gradingScale;
  await upsert(instituteId, user.userId, { gradingScale: checked.bands });
  await MarksAudit.create({
    instituteId,
    what: MARKS_CHANGE.SCALE,
    source: MARKS_SOURCE.SETUP,
    oldValue: describeScale(before).slice(0, 255),
    newValue: describeScale(checked.bands).slice(0, 255),
    changedBy: user.userId,
  });
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: "Grades saved. Results published from now on use them; published results keep the grade they were given.",
    data: { gradingScale: checked.bands },
  };
};

const saveMarksDefaults = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const out: Record<string, MarksDefault> = {};
  for (const type of EXAM_TYPES) {
    const d = body?.marksDefaults?.[type];
    if (!d) continue;
    const maxMarks = Number(d.maxMarks);
    const passPercent = Number(d.passPercent);
    if (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > 1000) return fail(httpStatus.BAD_REQUEST, `${type}: maximum marks must be a whole number from 1 to 1000.`);
    if (!Number.isFinite(passPercent) || passPercent < 0 || passPercent > 100) return fail(httpStatus.BAD_REQUEST, `${type}: the pass percentage must be from 0 to 100.`);
    out[type] = { maxMarks, passPercent: Math.round(passPercent * 100) / 100 };
  }
  const current = await settingsOf(instituteId);
  await upsert(instituteId, user.userId, { marksDefaults: { ...current.marksDefaults, ...out } });
  return { error: false, statusCode: httpStatus.OK, message: "Starting marks saved.", data: { marksDefaults: { ...current.marksDefaults, ...out } } };
};

/** Cross-check policy: disabled, all answer sheets, score-based or manual selection; every subject or selected ones. */
const saveCrossCheck = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const mode = String(body?.mode ?? "");
  if (!["off", "all", "rules", "pick"].includes(mode)) return fail(httpStatus.BAD_REQUEST, "Choose a selection method: disabled, all answer sheets, score-based or manual.");
  let subjectIds: string[] | null = null;
  if (mode !== "off" && Array.isArray(body?.subjectIds)) {
    const wanted = [...new Set(body.subjectIds.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))] as string[];
    if (!wanted.length) return fail(httpStatus.BAD_REQUEST, "Select at least one subject, or apply the policy to all subjects.");
    const found = await Subject.findAll({ where: { instituteId, subjectId: { [Op.in]: wanted }, isDeleted: false }, attributes: ["subjectId"] });
    if (found.length !== wanted.length) return fail(httpStatus.BAD_REQUEST, "Some selected subjects no longer exist. Refresh the page and select again.");
    subjectIds = wanted;
  }
  const pct = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const below = pct(body?.below);
  const above = pct(body?.above);
  const nearPass = pct(body?.nearPass);
  for (const [label, v] of [["Below", below], ["At or above", above]] as const) {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) return fail(httpStatus.BAD_REQUEST, `${label}: give a percentage from 0 to 100.`);
  }
  if (nearPass !== null && (!Number.isFinite(nearPass) || nearPass < 0 || nearPass > 50)) return fail(httpStatus.BAD_REQUEST, "Near the pass mark: give 0 to 50 marks.");
  if (mode === "rules" && below === null && above === null && nearPass === null) {
    return fail(httpStatus.BAD_REQUEST, "Set at least one rule: below a percentage, at or above one, or near the pass mark.");
  }
  if (below !== null && above !== null && below >= above) return fail(httpStatus.BAD_REQUEST, "“Below” must be lower than “at or above”.");
  const rules = mode === "rules";
  const rule: CrossCheckRule = {
    mode: mode as CrossCheckRule["mode"],
    below: rules ? below : null,
    above: rules ? above : null,
    nearPass: rules ? nearPass : null,
    subjectIds,
  };
  await upsert(instituteId, user.userId, { crossCheck: rule });
  return { error: false, statusCode: httpStatus.OK, message: mode === "off" ? "Cross-check disabled." : "Cross-check policy saved.", data: { crossCheck: rule } };
};

/**
 * When an uploaded answer sheet is flagged as a poor scan. Applies to sheets uploaded
 * from now on; sheets already checked keep their flag until they are replaced.
 */
const saveScanQuality = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const rule: ScanQualityRule = {
    enabled: body?.enabled !== false,
    minDpi: num(body?.minDpi),
    warnDpi: num(body?.warnDpi),
    minSharpness: num(body?.minSharpness),
    warnSharpness: num(body?.warnSharpness),
    minContrast: num(body?.minContrast),
  };
  const checks: [string, number, number, number][] = [
    ["Low-quality DPI", rule.minDpi, 30, 600],
    ["Warning DPI", rule.warnDpi, 30, 600],
    ["Low-quality sharpness", rule.minSharpness, 0, 100],
    ["Warning sharpness", rule.warnSharpness, 0, 100],
    ["Lowest contrast", rule.minContrast, 0, 255],
  ];
  for (const [label, v, lo, hi] of checks) {
    if (!Number.isInteger(v) || v < lo || v > hi) return fail(httpStatus.BAD_REQUEST, `${label}: give a whole number from ${lo} to ${hi}.`);
  }
  if (rule.warnDpi < rule.minDpi) return fail(httpStatus.BAD_REQUEST, "The warning DPI can't be lower than the low-quality DPI.");
  if (rule.warnSharpness < rule.minSharpness) return fail(httpStatus.BAD_REQUEST, "The warning sharpness can't be lower than the low-quality sharpness.");
  await upsert(instituteId, user.userId, { scanQuality: rule });
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: rule.enabled ? "Scan quality check saved. Sheets uploaded from now on are checked with it." : "Scan quality check turned off.",
    data: { scanQuality: rule },
  };
};

/**
 * The recheck policy: whether students can claim a recheck (`enabled`), on which exams
 * (`examTypes` and `subjectIds`: null for all, or the ones chosen) and for how many days after
 * results are published (1–60). On/off and the exams apply at once to every result; the days
 * set the deadline of results published from now on (published ones keep theirs). A field left
 * out keeps its saved value, so claims can be turned off without resending the rest.
 */
const saveRecheckPolicy = async (user: any, body: any) => {
  const instituteId = String(user?.instituteId ?? "");
  if (body?.enabled !== undefined && typeof body.enabled !== "boolean") return fail(httpStatus.BAD_REQUEST, "Say whether students can claim a recheck (on or off).");
  const current = (await settingsOf(instituteId)).recheckPolicy;
  const enabled = body?.enabled === undefined ? current.enabled : body.enabled;

  const raw = body?.days;
  const days = raw === undefined ? current.days : raw === null || raw === "" ? NaN : Number(raw);
  const { min, max } = RECHECK_WINDOW_LIMITS;
  if (!Number.isInteger(days) || days < min || days > max) return fail(httpStatus.BAD_REQUEST, `Give a whole number of days from ${min} to ${max}.`);

  // Exam types: null for every type, or a non-empty list of the school's types.
  let examTypes = current.examTypes;
  if (body?.examTypes !== undefined) {
    if (body.examTypes === null) examTypes = null;
    else if (!Array.isArray(body.examTypes)) return fail(httpStatus.BAD_REQUEST, "Choose the exams whose results can be rechecked, or all of them.");
    else {
      const wanted = [...new Set(body.examTypes.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))] as string[];
      if (!wanted.length) return fail(httpStatus.BAD_REQUEST, "Select at least one exam, or allow rechecks on all exams.");
      const unknown = wanted.filter((v) => !(EXAM_TYPES as readonly string[]).includes(v));
      if (unknown.length) return fail(httpStatus.BAD_REQUEST, `${unknown.join(", ")} ${unknown.length === 1 ? "isn't an exam" : "aren't exams"} of the school. Exams are ${EXAM_TYPES.join(" and ")}.`);
      examTypes = wanted;
    }
  }

  // Subjects: null for every subject, or a non-empty list of the school's live subjects.
  let subjectIds = current.subjectIds;
  if (body?.subjectIds !== undefined) {
    if (body.subjectIds === null) subjectIds = null;
    else if (!Array.isArray(body.subjectIds)) return fail(httpStatus.BAD_REQUEST, "Choose the subjects whose results can be rechecked, or all of them.");
    else {
      const wanted = [...new Set(body.subjectIds.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))] as string[];
      if (!wanted.length) return fail(httpStatus.BAD_REQUEST, "Select at least one subject, or allow rechecks on all subjects.");
      const found = await Subject.findAll({ where: { instituteId, subjectId: { [Op.in]: wanted }, isDeleted: false }, attributes: ["subjectId"] });
      if (found.length !== wanted.length) return fail(httpStatus.BAD_REQUEST, "Some selected subjects no longer exist. Refresh the page and select again.");
      subjectIds = wanted;
    }
  }

  const rule: RecheckPolicyRule = { enabled, days, examTypes, subjectIds };
  await upsert(instituteId, user.userId, { recheckPolicy: rule });
  const daysText = `${days} day${days === 1 ? "" : "s"}`;
  const which = examTypes || subjectIds ? "the selected exams" : "every exam";
  return {
    error: false,
    statusCode: httpStatus.OK,
    message: !enabled
      ? "Recheck claims turned off. Students can't make new claims; claims already made are still handled."
      : current.enabled
        ? `Recheck policy saved: students can claim on ${which}, within ${daysText}. New days apply to results published from now on.`
        : `Recheck claims turned on for ${which}, within ${daysText}. Results still inside their deadline can be claimed again.`,
    data: { recheckPolicy: rule },
  };
};

export default { getSettings, saveGradingScale, saveMarksDefaults, saveCrossCheck, saveScanQuality, saveRecheckPolicy };
