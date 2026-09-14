'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('viaexam_exams', 'examDate', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    await queryInterface.addColumn('viaexam_exams', 'examTime', {
      type: Sequelize.TIME,
      allowNull: true,
    });

    await queryInterface.addColumn('viaexam_exams', 'sectionId', {
      type: Sequelize.STRING,
      allowNull: true,
      references: {
        model: 'viaexam_sections',
        key: 'sectionId',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('viaexam_exams', ['examDate'], {
      name: 'viaexam_exams_exam_date_index'
    });

    await queryInterface.addIndex('viaexam_exams', ['sectionId', 'instituteId'], {
      name: 'viaexam_exams_section_id_index'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('viaexam_exams', 'viaexam_exams_exam_date_index');
    await queryInterface.removeIndex('viaexam_exams', 'viaexam_exams_section_id_index');
    await queryInterface.removeColumn('viaexam_exams', 'sectionId');
    await queryInterface.removeColumn('viaexam_exams', 'examTime');
    await queryInterface.removeColumn('viaexam_exams', 'examDate');
  }
};