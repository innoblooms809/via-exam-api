"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
class Scanner extends sequelize_1.Model {
}
Scanner.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sheetId: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    classId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    section: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    subjectId: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    examType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    rollNo: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    fileName: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    fileBuffer: { type: sequelize_1.DataTypes.BLOB("long"), allowNull: false },
    fileMimeType: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    fileSize: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    status: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
        defaultValue: "Pending",
    },
    isDeleted: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    uploadedBy: { type: sequelize_1.DataTypes.STRING, allowNull: false },
}, {
    sequelize: sequelize_2.sequelize,
    tableName: "viaexam_answer_sheets",
    modelName: "AnswerSheet",
    timestamps: true,
    indexes: [
        // Fast lookup: all sheets for a class+section+subject+exam combo
        {
            name: "viaexam_answer_sheets_institute_id_class_id_section_subject_id_",
            fields: ["instituteId", "classId", "section", "subjectId", "examType"],
        },
        // Unique sheet per student per exam
        {
            unique: true,
            fields: ["instituteId", "classId", "section", "subjectId", "examType", "rollNo"],
            where: { isDeleted: false },
            name: "unique_sheet_per_student_per_exam",
        },
    ],
});
exports.default = Scanner;
