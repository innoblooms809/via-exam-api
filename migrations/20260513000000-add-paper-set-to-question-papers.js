'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableName = 'viaexam_question_papers';
    const tableDescription = await queryInterface.describeTable(tableName);

    if (tableDescription.paper_set) {
      return;
    }

    if (tableDescription.paperSet) {
      await queryInterface.renameColumn(tableName, 'paperSet', 'paper_set');
      return;
    }

    await queryInterface.addColumn(tableName, 'paper_set', {
      type: Sequelize.STRING(1),
      allowNull: false,
      defaultValue: 'A',
    });
  },

  down: async (queryInterface) => {
    const tableName = 'viaexam_question_papers';
    const tableDescription = await queryInterface.describeTable(tableName);

    if (tableDescription.paper_set) {
      await queryInterface.removeColumn(tableName, 'paper_set');
    }
  },
};
