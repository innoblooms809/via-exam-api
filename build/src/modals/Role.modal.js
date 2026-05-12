"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize"); // Assuming you have sequelize instance
// import Access from './Access.model';  // Import the Access model
class Role extends sequelize_1.Model {
}
Role.init({
    role: {
        type: sequelize_1.DataTypes.STRING(100),
        allowNull: false,
        unique: true,
    },
    roleDescription: {
        type: sequelize_1.DataTypes.STRING(255),
        allowNull: true,
    }
}, {
    sequelize: sequelize_2.sequelize,
    tableName: 'roles',
    timestamps: false,
});
exports.default = Role;
