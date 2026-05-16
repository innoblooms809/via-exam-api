"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const User_modal_1 = __importDefault(require("./User.modal"));
const Role_modal_1 = __importDefault(require("./Role.modal"));
const Access_modal_1 = __importDefault(require("./Access.modal"));
const TeacherProfile_modal_1 = __importDefault(require("./TeacherProfile.modal"));
const Student_modal_1 = __importDefault(require("./Student.modal"));
const Institute_modal_1 = __importDefault(require("./Institute.modal"));
const Class_modal_1 = __importDefault(require("./Class.modal"));
const Section_modal_1 = __importDefault(require("./Section.modal"));
const Subject_modal_1 = __importDefault(require("./Subject.modal"));
const Exam_modal_1 = __importDefault(require("./Exam.modal"));
const Session_modal_1 = __importDefault(require("./Session.modal"));
// ROLE ↔ ACCESS
// ═══════════════════════════════════════════════════════════════
// ROLE ↔ ACCESS
// ═══════════════════════════════════════════════════════════════
Role_modal_1.default.hasMany(Access_modal_1.default, { foreignKey: "roleId", as: "permissions" });
Access_modal_1.default.belongsTo(Role_modal_1.default, { foreignKey: "roleId", as: "role" });
// USER ↔ ROLE
// ═══════════════════════════════════════════════════════════════
// USER ↔ ROLE
// ═══════════════════════════════════════════════════════════════
User_modal_1.default.belongsTo(Role_modal_1.default, { foreignKey: "roleId", as: "role" });
Role_modal_1.default.hasMany(User_modal_1.default, { foreignKey: "roleId", as: "users" });
// USER ↔ INSTITUTE
// ═══════════════════════════════════════════════════════════════
// USER ↔ INSTITUTE
// ═══════════════════════════════════════════════════════════════
Institute_modal_1.default.hasMany(User_modal_1.default, {
    foreignKey: "instituteId",
    sourceKey: "instituteId",
    as: "users",
});
User_modal_1.default.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// USER ↔ TEACHER PROFILE
// ═══════════════════════════════════════════════════════════════
// USER ↔ TEACHER PROFILE
// ═══════════════════════════════════════════════════════════════
User_modal_1.default.hasOne(TeacherProfile_modal_1.default, {
    foreignKey: "userId",
    sourceKey: "userId",
    as: "teacherProfile",
});
TeacherProfile_modal_1.default.belongsTo(User_modal_1.default, {
    foreignKey: "userId",
    targetKey: "userId",
    as: "user",
});
// ═══════════════════════════════════════════════════════════════
// USER ↔ STUDENT PROFILE
// ═══════════════════════════════════════════════════════════════
User_modal_1.default.hasOne(Student_modal_1.default, {
    foreignKey: "userId",
    sourceKey: "userId",
    as: "studentProfile",
});
Student_modal_1.default.belongsTo(User_modal_1.default, {
    foreignKey: "userId",
    targetKey: "userId",
    as: "user",
});
// ═══════════════════════════════════════
// INSTITUTE ↔ SESSION
// ═══════════════════════════════════════
Institute_modal_1.default.hasMany(Session_modal_1.default, {
    foreignKey: "instituteId",
    sourceKey: "instituteId",
    as: "sessions",
});
Session_modal_1.default.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// ═══════════════════════════════════════
// SESSION ↔ EXAM
// ═══════════════════════════════════════
Exam_modal_1.default.belongsTo(Session_modal_1.default, {
    foreignKey: "sessionId",
    targetKey: "sessionId",
    as: "session",
});
// ═══════════════════════════════════════════════════════════════
// INSTITUTE ↔ CLASS
// ═══════════════════════════════════════════════════════════════
Institute_modal_1.default.hasMany(Class_modal_1.default, {
    foreignKey: "instituteId",
    sourceKey: "instituteId",
    as: "classes",
});
Class_modal_1.default.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// ═══════════════════════════════════════════════════════════════
// INSTITUTE ↔ EXAM (direct — for easy querying all institute exams)
// ═══════════════════════════════════════════════════════════════
Institute_modal_1.default.hasMany(Exam_modal_1.default, {
    foreignKey: "instituteId",
    sourceKey: "instituteId",
    as: "exams",
});
Exam_modal_1.default.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// / ═══════════════════════════════════════════════════════════════
// CLASS ↔ CLASS TEACHER (User)
// ═══════════════════════════════════════════════════════════════
Class_modal_1.default.belongsTo(User_modal_1.default, {
    foreignKey: "classTeacherId",
    targetKey: "userId",
    as: "classTeacher",
});
// ═══════════════════════════════════════════════════════════════
// CLASS ↔ SECTION
// ═══════════════════════════════════════════════════════════════
Class_modal_1.default.hasMany(Section_modal_1.default, {
    foreignKey: "classId",
    sourceKey: "classId",
    as: "sections",
});
Section_modal_1.default.belongsTo(Class_modal_1.default, {
    foreignKey: "classId",
    targetKey: "classId",
    as: "class",
});
// ═══════════════════════════════════════════════════════════════
// CLASS ↔ SUBJECT
// ═══════════════════════════════════════════════════════════════
Class_modal_1.default.hasMany(Subject_modal_1.default, {
    foreignKey: "classId",
    sourceKey: "classId",
    as: "subjects",
});
Subject_modal_1.default.belongsTo(Class_modal_1.default, {
    foreignKey: "classId",
    targetKey: "classId",
    as: "class",
});
// ═══════════════════════════════════════════════════════════════
// CLASS ↔ EXAM
// ═══════════════════════════════════════════════════════════════
Class_modal_1.default.hasMany(Exam_modal_1.default, {
    foreignKey: "classId",
    sourceKey: "classId",
    as: "exams",
});
Exam_modal_1.default.belongsTo(Class_modal_1.default, {
    foreignKey: "classId",
    targetKey: "classId",
    as: "class",
});
// ═══════════════════════════════════════════════════════════════
// SECTION ↔ INSTITUTE (direct link for easy querying)
// ═══════════════════════════════════════════════════════════════
Institute_modal_1.default.hasMany(Section_modal_1.default, {
    foreignKey: "instituteId",
    sourceKey: "instituteId",
    as: "sections",
});
Section_modal_1.default.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// ═══════════════════════════════════════════════════════════════
// SECTION ↔ CLASS TEACHER (User)
// ═══════════════════════════════════════════════════════════════
Section_modal_1.default.belongsTo(User_modal_1.default, {
    foreignKey: "classTeacherId",
    targetKey: "userId",
    as: "classTeacher",
});
// ═══════════════════════════════════════════════════════════════
// SECTION ↔ SUBJECT
// ═══════════════════════════════════════════════════════════════
Section_modal_1.default.hasMany(Subject_modal_1.default, {
    foreignKey: "sectionId",
    sourceKey: "sectionId",
    as: "subjects",
});
Subject_modal_1.default.belongsTo(Section_modal_1.default, {
    foreignKey: "sectionId",
    targetKey: "sectionId",
    as: "section",
});
// ═══════════════════════════════════════════════════════════════
// SECTION ↔ EXAM
// ═══════════════════════════════════════════════════════════════
Section_modal_1.default.hasMany(Exam_modal_1.default, {
    foreignKey: "sectionId",
    sourceKey: "sectionId",
    as: "exams",
});
Exam_modal_1.default.belongsTo(Section_modal_1.default, {
    foreignKey: "sectionId",
    targetKey: "sectionId",
    as: "section",
});
// ═══════════════════════════════════════════════════════════════
// SUBJECT ↔ INSTITUTE (direct link)
// ═══════════════════════════════════════════════════════════════
Institute_modal_1.default.hasMany(Subject_modal_1.default, {
    foreignKey: "instituteId",
    sourceKey: "instituteId",
    as: "subjects",
});
Subject_modal_1.default.belongsTo(Institute_modal_1.default, {
    foreignKey: "instituteId",
    targetKey: "instituteId",
    as: "institute",
});
// ═══════════════════════════════════════════════════════════════
// SUBJECT ↔ TEACHER (User)
// ═══════════════════════════════════════════════════════════════
Subject_modal_1.default.belongsTo(User_modal_1.default, {
    foreignKey: "teacherId",
    targetKey: "userId",
    as: "teacher",
});
User_modal_1.default.hasMany(Subject_modal_1.default, {
    foreignKey: "teacherId",
    sourceKey: "userId",
    as: "teachingSubjects",
});
// ═══════════════════════════════════════════════════════════════
// SUBJECT ↔ EXAM
// ═══════════════════════════════════════════════════════════════
Subject_modal_1.default.hasMany(Exam_modal_1.default, {
    foreignKey: "subjectId",
    sourceKey: "subjectId",
    as: "exams",
});
Exam_modal_1.default.belongsTo(Subject_modal_1.default, {
    foreignKey: "subjectId",
    targetKey: "subjectId",
    as: "examSubject",
});
// ═══════════════════════════════════════════════════════════════
// EXAM ↔ ASSIGNED TEACHER (User)
// ═══════════════════════════════════════════════════════════════
User_modal_1.default.hasMany(Exam_modal_1.default, {
    foreignKey: "assignedTeacherId",
    sourceKey: "userId",
    as: "assignedExams",
});
Exam_modal_1.default.belongsTo(User_modal_1.default, {
    foreignKey: "assignedTeacherId",
    targetKey: "userId",
    as: "assignedTeacher",
});
// ═══════════════════════════════════════════════════════════════
// STUDENT PROFILE ↔ CLASS + SECTION (for filtering students by class)
// ═══════════════════════════════════════════════════════════════
Class_modal_1.default.hasMany(Student_modal_1.default, {
    foreignKey: "classId",
    sourceKey: "classId",
    as: "students",
});
Student_modal_1.default.belongsTo(Class_modal_1.default, {
    foreignKey: "classId",
    targetKey: "classId",
    as: "class",
});
Section_modal_1.default.hasMany(Student_modal_1.default, {
    foreignKey: "sectionId",
    sourceKey: "sectionId",
    as: "students",
});
Student_modal_1.default.belongsTo(Section_modal_1.default, {
    foreignKey: "sectionId",
    targetKey: "sectionId",
    as: "section",
});
// ***************************************
// Institute relations
// Institute.hasMany(Class, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "classes",
// });
// Institute.hasMany(Section, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "sections",
// });
// Institute.hasMany(Subject, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "subjects",
// });
// Institute.hasMany(Exam, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "exams",
// });
// Institute.hasMany(Session, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "sessions",
// });
// // ─── CLASS ↔ INSTITUTE ─────────────────────────────
// Class.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// // ─── CLASS ↔ SECTION ───────────────────────────────
// Class.hasMany(Section, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "sections",
// });
// // ─── CLASS ↔ SUBJECT ───────────────────────────────
// Class.hasMany(Subject, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "subjects",
// });
// // ─── CLASS ↔ CLASS TEACHER ─────────────────────────
// Class.belongsTo(User, {
//   foreignKey: "classTeacherId",
//   targetKey: "userId",
//   as: "classTeacher",
// });
// // ─── CLASS ↔ EXAMS ─────────────────────────────────
// Class.hasMany(Exam, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "exams",
// });
// // Session → Institute
// Session.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// // Subject relations
// Subject.belongsTo(User, {
//   foreignKey: "teacherId",
//   targetKey: "userId",
//   as: "teacher",
// });
// Subject.hasMany(Exam, {
//   foreignKey: "subjectId",
//   sourceKey: "subjectId",
//   as: "exams",
// });
// Subject.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// Subject.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });
// // Section relations
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
// // exam relations
// Exam.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// // Exam belongs to Subject
// Exam.belongsTo(Subject, {
//   foreignKey: "subjectId",
//   targetKey: "subjectId",
//   as: "subject",
// });
// Exam.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });
// Exam.belongsTo(User, {
//   foreignKey: "assignedTeacherId",
//   targetKey: "userId",
//   as: "teacher",
// });
// // // Exam has many Question Papers
// // Exam.hasMany(QuestionPaper, {
// //   foreignKey: "examId",
// //   sourceKey: "examId",
// //   as: "questionPapers",
// // });
