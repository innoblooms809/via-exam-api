"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class Subject extends sequelize_1.Model {
}
Subject.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subjectId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    classId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    subjectName: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    subjectCode: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null, unique: true, },
    teacherId: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    totalMarks: { type: sequelize_1.DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    passingMarks: { type: sequelize_1.DataTypes.INTEGER, allowNull: false, },
    isActive: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isDeleted: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_subjects",
    modelName: "Subject",
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ["classId", "subjectName"],
        },
    ],
});
// Subject.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// Subject.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });
// Subject.belongsTo(User, {
//   foreignKey: "teacherId",
//   targetKey: "userId",
//   as: "teacher",
// });
// Subject.hasMany(Exam, {
//   foreignKey: "subjectId",
//   sourceKey: "subjectId",
//   as: "exams",
// });
exports.default = Subject;
