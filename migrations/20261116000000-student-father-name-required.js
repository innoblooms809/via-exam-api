'use strict';

/**
 * A new student must have a father's name: viaexam_student_profiles refuses an insert whose
 * "fatherName" is empty. Only on insert, so students saved before this rule (some have none)
 * stay as they are and can still be edited. The API also applies this on boot (db/connect.ts);
 * this is for databases managed by migrations.
 *
 *   npm run db:migrate
 */

const FUNCTION_SQL = `CREATE OR REPLACE FUNCTION viaexam_student_father_required() RETURNS trigger AS $fn$
  BEGIN
    IF NEW."fatherName" IS NULL OR btrim(NEW."fatherName") = '' THEN
      RAISE EXCEPTION 'Father''s name is required for a new student.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $fn$ LANGUAGE plpgsql`;

const TRIGGER_SQL = `DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'viaexam_student_father_required') THEN
      CREATE TRIGGER viaexam_student_father_required BEFORE INSERT ON "viaexam_student_profiles"
        FOR EACH ROW EXECUTE FUNCTION viaexam_student_father_required();
    END IF;
  END $do$`;

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(FUNCTION_SQL);
    await queryInterface.sequelize.query(TRIGGER_SQL);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS viaexam_student_father_required ON "viaexam_student_profiles"`);
    await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS viaexam_student_father_required()`);
  },
};
