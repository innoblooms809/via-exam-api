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
    classId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
        references: {
            model: "viaexam_classes",
            key: "classId",
        },
    },
    sessionId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    subjectId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
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
// Exam.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// // Exam belongs to Subject
// Exam.belongsTo(Subject, {
//   foreignKey: "subjectId",
//   targetKey: "subjectId",
//   as: "subject",
// });
// Exam.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });
// Exam.belongsTo(User, {
//   foreignKey: "assignedTeacherId",
//   targetKey: "userId",
//   as: "teacher",
// });
// // Exam has many Question Papers
// Exam.hasMany(QuestionPaper, {
//   foreignKey: "examId",
//   sourceKey: "examId",
//   as: "questionPapers",
// });
// OPTION A (recommended)
exports.default = Exam;
