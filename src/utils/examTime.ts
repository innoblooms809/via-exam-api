// Time helpers for exam schedules. Calendar times are stored as display text
// ("09:00 AM"); these read the formats found in the data and normalise new ones.

export const EXAM_SHIFTS = ["First Shift", "Second Shift"] as const;
export type ExamShift = (typeof EXAM_SHIFTS)[number];

/** Minutes after midnight for "09:00 AM", "9 am", "14:30", "10" or "1430"; null if unreadable. */
export const parseTime = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const clean = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  const ampm = clean.match(/(am|pm|a\.m\.|p\.m\.)$/)?.[1]?.[0] as "a" | "p" | undefined;
  const body = clean.replace(/\s*(am|pm|a\.m\.|p\.m\.)$/, "");

  let h: number;
  let m = 0;
  const hm = body.match(/^(\d{1,2})[:.](\d{2})$/);
  if (hm) {
    h = Number(hm[1]);
    m = Number(hm[2]);
  } else if (/^\d{1,2}$/.test(body)) {
    h = Number(body);
  } else if (/^\d{3,4}$/.test(body) && !ampm) {
    h = Math.floor(Number(body) / 100);
    m = Number(body) % 100;
  } else {
    return null;
  }

  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "p" && h < 12) h += 12;
    if (ampm === "a" && h === 12) h = 0;
  }
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
};

/** 570 → "09:30 AM" */
export const formatClock = (minutes: number) => {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

/** 180 → "3 Hours", 150 → "2 Hrs 30 Mins" */
export const formatMinutes = (total: number) => {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} Mins`;
  if (m === 0) return `${h} ${h === 1 ? "Hour" : "Hours"}`;
  return `${h} Hr${h === 1 ? "" : "s"} ${m} Mins`;
};

export const isShift = (value: unknown): value is ExamShift => EXAM_SHIFTS.includes(value as ExamShift);

/** Shift of an older event that has none saved: before noon = First Shift. */
export const shiftFromTime = (startTime: unknown): ExamShift | null => {
  const start = parseTime(startTime);
  if (start === null) return null;
  return start < 12 * 60 ? "First Shift" : "Second Shift";
};

export const isDateOnly = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

/** Extra event details live as JSON in `description` (no schema change needed). */
export const readDetails = (description: string | null | undefined): Record<string, any> => {
  if (!description || !description.trim().startsWith("{")) return {};
  try {
    return JSON.parse(description);
  } catch {
    return {};
  }
};

export const writeDetails = (description: string | null | undefined, patch: Record<string, any>) =>
  JSON.stringify({ ...readDetails(description), ...patch });
