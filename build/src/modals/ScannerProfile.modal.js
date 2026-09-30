"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class ScannerProfile extends sequelize_1.Model {
}
ScannerProfile.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    address: { type: sequelize_1.DataTypes.TEXT, allowNull: true, defaultValue: null },
    dob: { type: sequelize_1.DataTypes.DATE, allowNull: true, defaultValue: null },
    gender: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    aadhar: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
    profileUrl: { type: sequelize_1.DataTypes.STRING, allowNull: true, defaultValue: null },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_scanner_profiles",
    modelName: "ScannerProfile",
    timestamps: true,
});
exports.default = ScannerProfile;
