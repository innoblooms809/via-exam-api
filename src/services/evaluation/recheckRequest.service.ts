import httpStatus from "http-status";
import RecheckRequest from "../../models/RecheckRequest.model";
import Exam from "../../models/Exam.model";
import Subject from "../../models/Subject.model";
import UserModal from "../../models/User.model";
import ExamWorkflowService from "../exam/examWorkflow.service";

// Same rules as POST /exam-workflow/student/rechecks: only on a published
// result, and only one request per exam, ever.
const createRecheckRequest = async (body: any, requestedBy: any): Promise<any> => {
  try {
    const reason = String(body?.reason ?? "").trim();
    const data = await ExamWorkflowService.createRecheck(requestedBy, {
      examId: body?.examId,
      evaluationId: body?.evaluationId,
      reason: reason || "Recheck requested by the student.",
    });
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Recheck request submitted successfully.",
      data,
    };
  } catch (error: any) {
    const statusCode = error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
    if (statusCode >= 500) console.error("createRecheckRequest error:", error);
    return {
      error: true,
      statusCode,
      message: statusCode >= 500 ? "Something went wrong. Please try again." : error.message,
    };
  }
};

const getStudentRecheckRequests = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
    const offset = (page - 1) * limit;

    const { count, rows } = await RecheckRequest.findAndCountAll({
      where: { studentId, instituteId },
      include: [
        { model: Exam, as: "exam", attributes: ["examId", "examType"], required: false },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const formattedRequests = rows.map((req: any) => ({
      requestId: req.requestId,
      subject: req.subject?.subjectName || req.subjectId,
      exam: req.exam?.examType || req.examId,
      requestDate: req.createdAt,
      completion: req.completedAt || null,
      status: req.status,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recheck requests fetched successfully.",
      data: {
        requests: formattedRequests,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      },
    };
  } catch (error: any) {
    console.error("getStudentRecheckRequests error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

const getRecheckRequestById = async (requestId: string, requestedBy: any): Promise<any> => {
  try {
    const recheckRequest = await RecheckRequest.findOne({
      where: { requestId },
      include: [
        { model: Exam, as: "exam", attributes: ["examId", "examType", "totalMarks"], required: false },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
        { model: UserModal, as: "student", attributes: ["userId", "userName"], required: false },
        { model: UserModal, as: "reviewer", attributes: ["userId", "userName"], required: false },
      ],
    });

    if (!recheckRequest) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Recheck request not found.",
      };
    }

    // Same institute, and a student only ever sees their own request.
    const isStudent = String(requestedBy?.role?.role ?? "").toUpperCase() === "STUDENT";
    if (recheckRequest.instituteId !== requestedBy.instituteId || (isStudent && recheckRequest.studentId !== requestedBy.userId)) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recheck request fetched successfully.",
      data: recheckRequest,
    };
  } catch (error: any) {
    console.error("getRecheckRequestById error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

const updateRecheckRequestStatus = async (
  requestId: string,
  body: { status: string; reviewerId: string },
  requestedBy: any
): Promise<any> => {
  try {
    const recheckRequest = await RecheckRequest.findOne({ where: { requestId } });

    if (!recheckRequest) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Recheck request not found.",
      };
    }

    if (recheckRequest.instituteId !== requestedBy.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    const allowedStatuses = ["Under Review", "Approved", "Rejected", "Completed"];
    if (!allowedStatuses.includes(body.status)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Invalid status. Allowed: ${allowedStatuses.join(", ")}`,
      };
    }

    const updateData: any = {
      status: body.status,
      reviewedBy: body.reviewerId,
      reviewedAt: new Date(),
    };

    if (body.status === "Completed") {
      updateData.completedAt = new Date();
    }

    await recheckRequest.update(updateData);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Recheck request status updated to ${body.status}.`,
      data: recheckRequest,
    };
  } catch (error: any) {
    console.error("updateRecheckRequestStatus error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

export default {
  createRecheckRequest,
  getStudentRecheckRequests,
  getRecheckRequestById,
  updateRecheckRequestStatus,
};