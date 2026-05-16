"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize"); // Assuming you have sequelize instance
const Role_modal_1 = __importDefault(require("./Role.modal")); // Import the Role model
class Access extends sequelize_1.Model {
}
Access.init({
    moduleName: {
        type: sequelize_1.DataTypes.STRING(100),
        allowNull: false,
    },
    create: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
    },
    edit: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
    },
    delete: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
    },
    view: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
    },
    roleId: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: Role_modal_1.default,
            key: 'id',
        },
    }
}, {
    sequelize: sequelize_2.sequelize,
    tableName: 'access',
    timestamps: false,
});
exports.default = Access;
