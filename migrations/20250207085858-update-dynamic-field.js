// migrations/[timestamp]-update-dynamic-field.ts

'use strict';

import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
  up: async (queryInterface) => {
    const tableName = 'test-table';

    // Check if the column exists before adding it
    const tableDescription = await queryInterface.describeTable(tableName);

    // Add the new column only if it doesn't exist
    if (!tableDescription['newColumn']) {
      await queryInterface.addColumn(tableName, 'newColumn', {
        type: DataTypes.STRING,
        allowNull: true
      });
    }

    // If you need to modify an existing column
    if (tableDescription['existingColumn']) {
      await queryInterface.changeColumn(tableName, 'existingColumn', {
        type: DataTypes.STRING,
        allowNull: false
      });
    }
  },

  down: async (queryInterface) => {
    const tableName = 'test-table';

    // Remove the column in the down migration if it was added
    await queryInterface.removeColumn(tableName, 'newColumn');

    // Revert column changes if needed
    await queryInterface.changeColumn(tableName, 'existingColumn', {
      type: DataTypes.INTEGER,
      allowNull: true
    });
  }
};
