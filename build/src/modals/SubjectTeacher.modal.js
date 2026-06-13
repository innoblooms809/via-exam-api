"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class SubjectTeacher extends sequelize_1.Model {
}
SubjectTeacher.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subjectId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    teacherId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_subject_teachers",
    modelName: "SubjectTeacher",
    timestamps: true,
});
exports.default = SubjectTeacher;
