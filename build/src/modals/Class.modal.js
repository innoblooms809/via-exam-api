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
// // Class belongs to Institute
// Class.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// // Class has one class teacher
// // Class.belongsTo(User, {
// //   foreignKey: "classTeacherId",
// //   targetKey: "userId",
// //   as: "classTeacher",
// // });
// // Class has many students
// // Class.hasMany(StudentProfile, {
// //   foreignKey: "classId",
// //   sourceKey: "classId",
// //   as: "students",
// // });
// // Class has many exams
// // Class.hasMany(Exam, {
// //   foreignKey: "classId",
// //   sourceKey: "classId",
// //   as: "exams",
// // });
// // Class.hasMany(Section, { foreignKey: "classId", sourceKey: "classId", as: "sections" });
// // Section.belongsTo(Class, { foreignKey: "classId", targetKey: "classId", as: "class" });
// // Class belongs to Session
// // Class.belongsTo(Session, {
// //   foreignKey: "sessionId",
// //   targetKey: "sessionId",
// //   as: "session",
// // });
// // Class has many Sections
// Class.hasMany(Section, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "sections",
// });
// // Class has many Subjects
// Class.hasMany(Subject, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "subjects",
// });
exports.default = Class;
