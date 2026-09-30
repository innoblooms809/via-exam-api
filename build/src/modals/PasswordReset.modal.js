"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class PasswordReset extends sequelize_1.Model {
}
PasswordReset.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    otp: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    expiresAt: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    isUsed: { type: sequelize_1.DataTypes.BOOLEAN, defaultValue: false },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_password_resets",
    modelName: "PasswordReset",
    timestamps: true,
});
exports.default = PasswordReset;
