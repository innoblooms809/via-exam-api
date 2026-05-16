"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
// ─────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────
class QuestionPaper extends sequelize_1.Model {
}
QuestionPaper.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    paperId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    examId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    teacherId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    // Stored as JSON — Sequelize handles serialization automatically
    content: {
        type: sequelize_1.DataTypes.JSON,
        allowNull: false,
    },
    status: {
        type: sequelize_1.DataTypes.ENUM("Draft", "Submitted", "Approved", "Rejected"),
        allowNull: false,
        defaultValue: "Draft",
    },
    rejectionNote: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
    },
    submittedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
    approvedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
    rejectedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_question_papers",
    modelName: "QuestionPaper",
    timestamps: true,
    indexes: [
        // One paper per exam per teacher
        { unique: true, fields: ["examId", "teacherId"], name: "uq_exam_teacher" },
        // Examiner queue — fast lookup by instituteId + status
        { fields: ["instituteId", "status"], name: "idx_qp_institute_status" },
        // Teacher's own papers
        { fields: ["teacherId", "status"], name: "idx_qp_teacher_status" },
    ],
});
// ─────────────────────────────────────────────────────────────────
// Associations
// ─────────────────────────────────────────────────────────────────
// Paper belongs to the teacher (User) who wrote it
// QuestionPaper.belongsTo(User, {
//   foreignKey: "teacherId",
//   targetKey: "userId",
//   as: "teacher",
// });
// Paper belongs to the exam it was created for
// QuestionPaper.belongsTo(Exam, {
//   foreignKey: "examId",
//   targetKey: "examId",
//   as: "exam",
// });
// Exam can have one question paper
// Exam.hasOne(QuestionPaper, {
//   foreignKey: "examId",
//   sourceKey: "examId",
//   as: "questionPaper",
// });
exports.default = QuestionPaper;
