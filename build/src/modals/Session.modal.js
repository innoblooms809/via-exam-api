"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
const Institute_modal_1 = __importDefault(require("./Institute.modal"));
const Class_modal_1 = __importDefault(require("./Class.modal"));
class Session extends sequelize_1.Model {
}
Session.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sessionId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    sessionName: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    startDate: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    endDate: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    isActive: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isDeleted: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_sessions",
    modelName: "Session",
    timestamps: true,
    indexes: [
        {
            // One session name per institute
            unique: true,
            fields: ["instituteId", "sessionName"],
        },
    ],
});
// ─── ASSOCIATIONS ─────────────────────────────────────────
Session.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// Session has many Classes
Session.hasMany(Class_modal_1.default, {
    foreignKey: "sessionId",
    sourceKey: "sessionId",
    as: "classes",
});
exports.default = Session;
