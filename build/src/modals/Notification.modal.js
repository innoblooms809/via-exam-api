"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class Notification extends sequelize_1.Model {
}
Notification.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    notificationId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    userId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    type: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    title: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    message: { type: sequelize_1.DataTypes.TEXT, allowNull: false },
    referenceId: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    isRead: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isDeleted: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_notifications",
    modelName: "Notification",
    timestamps: true,
});
exports.default = Notification;
