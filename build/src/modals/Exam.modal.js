"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class Exam extends sequelize_1.Model {
}
Exam.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    examId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    session: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    year: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examDate: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    classVal: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    subject: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    teacherId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examinerId: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    totalMarks: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    passingMarks: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    duration: { type: sequelize_1.DataTypes.INTEGER, allowNull: true, defaultValue: null },
    instructions: { type: sequelize_1.DataTypes.TEXT, allowNull: true, defaultValue: null },
    status: { type: sequelize_1.DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    isDeleted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_exams",
    modelName: "Exam",
    timestamps: true,
});
exports.default = Exam;
