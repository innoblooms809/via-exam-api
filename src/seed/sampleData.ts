import "../config/config";
import { QueryTypes } from "sequelize";
import { sequelize } from "../config/sequelize";
import Access from "../modals/Access.modal";
import Exam from "../modals/Exam.modal";
import Institute from "../modals/Institute.modal";
import QuestionPaper from "../modals/QuestionPaper.modal";
import Role from "../modals/Role.modal";
import StudentProfile from "../modals/Student.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import Token from "../modals/Token.modal";
import User from "../modals/User.modal";
import EncryptPassword from "../utils/encryption";

const passwordPlainText = "Password@123";

const findOrCreateRole = async (role: string, roleDescription: string) => {
  const [record] = await Role.findOrCreate({
    where: { role },
    defaults: { role, roleDescription },
  });

  await record.update({ roleDescription });
  return record;
};

const findOrCreateAccess = async (
  roleId: number,
  moduleName: string,
  permissions: {
    create: boolean;
    edit: boolean;
    delete: boolean;
    view: boolean;
  }
) => {
  const [record] = await Access.findOrCreate({
    where: { roleId, moduleName },
    defaults: { roleId, moduleName, ...permissions },
  });

  await record.update(permissions);
  return record;
};

const upsertById = async (
  model: any,
  where: object,
  data: object
) => {
  const existing = await model.findOne({ where });
  if (existing) {
    await existing.update(data);
    return existing;
  }

  return model.create(data);
};

const seed = async () => {
  await sequelize.authenticate();
  await sequelize.sync({ force: false });

  const [
    superAdminRole,
    instituteAdminRole,
    teacherRole,
    studentRole,
    examinerRole,
  ] = await Promise.all([
    findOrCreateRole("SUPER_ADMIN", "Platform owner with all access"),
    findOrCreateRole("INSTITUTE_ADMIN", "Institute administrator"),
    findOrCreateRole("TEACHER", "Teacher who creates question papers"),
    findOrCreateRole("STUDENT", "Student who appears for exams"),
    findOrCreateRole("EXAMINER", "Teacher who reviews question papers"),
  ]);

  const modules = ["institutes", "users", "exams", "question-papers", "students"];
  for (const moduleName of modules) {
    await findOrCreateAccess(superAdminRole.id, moduleName, {
      create: true,
      edit: true,
      delete: true,
      view: true,
    });
    await findOrCreateAccess(instituteAdminRole.id, moduleName, {
      create: true,
      edit: true,
      delete: false,
      view: true,
    });
    await findOrCreateAccess(teacherRole.id, moduleName, {
      create: moduleName === "question-papers",
      edit: moduleName === "question-papers",
      delete: false,
      view: ["exams", "question-papers"].includes(moduleName),
    });
    await findOrCreateAccess(studentRole.id, moduleName, {
      create: false,
      edit: false,
      delete: false,
      view: ["exams", "question-papers"].includes(moduleName),
    });
    await findOrCreateAccess(examinerRole.id, moduleName, {
      create: false,
      edit: moduleName === "question-papers",
      delete: false,
      view: ["exams", "question-papers"].includes(moduleName),
    });
  }

  await upsertById(
    Institute,
    { instituteId: "INST-DEMO-001" },
    {
      instituteId: "INST-DEMO-001",
      instituteName: "Via Demo Public School",
      instituteType: "School",
      boardType: "CBSE",
      registrationNumber: "REG-DEMO-2026",
      establishedYear: "2016",
      websiteUrl: "https://demo.viaexam.local",
      slug: "via-demo-public-school",
      contactPersonName: "Ananya Sharma",
      contactEmail: "admin.demo@viaexam.com",
      contactPhone: "9000000001",
      alternatePhone: "9000000002",
      addressLine1: "12 Knowledge Park",
      addressLine2: "Near City Library",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      plan: "TRIAL",
      trialDays: 14,
      trialEndsAt: new Date("2026-05-28T00:00:00.000Z"),
      logoUrl: "/v1/uploads/question-papers/school-logos/demo-school-logo.png",
      bannerUrl: "/v1/uploads/institutes/banners/demo-school-banner.png",
      status: 1,
      isDeleted: false,
    }
  );

  const password = await EncryptPassword.encryptPassword(passwordPlainText);

  await upsertById(
    User,
    { userId: "USER-SUPER-001" },
    {
      userId: "USER-SUPER-001",
      userName: "Super Admin",
      emailId: "superadmin.seed@viaexam.com",
      phoneNumber: "9000000010",
      password,
      roleId: superAdminRole.id,
      instituteId: null,
      status: 1,
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      refreshToken: null,
    }
  );

  await upsertById(
    User,
    { userId: "USER-ADMIN-001" },
    {
      userId: "USER-ADMIN-001",
      userName: "Institute Admin",
      emailId: "admin.seed@viaexam.com",
      phoneNumber: "9000000011",
      password,
      roleId: instituteAdminRole.id,
      instituteId: "INST-DEMO-001",
      status: 1,
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      refreshToken: null,
    }
  );

  await upsertById(
    User,
    { userId: "USER-TEACHER-001" },
    {
      userId: "USER-TEACHER-001",
      userName: "Meera Iyer",
      emailId: "teacher.seed@viaexam.com",
      phoneNumber: "9000000012",
      password,
      roleId: teacherRole.id,
      instituteId: "INST-DEMO-001",
      status: 1,
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      refreshToken: null,
    }
  );

  await upsertById(
    User,
    { userId: "USER-EXAMINER-001" },
    {
      userId: "USER-EXAMINER-001",
      userName: "Rahul Verma",
      emailId: "examiner.seed@viaexam.com",
      phoneNumber: "9000000013",
      password,
      roleId: examinerRole.id,
      instituteId: "INST-DEMO-001",
      status: 1,
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      refreshToken: null,
    }
  );

  await upsertById(
    User,
    { userId: "USER-STUDENT-001" },
    {
      userId: "USER-STUDENT-001",
      userName: "Aarav Patel",
      emailId: "student.seed@viaexam.com",
      phoneNumber: "9000000014",
      password,
      roleId: studentRole.id,
      instituteId: "INST-DEMO-001",
      status: 1,
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      refreshToken: null,
    }
  );

  await upsertById(
    TeacherProfile,
    { userId: "USER-TEACHER-001" },
    {
      userId: "USER-TEACHER-001",
      instituteId: "INST-DEMO-001",
      employeeID: "EMP-T-001",
      teacherType: "Full Time",
      qualification: "M.Sc Mathematics, B.Ed",
      specialization: "Algebra",
      experience: "8 years",
      joiningDate: new Date("2021-06-01T00:00:00.000Z"),
      dob: new Date("1988-04-12T00:00:00.000Z"),
      profileUrl: "/v1/uploads/profiles/teacher-demo.png",
      isExaminer: false,
      examinerSince: null,
    }
  );

  await upsertById(
    TeacherProfile,
    { userId: "USER-EXAMINER-001" },
    {
      userId: "USER-EXAMINER-001",
      instituteId: "INST-DEMO-001",
      employeeID: "EMP-E-001",
      teacherType: "Full Time",
      qualification: "M.A English, B.Ed",
      specialization: "Literature",
      experience: "11 years",
      joiningDate: new Date("2019-06-01T00:00:00.000Z"),
      dob: new Date("1984-09-18T00:00:00.000Z"),
      profileUrl: "/v1/uploads/profiles/examiner-demo.png",
      isExaminer: true,
      examinerSince: new Date("2024-04-01T00:00:00.000Z"),
    }
  );

  await upsertById(
    StudentProfile,
    { userId: "USER-STUDENT-001" },
    {
      userId: "USER-STUDENT-001",
      instituteId: "INST-DEMO-001",
      rollNumber: "10A-001",
      className: "Class 10",
      division: "A",
      academicYear: "2026-27",
      fatherName: "Vikram Patel",
      gender: "Male",
      dob: new Date("2011-02-10T00:00:00.000Z"),
      aadhar: "123456789012",
      address: "34 Learning Street, Pune",
      profileUrl: "/v1/uploads/profiles/student-demo.png",
      isActive: true,
    }
  );

  await upsertById(
    Exam,
    { examId: "EXAM-DEMO-MATH-001" },
    {
      examId: "EXAM-DEMO-MATH-001",
      instituteId: "INST-DEMO-001",
      session: "2026-27",
      year: "2026",
      examType: "Mid Term",
      examDate: new Date("2026-08-20T04:30:00.000Z"),
      classVal: "10",
      subject: "Mathematics",
      teacherId: "USER-TEACHER-001",
      examinerId: "USER-EXAMINER-001",
      totalMarks: 80,
      passingMarks: 28,
      duration: 180,
      instructions: "Attempt all questions. Draw diagrams where required.",
      status: "Draft",
      isDeleted: false,
    }
  );

  await upsertById(
    QuestionPaper,
    { paperId: "PAPER-DEMO-MATH-A" },
    {
      paperId: "PAPER-DEMO-MATH-A",
      instituteId: "INST-DEMO-001",
      examId: "EXAM-DEMO-MATH-001",
      teacherId: "USER-TEACHER-001",
      paperSet: "A",
      content: {
        schoolLogo: "/v1/uploads/question-papers/school-logos/demo-school-logo.png",
        diagramUrls: [
          "/v1/uploads/question-papers/diagrams/triangle-demo.png",
          "/v1/uploads/question-papers/diagrams/circle-demo.png",
        ],
        title: "Mathematics Mid-Term Question Paper",
        totalMarks: 80,
        durationMinutes: 180,
        sections: [
          {
            name: "Section A",
            instructions: "Answer all short questions.",
            questions: [
              {
                questionId: "Q1",
                type: "short-answer",
                marks: 2,
                text: "Find the value of x if 2x + 5 = 17.",
                answer: "6",
                diagramUrl: null,
              },
              {
                questionId: "Q2",
                type: "short-answer",
                marks: 3,
                text: "State the Pythagoras theorem.",
                answer: "In a right triangle, a^2 + b^2 = c^2.",
                diagramUrl: "/v1/uploads/question-papers/diagrams/triangle-demo.png",
              },
            ],
          },
        ],
      },
      status: "DRAFT",
      rejectionNote: null,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
    }
  );

  await upsertById(
    Token,
    { uuid: "USER-STUDENT-001", type: "VERIFY_EMAIL" },
    {
      token: "seed-verify-email-token",
      expires: "2026-12-31T23:59:59.000Z",
      type: "VERIFY_EMAIL",
      blacklisted: false,
      uuid: "USER-STUDENT-001",
    }
  );

  const tables = await sequelize.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name`,
    { type: QueryTypes.SELECT }
  );

  console.log("Seed complete.");
  console.log(`Default password for seeded users: ${passwordPlainText}`);
  console.log("Current public tables:");
  tables.forEach((table) => console.log(`- ${table.table_name}`));
};

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
