/**
 * Encrypted columns in the database (utils/dataProtection): their list and the start-up checks.
 * Values stored before encryption stay as they are.
 *
 *   prepareEncryptedColumns   on start: the columns become TEXT (ciphertext is longer than the value)
 *   checkStoredKeys           on start: refuses to run when the newest encrypted value of a column
 *                             was sealed with a key this process doesn't have (a wrong or missing
 *                             DATA_ENCRYPTION_KEY would otherwise write a second key's values)
 *   password-reset-cleanup    daily: OTP rows a day past their expiry are deleted
 */

import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import { defineMaintenanceTask, retireMaintenanceTask } from "../../queue/maintenance";
import { isKnownKey, keyIdOf, type FieldPurpose } from "../../utils/dataProtection";

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

// Removed: values stored before encryption (and ones under a previous key) are left as they are;
// new values are encrypted when the models write them. Its schedule, still saved in the queue
// database of an earlier version, is deleted on start.
retireMaintenanceTask("encrypt-sensitive-data");

defineMaintenanceTask("password-reset-cleanup", { pattern: "45 4 * * *" }, async () => {
  const [, meta] = (await sequelize.query(`DELETE FROM "viaexam_password_resets" WHERE "expiresAt" < now() - interval '1 day'`)) as [
    unknown,
    { rowCount?: number } | undefined,
  ];
  return meta?.rowCount ? { removed: meta.rowCount } : null;
});
