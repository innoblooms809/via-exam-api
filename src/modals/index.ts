import User from "./User.modal";
import Role from "./Role.modal";
import Access from "./Access.modal";
import TeacherProfile from "./TeacherProfile.modal";
import StudentProfile from "./Student.modal";
import Institute from "./Institute.modal";
import Class from "./Class.modal";
import Section from "./Section.modal";
import Subject from "./Subject.modal";
import Exam from "./Exam.modal";
import Session from "./Session.modal";

// ROLE ↔ ACCESS
// ═══════════════════════════════════════════════════════════════
// ROLE ↔ ACCESS
// ═══════════════════════════════════════════════════════════════
Role.hasMany(Access, { foreignKey: "roleId", as: "permissions" });
Access.belongsTo(Role, { foreignKey: "roleId", as: "role" });

// USER ↔ ROLE
// ═══════════════════════════════════════════════════════════════
// USER ↔ ROLE
// ═══════════════════════════════════════════════════════════════
User.belongsTo(Role, { foreignKey: "roleId", as: "role" });
Role.hasMany(User, { foreignKey: "roleId", as: "users" });

// USER ↔ INSTITUTE
// ═══════════════════════════════════════════════════════════════
// USER ↔ INSTITUTE
// ═══════════════════════════════════════════════════════════════
Institute.hasMany(User, {
  foreignKey: "instituteId",
  sourceKey:  "instituteId",
  as:         "users",
});
User.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey:  "instituteId",
  as:         "institute",
});


// USER ↔ TEACHER PROFILE
// ═══════════════════════════════════════════════════════════════
// USER ↔ TEACHER PROFILE
// ═══════════════════════════════════════════════════════════════
User.hasOne(TeacherProfile, {
  foreignKey: "userId",
  sourceKey:  "userId",
  as:         "teacherProfile",
});
TeacherProfile.belongsTo(User, {
  foreignKey: "userId",
  targetKey:  "userId",
  as:         "user",
});

// ═══════════════════════════════════════════════════════════════
// USER ↔ STUDENT PROFILE
// ═══════════════════════════════════════════════════════════════
User.hasOne(StudentProfile, {
  foreignKey: "userId",
  sourceKey:  "userId",
  as:         "studentProfile",
});
StudentProfile.belongsTo(User, {
  foreignKey: "userId",
  targetKey:  "userId",
  as:         "user",
});


// ═══════════════════════════════════════
// INSTITUTE ↔ SESSION
// ═══════════════════════════════════════
Institute.hasMany(Session, {
  foreignKey: "instituteId",
  sourceKey:  "instituteId",
  as:         "sessions",
});
Session.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey:  "instituteId",
  as:         "institute",
});

// ═══════════════════════════════════════
// SESSION ↔ EXAM
// ═══════════════════════════════════════
Exam.belongsTo(Session, {
  foreignKey: "sessionId",
  targetKey: "sessionId",
  as: "session",
});

// ═══════════════════════════════════════════════════════════════
// INSTITUTE ↔ CLASS
// ═══════════════════════════════════════════════════════════════
Institute.hasMany(Class, {
  foreignKey: "instituteId",
  sourceKey:  "instituteId",
  as:         "classes",
});
Class.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey:  "instituteId",
  as:         "institute",
});


// ═══════════════════════════════════════════════════════════════
// INSTITUTE ↔ EXAM (direct — for easy querying all institute exams)
// ═══════════════════════════════════════════════════════════════
Institute.hasMany(Exam, {
  foreignKey: "instituteId",
  sourceKey:  "instituteId",
  as:         "exams",
});
Exam.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey:  "instituteId",
  as:         "institute",
});


// / ═══════════════════════════════════════════════════════════════
// CLASS ↔ CLASS TEACHER (User)
// ═══════════════════════════════════════════════════════════════
Class.belongsTo(User, {
  foreignKey: "classTeacherId",
  targetKey:  "userId",
  as:         "classTeacher",
});



// ═══════════════════════════════════════════════════════════════
// CLASS ↔ SECTION
// ═══════════════════════════════════════════════════════════════
Class.hasMany(Section, {
  foreignKey: "classId",
  sourceKey:  "classId",
  as:         "sections",
});
Section.belongsTo(Class, {
  foreignKey: "classId",
  targetKey:  "classId",
  as:         "class",
});


// ═══════════════════════════════════════════════════════════════
// CLASS ↔ SUBJECT
// ═══════════════════════════════════════════════════════════════
Class.hasMany(Subject, {
  foreignKey: "classId",
  sourceKey:  "classId",
  as:         "subjects",
});
Subject.belongsTo(Class, {
  foreignKey: "classId",
  targetKey:  "classId",
  as:         "class",
});



// ═══════════════════════════════════════════════════════════════
// CLASS ↔ EXAM
// ═══════════════════════════════════════════════════════════════
Class.hasMany(Exam, {
  foreignKey: "classId",
  sourceKey:  "classId",
  as:         "exams",
});
Exam.belongsTo(Class, {
  foreignKey: "classId",
  targetKey:  "classId",
  as:         "class",
});


// ═══════════════════════════════════════════════════════════════
// SECTION ↔ INSTITUTE (direct link for easy querying)
// ═══════════════════════════════════════════════════════════════
Institute.hasMany(Section, {
  foreignKey: "instituteId",
  sourceKey:  "instituteId",
  as:         "sections",
});
Section.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey:  "instituteId",
  as:         "institute",
});


// ═══════════════════════════════════════════════════════════════
// SECTION ↔ CLASS TEACHER (User)
// ═══════════════════════════════════════════════════════════════
Section.belongsTo(User, {
  foreignKey: "classTeacherId",
  targetKey:  "userId",
  as:         "classTeacher",
});


// ═══════════════════════════════════════════════════════════════
// SECTION ↔ SUBJECT
// ═══════════════════════════════════════════════════════════════
Section.hasMany(Subject, {
  foreignKey: "sectionId",
  sourceKey:  "sectionId",
  as:         "subjects",
});
Subject.belongsTo(Section, {
  foreignKey: "sectionId",
  targetKey:  "sectionId",
  as:         "section",
});


// ═══════════════════════════════════════════════════════════════
// SECTION ↔ EXAM
// ═══════════════════════════════════════════════════════════════
Section.hasMany(Exam, {
  foreignKey: "sectionId",
  sourceKey:  "sectionId",
  as:         "exams",
});
Exam.belongsTo(Section, {
  foreignKey: "sectionId",
  targetKey:  "sectionId",
  as:         "section",
});


// ═══════════════════════════════════════════════════════════════
// SUBJECT ↔ INSTITUTE (direct link)
// ═══════════════════════════════════════════════════════════════
Institute.hasMany(Subject, {
  foreignKey: "instituteId",
  sourceKey:  "instituteId",
  as:         "subjects",
});
Subject.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey:  "instituteId",
  as:         "institute",
});

// ═══════════════════════════════════════════════════════════════
// SUBJECT ↔ TEACHER (User)
// ═══════════════════════════════════════════════════════════════
Subject.belongsTo(User, {
  foreignKey: "teacherId",
  targetKey:  "userId",
  as:         "teacher",
});
User.hasMany(Subject, {
  foreignKey: "teacherId",
  sourceKey:  "userId",
  as:         "teachingSubjects",
});


// ═══════════════════════════════════════════════════════════════
// SUBJECT ↔ EXAM
// ═══════════════════════════════════════════════════════════════
Subject.hasMany(Exam, {
  foreignKey: "subjectId",
  sourceKey:  "subjectId",
  as:         "exams",
});
Exam.belongsTo(Subject, {
  foreignKey: "subjectId",
  targetKey: "subjectId",
  as: "examSubject",
});

// ═══════════════════════════════════════════════════════════════
// EXAM ↔ ASSIGNED TEACHER (User)
// ═══════════════════════════════════════════════════════════════
User.hasMany(Exam, {
  foreignKey: "assignedTeacherId",
  sourceKey:  "userId",
  as:         "assignedExams",
});
Exam.belongsTo(User, {
  foreignKey: "assignedTeacherId",
  targetKey:  "userId",
  as:         "assignedTeacher",
});


// ═══════════════════════════════════════════════════════════════
// STUDENT PROFILE ↔ CLASS + SECTION (for filtering students by class)
// ═══════════════════════════════════════════════════════════════
Class.hasMany(StudentProfile, {
  foreignKey: "classId",
  sourceKey:  "classId",
  as:         "students",
});
StudentProfile.belongsTo(Class, {
  foreignKey: "classId",
  targetKey:  "classId",
  as:         "class",
});

Section.hasMany(StudentProfile, {
  foreignKey: "sectionId",
  sourceKey:  "sectionId",
  as:         "students",
});
StudentProfile.belongsTo(Section, {
  foreignKey: "sectionId",
  targetKey:  "sectionId",
  as:         "section",
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