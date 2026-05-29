'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tables = [
      { table: 'viaexam_question_papers', enumName: 'enum_viaexam_question_papers_status' },
      { table: 'viaexam_question_paper_answers', enumName: 'enum_viaexam_question_paper_answers_status' },
    ];

    for (const { table, enumName } of tables) {
      // Add new ENUM values — PostgreSQL requires each ALTER TYPE outside transaction
      try {
        await queryInterface.sequelize.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL'`
        );
      } catch (_) {
        // might already exist or type name differs — fallback to checking
      }

      try {
        await queryInterface.sequelize.query(
          `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'PUBLISHED'`
        );
      } catch (_) {}

      // Update existing SUBMITTED → PENDING_APPROVAL
      await queryInterface.sequelize.query(
        `UPDATE "${table}" SET status = 'PENDING_APPROVAL' WHERE status = 'SUBMITTED'`
      );

      // Add publishedAt column if it doesn't exist
      const tableDesc = await queryInterface.describeTable(table);
      if (!tableDesc.publishedAt) {
        await queryInterface.addColumn(table, 'publishedAt', {
          type: Sequelize.DATE,
          allowNull: true,
          defaultValue: null,
        });
      }
    }
  },

  down: async (queryInterface) => {
    const tables = ['viaexam_question_papers', 'viaexam_question_paper_answers'];

    for (const table of tables) {
      // Revert PUBLISHED → APPROVED for data consistency
      await queryInterface.sequelize.query(
        `UPDATE "${table}" SET status = 'APPROVED' WHERE status = 'PUBLISHED'`
      );

      // Revert PENDING_APPROVAL → SUBMITTED for data consistency
      await queryInterface.sequelize.query(
        `UPDATE "${table}" SET status = 'SUBMITTED' WHERE status = 'PENDING_APPROVAL'`
      );

      // Remove publishedAt column
      const tableDesc = await queryInterface.describeTable(table);
      if (tableDesc.publishedAt) {
        await queryInterface.removeColumn(table, 'publishedAt');
      }
    }
  },
};
