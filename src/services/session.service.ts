import httpStatus from "http-status";
import Session from "../modals/Session.modal";
import Institute from "../modals/Institute.modal";
import RegHelper from "../utils/helper";
import { Op } from "sequelize";
import { sequelize } from "../config/sequelize";

// ─── CREATE SESSION ───────────────────────────────────────────────────────────
const createSession = async (body: any, createdBy: any): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const instituteId = createdBy.instituteId;

    // 1. Check institute exists
    const institute = await Institute.findOne({
      where: { instituteId, status: 1 },
    });
    if (!institute) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found or inactive.",
      };
    }

    // 2. Check duplicate session name
    const exists = await Session.findOne({
      where: { instituteId, sessionName: body.sessionName,isDeleted: false, },
    });
    if (exists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: `Session "${body.sessionName}" already exists.`,
      };
    }

    // 3. Validate dates
    const startDate = new Date(body.startDate);
    const endDate   = new Date(body.endDate);
    if (endDate <= startDate) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "End date must be after start date.",
      };
    }

    // 4. If this session is set as active
    //    deactivate all other sessions of this institute
    if (body.isActive) {
      await Session.update(
        { isActive: false },
        { where: { instituteId ,isDeleted: false,}, transaction: t }
      );
    }

    // 5. Create session
    const sessionId = await RegHelper.generateUserId();
    const session   = await Session.create(
      {
        sessionId,
        instituteId,
        sessionName: body.sessionName,
        startDate,
        endDate,
        isActive: body.isActive ?? true,
      },
      { transaction: t }
    );

    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Session created successfully.",
      data: session,
    };
  } catch (e: any) {
    await t.rollback();
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ALL SESSIONS ─────────────────────────────────────────────────────────
const getAllSessions = async (
  createdBy: any,
  query: any
): Promise<any> => {
  try {
    const { isActive = "" } = query;
    const where: any = { instituteId: createdBy.instituteId ,isDeleted: false,};

    if (isActive === "true")  where.isActive = true;
    if (isActive === "false") where.isActive = false;

    const sessions = await Session.findAll({
      where,
      
      order: [["startDate", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sessions fetched successfully.",
      data: {
        sessions,
        total:         sessions.length,
        activeSession: sessions.find((s) => s.isActive) ?? null,
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ONE SESSION ──────────────────────────────────────────────────────────
const getSessionById = async (
  sessionId: string,
  createdBy: any
): Promise<any> => {
  try {
    const session = await Session.findOne({
      where: { sessionId, instituteId: createdBy.instituteId,isDeleted: false, },
    });

    if (!session) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Session not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Session fetched successfully.",
      data: session,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ACTIVE SESSION ───────────────────────────────────────────────────────
const getActiveSession = async (createdBy: any): Promise<any> => {
  try {
    const session = await Session.findOne({
      where: {
        instituteId: createdBy.instituteId,
        isActive:    true,
        isDeleted: false,
      },
    });

    if (!session) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "No active session found. Please create or activate a session.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Active session fetched.",
      data: session,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── ACTIVATE SESSION ─────────────────────────────────────────────────────────
// Deactivates all other sessions and activates this one
const activateSession = async (
  sessionId: string,
  createdBy: any
): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const session = await Session.findOne({
      where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false },
    });

    if (!session) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Session not found.",
      };
    }

    if (session.isActive) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Session is already active.",
      };
    }

    // Deactivate all sessions of this institute
    await Session.update(
      { isActive: false },
  {
    where: {
      instituteId: createdBy.instituteId,
      isDeleted: false,
    },
    transaction: t,
  }
    );

    // Activate this session
    await session.update({ isActive: true }, { transaction: t });

    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Session "${session.sessionName}" is now active.`,
      data: session,
    };
  } catch (e: any) {
    await t.rollback();
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE SESSION ───────────────────────────────────────────────────────────
const updateSession = async (
  sessionId: string,
  body: any,
  createdBy: any
): Promise<any> => {
  try {
    const session = await Session.findOne({
      where: { sessionId, instituteId: createdBy.instituteId ,isDeleted: false,},
    });

    if (!session) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Session not found.",
      };
    }

    // Validate dates if provided
    const startDate = body.startDate ? new Date(body.startDate) : session.startDate;
    const endDate   = body.endDate   ? new Date(body.endDate)   : session.endDate;

    if (endDate <= startDate) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "End date must be after start date.",
      };
    }

    await session.update({
      sessionName: body.sessionName ?? session.sessionName,
      startDate,
      endDate,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Session updated successfully.",
      data: session,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── DELETE SESSION ───────────────────────────────────────────────────────────
const deleteSession = async (
  sessionId: string,
  createdBy: any
): Promise<any> => {
  try {
    const session = await Session.findOne({
      where: {
        sessionId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!session) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Session not found.",
      };
    }

    if (session.isActive) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Cannot delete active session. Deactivate it first.",
      };
    }

    await session.update({
      isDeleted: true,
      isActive: false,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Session deleted successfully.",
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  createSession,
  getAllSessions,
  getSessionById,
  getActiveSession,
  activateSession,
  updateSession,
  deleteSession,
};