'use strict';

/**
 * viaexam_report_templates: how a school's printed documents look (the class result
 * sheet first), one row per institute and kind. sync() also creates it on boot; this
 * is for databases managed by migrations only.
 *
 *   npm run db:migrate:report-templates
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const [[found]] = await queryInterface.sequelize.query(`SELECT to_regclass('public."viaexam_report_templates"') IS NOT NULL AS ok`);
    if (found.ok) return;
    await queryInterface.createTable("viaexam_report_templates", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      instituteId: { type: Sequelize.STRING, allowNull: false },
      kind: { type: Sequelize.STRING(40), allowNull: false },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      updatedBy: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("viaexam_report_templates", ["instituteId", "kind"], { unique: true, name: "viaexam_report_templates_institute_kind" });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("viaexam_report_templates");
  },
};
