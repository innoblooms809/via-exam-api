// A teacher's specialisations are stored in TeacherProfile.specialization as one
// comma-separated list ("English, Hindi"), so older single-subject values keep working
// and no schema change is needed.

export const MAX_SPECIALIZATIONS = 10;
const COLUMN_LENGTH = 255;

const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** "English, hindi ; English" → ["English", "hindi"] (trimmed, no duplicates). */
export const parseSpecializations = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,;|]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push(name);
  }
  return out;
};

export const formatSpecializations = (list: string[]) => list.join(", ");

/** Does the teacher specialise in this subject? (by subject name, any class) */
export const specialisesIn = (specialization: unknown, subjectName: unknown) => {
  const wanted = key(String(subjectName ?? ""));
  return Boolean(wanted) && parseSpecializations(specialization).some((s) => key(s) === wanted);
};

/** Validates a new list; returns an error message or null. */
export const validateSpecializations = (list: string[]): string | null => {
  if (list.length > MAX_SPECIALIZATIONS) return `A teacher can have at most ${MAX_SPECIALIZATIONS} specialisations.`;
  if (list.some((s) => s.length > 60)) return "A specialisation name can be at most 60 characters.";
  if (formatSpecializations(list).length > COLUMN_LENGTH) return "Too many specialisations — remove some and try again.";
  return null;
};
