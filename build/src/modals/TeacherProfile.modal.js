"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/modals/TeacherProfile.modal.ts
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class TeacherProfile extends sequelize_1.Model {
}
TeacherProfile.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    employeeID: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    teacherType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    qualification: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    specialization: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    experience: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    joiningDate: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    dob: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    profileUrl: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    isExaminer: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    examinerSince: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_teacher_profiles",
    modelName: "TeacherProfile",
    timestamps: true,
});
exports.default = TeacherProfile;
