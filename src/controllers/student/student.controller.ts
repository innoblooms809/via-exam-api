import httpStatus from "http-status";
import { Response } from "express";
import StudentService from "../../services/student/student.service";
import { getTeacherScope, isScannerRequester, isTeacherRequester, maskStudentRecord } from "../../services/evaluation/evaluationAccess.service";
import config from "../../config/config";
import { queueUserCredentials } from "../../utils/mailHelper";
import StudentImport, { type ImportStatus } from "../../services/student/studentImport.service";

const createStudent = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.createStudent(
      req.body, req.files, req.viaExamUser
    );
  

    if (!result.error) {
      const slug = req.viaExamUser?.institute?.slug;
      const loginUrl = slug
        ? `${config.frontendUrl}/${slug}/auth/signin`
        : `${config.frontendUrl}/auth/signin`;

      const recipientEmail = req.body.emailId || req.body.email;
      const recipientPhone = req.body.phoneNumber || req.body.mobile || req.body.phone;

      if (recipientEmail) {
        void queueUserCredentials({
          userName: `${req.body.firstName} ${req.body.lastName}`,
          email:    recipientEmail,
          phone:    recipientPhone || "",
          password: result.data.plainPassword,
          role:     "Student",
          loginUrl,
        });
      }
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getAllStudents = async (req: any, res: Response): Promise<any> => {
  try {
    console.log("GET /v1/student/getAllStudents - query:", req.query, "user:", req.viaExamUser?.id);
    const result = await StudentService.getAllStudents(req.viaExamUser, req.query);
    // Teachers see real student details only for classes they teach; for any other
    // class (e.g. one they only evaluate) the identity is masked.
    if (!result.error && isTeacherRequester(req.viaExamUser) && Array.isArray(result.data?.students)) {
      const scope = await getTeacherScope(req.viaExamUser);
      result.data.students = result.data.students.map((s: any) =>
        scope.ownClassKeys.has(String(s.className ?? "")) ? s : maskStudentRecord(s)
      );
    }
    // Scanners get names and personal details masked; roll numbers stay visible.
    if (!result.error && isScannerRequester(req.viaExamUser) && Array.isArray(result.data?.students)) {
      result.data.students = result.data.students.map((s: any) => maskStudentRecord(s, { keepRoll: true }));
    }
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getStudentById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.getStudentById(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const updateStudent = async (req: any, res: Response): Promise<any> => {
  try {
    console.log("PUT /v1/student/updateStudent -", "params:", req.params, "body:", req.body, "user:", req.viaExamUser?.id);
    const result = await StudentService.updateStudent(
      req.params.userId, req.body, req.files, req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const deleteStudent = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.deleteStudent(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const promoteStudents = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.promoteStudents(req.body, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

/**
 * Upload a spreadsheet of students. The rows are saved by a queued job (studentImport.service):
 * this request waits a few seconds, so a small file answers with its result as before
 * (201/200); a bigger one answers 202 with `importId`, and GET /student/bulk-import/:importId
 * follows it. Each new student's login email is queued by the job as their row is saved.
 */
const bulkCreateStudents = async (req: any, res: Response): Promise<any> => {
  try {
    const admin = req.viaExamUser;
    const slug = admin?.institute?.slug;
    const loginUrl = slug ? `${config.frontendUrl}/${slug}/auth/signin` : `${config.frontendUrl}/auth/signin`;

    const started = await StudentImport.startImport(req.body?.students, admin, loginUrl);
    if (started.error) return res.status(started.statusCode).send(started);

    const status = await StudentImport.waitForImport(started.importId, admin);
    return sendImportStatus(res, started.importId, status);
  } catch (error) {
    console.error("bulkCreateStudents controller error:", error);
    return res
      .status(500)
      .json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

/** Progress of an upload, then its result (the same body the upload returns for a file it finished). */
const getImportStatus = async (req: any, res: Response): Promise<any> => {
  try {
    const status = await StudentImport.importStatus(String(req.params.importId), req.viaExamUser);
    return sendImportStatus(res, String(req.params.importId), status);
  } catch (error) {
    console.error("getImportStatus controller error:", error);
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const sendImportStatus = (res: Response, importId: string, status: ImportStatus | null) => {
  if (!status) {
    return res.status(404).send({ error: true, statusCode: 404, message: "This upload was not found. Upload results are kept for 3 days." });
  }
  if (status.status === "completed" && status.result) {
    const { statusCode, message, data } = status.result;
    return res.status(statusCode).send({ error: false, statusCode, message, data: { ...data, importId } });
  }
  if (status.status === "failed") {
    return res.status(422).send({ error: true, statusCode: 422, message: status.reason || "The upload stopped.", data: { ...status, result: undefined } });
  }
  return res.status(202).send({
    error: false,
    statusCode: 202,
    message: "The students are being added. Follow the progress here, or leave: you'll get a notification when it's done.",
    data: { ...status, result: undefined },
  });
};

export default {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  promoteStudents,
  bulkCreateStudents,
  getImportStatus,
};