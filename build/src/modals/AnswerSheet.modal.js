"use strict";
// import { DataTypes, Model, Optional } from "sequelize";
// import { sequelize } from "../config/sequelize";
// // Each question has one answer entry
// interface AnswerEntry {
//   questionId:     string;
//   answer:         string;
//   keywords:       string;
//   marksScheme:    string;
//   notes:          string;
//   lang:           string;
//   diagramDataUrl: string | null;
// }
// interface AnswerSheetAttributes {
//   id:             number;
//   answerSheetId:  string;
//   examId:         string;       // FK → Exam
//   paperId:        string;       // FK → QuestionPaper
//   teacherId:      string;       // FK → User (teacher)
//   instituteId:    string;       // FK → Institute
//   answers:        AnswerEntry[]; // JSON array of all answers
//   status:         string;       // Draft, Submitted, Approved, Rejected
//   rejectionNote:  string | null;
//   submittedAt:    Date | null;
//   reviewedAt:     Date | null;
//   reviewedBy:     string | null;
//   isDeleted:      boolean;
//   createdAt?:     Date;
//   updatedAt?:     Date;
// }
// interface AnswerSheetCreationAttributes extends Optional <
//   AnswerSheetAttributes,
//   | "id"
//   | "answerSheetId"
//   | "status"
//   | "rejectionNote"
//   | "submittedAt"
//   | "reviewedAt"
//   | "reviewedBy"
//   | "isDeleted"
// > {}
// class AnswerSheet extends Model
//   AnswerSheetAttributes,
//   AnswerSheetCreationAttributes
// > {
//   public id!:             number;
//   public answerSheetId!:  string;
//   public examId!:         string;
//   public paperId!:        string;
//   public teacherId!:      string;
//   public instituteId!:    string;
//   public answers!:        AnswerEntry[];
//   public status!:         string;
//   public rejectionNote!:  string | null;
//   public submittedAt!:    Date | null;
//   public reviewedAt!:     Date | null;
//   public reviewedBy!:     string | null;
//   public isDeleted!:      boolean;
//   public readonly createdAt!: Date;
//   public readonly updatedAt!: Date;
// }
// AnswerSheet.init(
//   {
//     id:             { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
//     answerSheetId:  { type: DataTypes.STRING,  allowNull: false, unique: true },
//     examId:         { type: DataTypes.STRING,  allowNull: false },
//     paperId:        { type: DataTypes.STRING,  allowNull: false },
//     teacherId:      { type: DataTypes.STRING,  allowNull: false },
//     instituteId:    { type: DataTypes.STRING,  allowNull: false },
//     answers:        {
//       type:      DataTypes.JSONB,  // ← stores entire answers array as JSON
//       allowNull: false,
//       defaultValue: [],
//     },
//     status:         { type: DataTypes.STRING,  allowNull: false, defaultValue: "Draft" },
//     rejectionNote:  { type: DataTypes.TEXT,    allowNull: true, defaultValue: null },
//     submittedAt:    { type: DataTypes.DATE,    allowNull: true, defaultValue: null },
//     reviewedAt:     { type: DataTypes.DATE,    allowNull: true, defaultValue: null },
//     reviewedBy:     { type: DataTypes.STRING,  allowNull: true, defaultValue: null },
//     isDeleted:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
//   },
//   {
//     sequelize,
//     tableName: "viaexam_answer_sheets",
//     modelName: "AnswerSheet",
//     timestamps: true,
//   }
// );
// export default AnswerSheet;
