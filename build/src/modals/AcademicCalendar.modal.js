"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
const uuid_1 = require("uuid");
class AcademicCalendar extends sequelize_1.Model {
}
AcademicCalendar.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    eventId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
        defaultValue: () => `EVT-${(0, uuid_1.v4)().substring(0, 8).toUpperCase()}`
    },
    title: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    description: { type: sequelize_1.DataTypes.TEXT, allowNull: true },
    eventDate: { type: sequelize_1.DataTypes.DATEONLY, allowNull: false },
    startTime: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    endTime: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    eventType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    color: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    createdBy: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    isDeleted: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sessionId: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    classId: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    className: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    subjectId: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    subjectName: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    duration: { type: sequelize_1.DataTypes.STRING, allowNull: true }
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_academic_calendar",
    modelName: "AcademicCalendar",
    timestamps: true,
});
exports.default = AcademicCalendar;
