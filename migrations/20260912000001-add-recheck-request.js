'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('viaexam_recheck_requests', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      requestId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      studentId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'viaexam_users',
          key: 'userId',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      instituteId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'viaexam_institutes',
          key: 'instituteId',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      examId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'viaexam_exams',
          key: 'examId',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      evaluationId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'viaexam_ai_evaluations',
          key: 'evaluationId',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      subjectId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'viaexam_subjects',
          key: 'subjectId',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('Pending', 'Under Review', 'Approved', 'Rejected', 'Completed'),
        allowNull: false,
        defaultValue: 'Pending',
      },
      reviewedBy: {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'viaexam_users',
          key: 'userId',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reviewedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('viaexam_recheck_requests', ['studentId'], {
      name: 'viaexam_recheck_requests_student_id_index'
    });

    await queryInterface.addIndex('viaexam_recheck_requests', ['instituteId'], {
      name: 'viaexam_recheck_requests_institute_id_index'
    });

    await queryInterface.addIndex('viaexam_recheck_requests', ['examId'], {
      name: 'viaexam_recheck_requests_exam_id_index'
    });

    await queryInterface.addIndex('viaexam_recheck_requests', ['evaluationId'], {
      name: 'viaexam_recheck_requests_evaluation_id_index'
    });

    await queryInterface.addIndex('viaexam_recheck_requests', ['status'], {
      name: 'viaexam_recheck_requests_status_index'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('viaexam_recheck_requests');
  }
};