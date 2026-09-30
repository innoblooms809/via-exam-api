'use strict';

/**
 * Institute logos/banners move from local disk to Cloudinary.
 *
 * This only widens the schema with the public_id columns needed to replace or
 * remove a Cloudinary asset later; logoUrl/bannerUrl already exist and simply
 * start holding Cloudinary secure_urls instead of local paths going forward.
 * Existing rows with a local-disk path are backfilled separately by
 * `npm run migrate:institute-logos`.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('viaexam_institutes', 'logoPublicId', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('viaexam_institutes', 'bannerPublicId', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('viaexam_institutes', 'bannerPublicId');
    await queryInterface.removeColumn('viaexam_institutes', 'logoPublicId');
  },
};
