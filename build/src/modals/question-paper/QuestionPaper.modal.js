"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../../config/sequelize");
// ─────────────────────────────────────────────────────────────────
// Model Class
// ─────────────────────────────────────────────────────────────────
class QuestionPaper extends sequelize_1.Model {
}
// ─────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────
QuestionPaper.init({
    id: {
        type: sequelize_1.DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
    },
    paperId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        references: {
            model: "viaexam_institutes",
            key: "instituteId",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    examId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        references: {
            model: "viaexam_exams",
            key: "examId",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    teacherId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        references: {
            model: "viaexam_users",
            key: "userId",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
    },
    paperSet: {
        type: sequelize_1.DataTypes.ENUM("A", "B", "C", "D"),
        allowNull: false,
        defaultValue: "A",
        field: "paper_set",
    },
    content: {
        type: sequelize_1.DataTypes.JSONB,
        allowNull: false,
        validate: {
            notEmpty: true,
        },
    },
    status: {
        type: sequelize_1.DataTypes.ENUM("DRAFT", "SUBMITTED", "APPROVED", "REJECTED"),
        allowNull: false,
        defaultValue: "DRAFT",
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
    paranoid: true,
    indexes: [
        {
            fields: ["instituteId"],
            name: "idx_qp_institute",
        },
        {
            fields: ["teacherId"],
            name: "idx_qp_teacher",
        },
        {
            fields: ["status"],
            name: "idx_qp_status",
        },
        {
            fields: ["examId", "status"],
            name: "idx_qp_exam_status",
        },
        {
            fields: ["examId", "paper_set"],
            name: "uq_question_paper_exam_paper_set",
            unique: true,
        },
    ],
});
exports.default = QuestionPaper;
