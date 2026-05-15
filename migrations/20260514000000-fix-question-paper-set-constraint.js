'use strict';

module.exports = {
  up: async (queryInterface) => {
    const tableName = 'viaexam_question_papers';
    const oldConstraintName = 'uq_exam_teacher';
    const newConstraintName = 'uq_question_paper_exam_paper_set';

    await queryInterface.removeConstraint(tableName, oldConstraintName).catch(() => {});
    await queryInterface.removeIndex(tableName, oldConstraintName).catch(() => {});

    const indexes = await queryInterface.showIndex(tableName);
    const hasNewIndex = indexes.some((index) => index.name === newConstraintName);

    if (!hasNewIndex) {
      await queryInterface.addConstraint(tableName, {
        fields: ['examId', 'paper_set'],
        type: 'unique',
        name: newConstraintName,
      });
    }
  },

  down: async (queryInterface) => {
    const tableName = 'viaexam_question_papers';
    const oldConstraintName = 'uq_exam_teacher';
    const newConstraintName = 'uq_question_paper_exam_paper_set';

    await queryInterface.removeConstraint(tableName, newConstraintName).catch(() => {});
    await queryInterface.removeIndex(tableName, newConstraintName).catch(() => {});

    const indexes = await queryInterface.showIndex(tableName);
    const hasOldIndex = indexes.some((index) => index.name === oldConstraintName);

    if (!hasOldIndex) {
      await queryInterface.addConstraint(tableName, {
        fields: ['examId', 'teacherId'],
        type: 'unique',
        name: oldConstraintName,
      });
    }
  },
};
