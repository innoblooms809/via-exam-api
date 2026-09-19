"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class Section extends sequelize_1.Model {
}
Section.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sectionId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    classId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    sectionName: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    classTeacherId: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    isDeleted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    isActive: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_sections",
    modelName: "Section",
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ["classId", "sectionName"],
        },
    ],
});
// Section.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// Section.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });
// // Section belongs to class teacher
// Section.belongsTo(User, {
//   foreignKey: "classTeacherId",
//   targetKey: "userId",
//   as: "classTeacher",
// });
// Section.belongsTo(User, {
//   foreignKey: "classTeacherId",
//   targetKey: "userId",
//   as: "classTeacher",
// });
exports.default = Section;
