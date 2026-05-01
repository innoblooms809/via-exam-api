// migrations/[timestamp]-update-dynamic-field.js

'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check for column existence and add new columns if necessary
    await queryInterface.addColumn('test-table', 'newColumn', {
      type: Sequelize.STRING,
      allowNull: true
    });

    // Or alter existing columns
    await queryInterface.changeColumn('test-table', 'existingColumn', {
      type: Sequelize.STRING,
      allowNull: false
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Revert the changes in case of rollback
    await queryInterface.removeColumn('test-table', 'newColumn');
    await queryInterface.changeColumn('test-table', 'existingColumn', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  }
};
