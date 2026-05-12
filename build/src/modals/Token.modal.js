"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize"); // Assuming you have a sequelize instance
class Token extends sequelize_1.Model {
}
Token.init({
    token: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false
    },
    expires: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false
    },
    type: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true
    },
    blacklisted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: true
    },
    uuid: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true
    }
}, {
    sequelize: sequelize_2.sequelize,
    modelName: 'Token',
    timestamps: true,
    tableName: 'tokens',
    underscored: true,
    paranoid: true // If you want soft deletes (similar to Mongoose's `deletedAt`)
});
exports.default = Token;
