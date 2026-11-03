/**
 * Encrypted columns in the database (utils/dataProtection): their list, the start-up checks, and
 * the maintenance tasks that keep them encrypted.
 *
 *   prepareEncryptedColumns   on start: the columns become TEXT (ciphertext is longer than the value)
 *   checkStoredKeys           on start: refuses to run when the newest encrypted value of a column
 *                             was sealed with a key this process doesn't have (a wrong or missing
 *                             DATA_ENCRYPTION_KEY would otherwise write a second key's values)
 *   encrypt-sensitive-data    daily and after each start: encrypts values still in plain text
 *                             (rows from before, or written by raw SQL) and moves values sealed
 *                             with a previous key to the current one. Batches of 500; a row
 *                             changed meanwhile keeps its new value; a value no key opens is left
 *                             as it is and counted.
 *   password-reset-cleanup    daily: OTP rows a day past their expiry are deleted
 */

import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import { defineMaintenanceTask } from "../../queue/maintenance";
import { currentKeyId, encryptField, isKnownKey, keyIdOf, openForRotation, type FieldPurpose } from "../../utils/dataProtection";

interface EncryptedColumn {
  table: string;
  column: string;
  purpose: FieldPurpose;
}

/** Every encrypted column; each model declares its own with encryptedColumn() too. */
export const ENCRYPTED_COLUMNS: EncryptedColumn[] = [
  { table: "viaexam_answer_sheets", column: "fileUrl", purpose: "sheet.fileUrl" },
  { table: "viaexam_answer_sheets", column: "filePublicId", purpose: "sheet.filePublicId" },
  { table: "viaexam_users", column: "profileUrl", purpose: "profileUrl" },
  { table: "viaexam_teacher_profiles", column: "profileUrl", purpose: "profileUrl" },
  { table: "viaexam_scanner_profiles", column: "profileUrl", purpose: "profileUrl" },
  { table: "viaexam_scanner_profiles", column: "aadhar", purpose: "aadhaar" },
  { table: "viaexam_student_profiles", column: "profileUrl", purpose: "profileUrl" },
  { table: "viaexam_student_profiles", column: "aadhar", purpose: "aadhaar" },
];

const BATCH = 500;

export const prepareEncryptedColumns = async () => {
  const found = await sequelize
    .query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN (:tables) AND column_name IN (:columns)`,
      {
        replacements: { tables: [...new Set(ENCRYPTED_COLUMNS.map((c) => c.table))], columns: [...new Set(ENCRYPTED_COLUMNS.map((c) => c.column))] },
        type: QueryTypes.SELECT,
      }
    )
    .catch(() => []);
  for (const c of found) {
    if (c.data_type === "text" || !ENCRYPTED_COLUMNS.some((e) => e.table === c.table_name && e.column === c.column_name)) continue;
    await sequelize
      .query(`ALTER TABLE "${c.table_name}" ALTER COLUMN "${c.column_name}" TYPE TEXT`)
      .catch((err) => logger.warn(`[DataProtection] ${c.table_name}.${c.column_name} could not become TEXT: ${err?.message || err}`));
  }
};

export const checkStoredKeys = async () => {
  const unknown: string[] = [];
  for (const c of ENCRYPTED_COLUMNS) {
    const [row] = await sequelize
      .query<{ value: string }>(`SELECT "${c.column}" AS value FROM "${c.table}" WHERE "${c.column}" LIKE 'enc:1:%' ORDER BY "id" DESC LIMIT 1`, {
        type: QueryTypes.SELECT,
      })
      .catch(() => [] as { value: string }[]);
    const keyId = row ? keyIdOf(row.value) : null;
    if (keyId && !isKnownKey(keyId)) unknown.push(`${c.table}.${c.column} (key ${keyId})`);
  }
  if (unknown.length) {
    throw new Error(
      `The database holds values encrypted with a key this process doesn't have: ${unknown.join(", ")}. Every API and ` +
        "worker process that uses this database needs the same DATA_ENCRYPTION_KEY; after a key change, the old key goes " +
        "in DATA_ENCRYPTION_PREVIOUS_KEYS."
    );
  }
};

const encryptColumn = async ({ table, column, purpose }: EncryptedColumn) => {
  const sealedNow = `enc:1:${currentKeyId()}:%`;
  let lastId = 0;
  let encrypted = 0;
  let unreadable = 0;
  for (;;) {
    const rows = await sequelize.query<{ id: number; value: string }>(
      `SELECT "id", "${column}" AS value FROM "${table}"
        WHERE "id" > :lastId AND "${column}" IS NOT NULL AND "${column}" <> '' AND "${column}" NOT LIKE :sealedNow
        ORDER BY "id" LIMIT ${BATCH}`,
      { replacements: { lastId, sealedNow }, type: QueryTypes.SELECT }
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;

    const changes: Array<[number, string, string]> = [];
    for (const r of rows) {
      const plain = openForRotation(r.value, purpose);
      if (plain === null) unreadable++;
      else changes.push([r.id, r.value, encryptField(plain, purpose)]);
    }
    if (!changes.length) continue;
    // One statement per batch, pinned to the value read: a row changed meanwhile keeps its new value.
    const values = changes.map((_, i) => `($${i * 3 + 1}::int, $${i * 3 + 2}::text, $${i * 3 + 3}::text)`).join(", ");
    const [, meta] = (await sequelize.query(
      `UPDATE "${table}" AS t SET "${column}" = v.next FROM (VALUES ${values}) AS v(id, prev, next) WHERE t."id" = v.id AND t."${column}" = v.prev`,
      { bind: changes.flat() }
    )) as [unknown, { rowCount?: number } | undefined];
    encrypted += Number(meta?.rowCount ?? changes.length);
  }
  return { encrypted, unreadable };
};

defineMaintenanceTask("encrypt-sensitive-data", { pattern: "15 4 * * *" }, async () => {
  const done: Record<string, { encrypted: number; unreadable: number }> = {};
  for (const c of ENCRYPTED_COLUMNS) {
    const result = await encryptColumn(c);
    if (result.encrypted || result.unreadable) done[`${c.table}.${c.column}`] = result;
    if (result.unreadable) {
      logger.error(`[DataProtection] ${result.unreadable} value(s) of ${c.table}.${c.column} can't be decrypted with the configured keys; left as they are.`);
    }
  }
  return Object.keys(done).length ? done : null;
});

defineMaintenanceTask("password-reset-cleanup", { pattern: "45 4 * * *" }, async () => {
  const [, meta] = (await sequelize.query(`DELETE FROM "viaexam_password_resets" WHERE "expiresAt" < now() - interval '1 day'`)) as [
    unknown,
    { rowCount?: number } | undefined,
  ];
  return meta?.rowCount ? { removed: meta.rowCount } : null;
});
