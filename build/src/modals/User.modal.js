"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize"); // same import as your boilerplate
// ─── Model ───────────────────────────────────────────────────────────────────
class User extends sequelize_1.Model {
    // Helper: is the account locked?
    isLocked() {
        return !!(this.lockedUntil && this.lockedUntil > new Date());
    }
}
User.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    userId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    userName: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    emailId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    phoneNumber: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    roleId: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
    },
    instituteId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    status: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1, // matches your boilerplate (1 = active)
    },
    loginAttempts: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    lockedUntil: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
    lastLoginAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
    refreshToken: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
    },
    isDeleted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_users",
    modelName: "User",
    timestamps: true,
    //     indexes: [
    //   {
    //     unique: true,
    //     fields: ["emailId"],
    //   },
    //   {
    //     unique: true,
    //     fields: ["phoneNumber"],
    //   },
    // ],
});
// Association — matches your existing pattern: User.belongsTo(Role, ...)
//  User.hasMany(Access, { foreignKey: 'roleId', as: 'permissions' })
// User.belongsTo(Role, { foreignKey: "roleId", as: "role" });
// //  One user has one teacher profile
// User.hasOne(TeacherProfile, {
//   foreignKey: "userId",
//   sourceKey:  "userId",
//   as:         "teacherProfile",
// });
// User.hasOne(StudentProfile, {
//   foreignKey: "userId",
//   sourceKey:  "userId",
//   as:         "studentProfile",
// });
// StudentProfile.belongsTo(User, {
//   foreignKey: "userId",
//   targetKey:  "userId",
//   as:         "user",
// });
exports.default = User;
