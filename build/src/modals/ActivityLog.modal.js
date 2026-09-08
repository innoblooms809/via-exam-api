"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class ActivityLog extends sequelize_1.Model {
}
ActivityLog.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    eventId: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    userId: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: false,
    },
    role: {
        type: sequelize_1.DataTypes.STRING(50),
        allowNull: false,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: true,
    },
    eventType: {
        type: sequelize_1.DataTypes.STRING(100),
        allowNull: false,
    },
    entityType: {
        type: sequelize_1.DataTypes.STRING(100),
        allowNull: true,
    },
    entityId: {
        type: sequelize_1.DataTypes.STRING(100),
        allowNull: true,
    },
    status: {
        type: sequelize_1.DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "SUCCESS",
    },
    metadata: {
        type: sequelize_1.DataTypes.JSON,
        allowNull: true,
    },
    ipAddress: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: true,
    },
    userAgent: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_activity_logs",
    modelName: "ActivityLog",
    timestamps: true,
    indexes: [
        { fields: ["userId"] },
        { fields: ["instituteId"] },
        { fields: ["eventType"] },
        { fields: ["status"] },
        { fields: ["createdAt"] },
    ],
});
exports.default = ActivityLog;
