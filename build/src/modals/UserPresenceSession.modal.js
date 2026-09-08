"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class UserPresenceSession extends sequelize_1.Model {
}
UserPresenceSession.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    userId: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    role: {
        type: sequelize_1.DataTypes.STRING(50),
        allowNull: false,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: true,
    },
    presenceStatus: {
        type: sequelize_1.DataTypes.ENUM("ONLINE", "IDLE", "OFFLINE", "BLOCKED"),
        allowNull: false,
        defaultValue: "OFFLINE",
    },
    currentActivity: {
        type: sequelize_1.DataTypes.STRING(255),
        allowNull: true,
        defaultValue: "Active in Portal",
    },
    lastActivityAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize_1.DataTypes.NOW,
    },
    lastLoginAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
    },
    lastLogoutAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
    },
    deviceInfo: {
        type: sequelize_1.DataTypes.STRING(255),
        allowNull: true,
    },
    ipAddress: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: true,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_user_presence_sessions",
    modelName: "UserPresenceSession",
    timestamps: true,
    indexes: [
        { fields: ["userId"] },
        { fields: ["instituteId"] },
        { fields: ["presenceStatus"] },
        { fields: ["lastActivityAt"] },
    ],
});
exports.default = UserPresenceSession;
