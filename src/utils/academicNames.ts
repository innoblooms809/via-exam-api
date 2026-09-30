import { Op, WhereOptions, col, fn, where as sqlWhere } from "sequelize";

// Names for classes, sections and subjects are stored in one consistent form so
// "maths", " Maths " and "MATHS" never end up as three different subjects.

const collapse = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Lower-case key used for duplicate checks. */
export const nameKey = (value: unknown) => collapse(value).toLowerCase();

/** Capitalises each word; short all-letter words stay upper case (EVS, IT, GK). */
const titleCase = (value: string) =>
  value
    .split(" ")
    .map((word) => {
      if (/^[A-Za-z]{1,3}$/.test(word) && word === word.toUpperCase()) return word;
      if (/^(and|of|the|&)$/i.test(word)) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());

/** "class 6" → "6", "lkg" → "LKG", "nursery" → "Nursery", "11 science" → "11 Science". */
export const normalizeClassName = (value: unknown) => {
  const name = collapse(value).replace(/^class\s*/i, "");
  if (/^[A-Za-z]{2,3}$/.test(name)) return name.toUpperCase();
  return titleCase(name);
};

/** "a" → "A", "science" → "Science". */
export const normalizeSectionName = (value: unknown) => {
  const name = collapse(value).replace(/^section\s*/i, "");
  if (/^[A-Za-z0-9]{1,2}$/.test(name)) return name.toUpperCase();
  return titleCase(name);
};

/** "social science" → "Social Science"; "EVS" typed in capitals stays "EVS". */
export const normalizeSubjectName = (value: unknown) => titleCase(collapse(value));

/** Subject codes are upper case without spaces: "math 101" → "MATH-101". */
export const normalizeSubjectCode = (value: unknown) => {
  const code = collapse(value).toUpperCase().replace(/\s+/g, "-");
  return code || null;
};

/** Case-insensitive equality for a column. */
export const sameName = (column: string, value: string): WhereOptions =>
  sqlWhere(fn("lower", col(column)), nameKey(value)) as unknown as WhereOptions;

/** Case-insensitive "column IN (values)". */
export const nameIn = (column: string, values: string[]): WhereOptions =>
  sqlWhere(fn("lower", col(column)), { [Op.in]: values.map(nameKey) }) as unknown as WhereOptions;

/** Splits "A, B;C\nD" or an array into unique, non-empty names (first spelling wins). */
export const uniqueNames = (input: unknown, normalize: (v: unknown) => string): string[] => {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[,;\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = normalize(item);
    if (!name || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push(name);
  }
  return out;
};

export const MAX_NAME_LENGTH = 60;
export const MAX_BULK_ITEMS = 50;
