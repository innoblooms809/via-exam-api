"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class AIEvaluation extends sequelize_1.Model {
}
AIEvaluation.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    evaluationId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    sheetId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    studentId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    classId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    section: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    subjectId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    totalScore: { type: sequelize_1.DataTypes.FLOAT, allowNull: true },
    feedback: { type: sequelize_1.DataTypes.TEXT, allowNull: true },
    evaluations: { type: sequelize_1.DataTypes.JSONB, allowNull: true },
    studentAnsOcr: { type: sequelize_1.DataTypes.TEXT, allowNull: true },
    standardAnsOcr: { type: sequelize_1.DataTypes.TEXT, allowNull: true },
    questionOcr: { type: sequelize_1.DataTypes.TEXT, allowNull: true },
    status: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        defaultValue: "Pending",
    },
    error: { type: sequelize_1.DataTypes.TEXT, allowNull: true },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_ai_evaluations",
    modelName: "AIEvaluation",
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ["sheetId"],
            name: "unique_evaluation_per_sheet",
        },
        {
            fields: ["classId", "section", "subjectId", "examType"],
            name: "ai_evaluations_lookup_idx",
        },
    ],
});
exports.default = AIEvaluation;
