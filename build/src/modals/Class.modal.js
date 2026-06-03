"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class Class extends sequelize_1.Model {
}
Class.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    classId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    className: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    isDeleted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    isActive: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_classes",
    modelName: "Class",
    timestamps: true,
    indexes: [
        {
            // Unique: one section per class per year per institute
            unique: true,
            fields: ["instituteId", "className"],
        },
    ],
});
exports.default = Class;
