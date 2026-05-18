"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../../config/sequelize");
// ─────────────────────────────────────
// MODEL
// ─────────────────────────────────────
class QuestionPaperAnswer extends sequelize_1.Model {
}
// ─────────────────────────────────────
// INIT
// ─────────────────────────────────────
QuestionPaperAnswer.init({
    id: {
        type: sequelize_1.DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
    },
    answerId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    paperId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    examId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    teacherId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    paperSet: {
        type: sequelize_1.DataTypes.ENUM("A", "B", "C", "D"),
        allowNull: false,
        defaultValue: "A",
        field: "paper_set",
    },
    answers: {
        type: sequelize_1.DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
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
    tableName: "viaexam_question_paper_answers",
    modelName: "QuestionPaperAnswer",
    timestamps: true,
    paranoid: true,
    indexes: [
        {
            fields: ["paperId"],
        },
        {
            fields: ["teacherId"],
        },
        {
            fields: ["status"],
        },
        {
            unique: true,
            fields: ["paperId", "paper_set"],
        },
    ],
});
exports.default = QuestionPaperAnswer;
