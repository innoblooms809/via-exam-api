"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class StudentProfile extends sequelize_1.Model {
}
StudentProfile.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    userId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    classId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
        references: {
            model: "viaexam_classes",
            key: "classId",
        },
    },
    rollNumber: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    className: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    division: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    academicYear: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    fatherName: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    gender: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    dob: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
    },
    aadhar: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    address: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: false,
    },
    profileUrl: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    isActive: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_student_profiles",
    modelName: "StudentProfile",
    timestamps: true,
});
exports.default = StudentProfile;
