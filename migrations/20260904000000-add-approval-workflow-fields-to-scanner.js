'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('viaexam_answer_sheets', 'examId', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('viaexam_answer_sheets', 'studentName', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('viaexam_answer_sheets', ['examId', 'instituteId'], {
      name: 'viaexam_answer_sheets_exam_id_index'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('viaexam_answer_sheets', 'viaexam_answer_sheets_exam_id_index');
    await queryInterface.removeColumn('viaexam_answer_sheets', 'studentName');
    await queryInterface.removeColumn('viaexam_answer_sheets', 'examId');
  }
};