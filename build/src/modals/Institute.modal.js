"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
// ─── Model ───────────────────────────────────────────────────────────────────
class Institute extends sequelize_1.Model {
}
Institute.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    instituteName: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    instituteType: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    boardType: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    registrationNumber: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    establishedYear: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    websiteUrl: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    slug: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    contactPersonName: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    contactEmail: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    contactPhone: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    alternatePhone: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    addressLine1: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    addressLine2: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    city: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    state: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    pincode: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    plan: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    trialDays: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 14,
    },
    trialEndsAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
    logoUrl: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    bannerUrl: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    status: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    isDeleted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_institutes",
    modelName: "Institute",
    timestamps: true,
});
// One institute has many users
// Institute.hasMany(User, {
//   foreignKey: "instituteId",  // ← string FK not integer
//   sourceKey:  "instituteId",  // ← links via instituteId not id
//   as: "users",
// });
// User belongs to institute
// User.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey:  "instituteId",  // ← links via instituteId not id
//   as: "institute",
// });
exports.default = Institute;
