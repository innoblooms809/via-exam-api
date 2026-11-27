'use strict';

/**
 * Sign-in sessions (src/services/auth/session.service.ts): one row per signed-in browser or
 * device, holding only an HMAC digest of its current refresh token. Replaces
 * viaexam_users.refreshToken, which is no longer read or written; it is emptied here and kept, so an
 * older version of the API still starts against this database.
 *
 * The API creates this table on boot (sequelize sync); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('viaexam_user_sessions', {
      id: { type: Sequelize.STRING(64), primaryKey: true },
      userId: { type: Sequelize.STRING(64), allowNull: false },
      tokenHash: { type: Sequelize.STRING(160), allowNull: false },
      previousHash: { type: Sequelize.STRING(160), allowNull: true },
      rotatedAt: { type: Sequelize.DATE, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      lastUsedAt: { type: Sequelize.DATE, allowNull: false },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      revokedReason: { type: Sequelize.STRING(32), allowNull: true },
      userAgent: { type: Sequelize.STRING(500), allowNull: true },
      ipAddress: { type: Sequelize.STRING(64), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('viaexam_user_sessions', ['userId'], { name: 'viaexam_user_sessions_user_idx' });
    await queryInterface.addIndex('viaexam_user_sessions', ['expiresAt'], { name: 'viaexam_user_sessions_expires_idx' });
    await queryInterface.sequelize.query(`UPDATE "viaexam_users" SET "refreshToken" = NULL WHERE "refreshToken" IS NOT NULL`);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('viaexam_user_sessions');
  },
};
