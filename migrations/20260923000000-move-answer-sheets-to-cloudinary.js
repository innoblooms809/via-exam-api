'use strict';

/**
 * Answer sheets move from a Postgres BLOB to Cloudinary.
 *
 * This migration only widens the schema: it adds the storage columns and makes
 * the old blob column nullable. No data is moved and nothing is dropped, so
 * every sheet uploaded before this deploy keeps working — the read path falls
 * back to the blob whenever fileUrl is null.
 *
 * Moving the existing blobs is a separate, resumable step:
 *   npm run migrate:answer-sheets
 * Drop viaexam_answer_sheets.fileBuffer only once that reports zero remaining.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('viaexam_answer_sheets', 'fileUrl', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('viaexam_answer_sheets', 'filePublicId', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('viaexam_answer_sheets', 'fileResourceType', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // Newly uploaded sheets carry a URL instead of bytes.
    await queryInterface.changeColumn('viaexam_answer_sheets', 'fileBuffer', {
      type: Sequelize.BLOB('long'),
      allowNull: true,
    });

    // A 20 MB file already overflows INTEGER headroom far less than a future
    // limit change would; BIGINT costs nothing here.
    await queryInterface.changeColumn('viaexam_answer_sheets', 'fileSize', {
      type: Sequelize.BIGINT,
      allowNull: false,
    });

    // The migration script and the cleanup job both scan for rows that still
    // hold bytes; without this they sequential-scan the blob table.
    await queryInterface.addIndex('viaexam_answer_sheets', ['fileUrl'], {
      name: 'viaexam_answer_sheets_file_url_index',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex(
      'viaexam_answer_sheets',
      'viaexam_answer_sheets_file_url_index'
    );

    await queryInterface.changeColumn('viaexam_answer_sheets', 'fileSize', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    // Rolling back is only safe while every row still has its bytes.
    await queryInterface.changeColumn('viaexam_answer_sheets', 'fileBuffer', {
      type: Sequelize.BLOB('long'),
      allowNull: false,
    });

    await queryInterface.removeColumn('viaexam_answer_sheets', 'fileResourceType');
    await queryInterface.removeColumn('viaexam_answer_sheets', 'filePublicId');
    await queryInterface.removeColumn('viaexam_answer_sheets', 'fileUrl');
  },
};
