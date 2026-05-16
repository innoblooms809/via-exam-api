"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
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
// Session.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
exports.default = Session;
