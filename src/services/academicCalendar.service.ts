import httpStatus from "http-status";
import AcademicCalendar from "../modals/AcademicCalendar.modal";
import User from "../modals/User.modal";
import { Op } from "sequelize";

export const createEvent = async (data: any, instituteId: string, createdBy: string) => {
  try {
    const event = await AcademicCalendar.create({
      ...data,
      instituteId,
      createdBy,
    });
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Event created successfully",
      data: event,
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to create event: ${error.message}`,
    };
  }
};

export const updateEvent = async (eventId: string, data: any, instituteId: string) => {
  try {
    const event = await AcademicCalendar.findOne({ where: { eventId, instituteId, isDeleted: false } });
    if (!event) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Event not found" };
    }
    await event.update(data);
    return { error: false, statusCode: httpStatus.OK, message: "Event updated successfully", data: event };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

export const deleteEvent = async (eventId: string, instituteId: string) => {
  try {
    const event = await AcademicCalendar.findOne({ where: { eventId, instituteId, isDeleted: false } });
    if (!event) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Event not found" };
    }
    await event.update({ isDeleted: true });
    return { error: false, statusCode: httpStatus.OK, message: "Event deleted successfully" };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

export const getEventsByMonth = async (instituteId: string, year: number, month: number) => {
  try {
    // MySQL handles string comparison on DATEONLY correctly. We can do month matching.
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const events = await AcademicCalendar.findAll({
      where: {
        instituteId,
        isDeleted: false,
        eventDate: {
          [Op.gte]: startDate,
          [Op.lte]: endDate,
        },
      },
      order: [["eventDate", "ASC"]],
    });

    const creatorIds = events.map(e => e.createdBy).filter(Boolean);
    const users = await User.findAll({
      where: { userId: creatorIds }
    });
    const userMap = users.reduce((acc: any, u: any) => {
      acc[u.userId] = u.userName;
      return acc;
    }, {});

    const mappedEvents = events.map(e => {
      const plain = e.toJSON();
      if (userMap[plain.createdBy]) {
        plain.createdBy = userMap[plain.createdBy];
      }
      return plain;
    });

    return { error: false, statusCode: httpStatus.OK, data: mappedEvents };
  } catch (error: any) {
    console.error("Error in getEventsByMonth service:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

export const getAllEvents = async (instituteId: string) => {
  try {
    const events = await AcademicCalendar.findAll({
      where: { instituteId, isDeleted: false },
      order: [["eventDate", "ASC"]],
    });
    const creatorIds = events.map(e => e.createdBy).filter(Boolean);
    const users = await User.findAll({
      where: { userId: creatorIds }
    });
    const userMap = users.reduce((acc: any, u: any) => {
      acc[u.userId] = u.userName;
      return acc;
    }, {});

    const mappedEvents = events.map(e => {
      const plain = e.toJSON();
      if (userMap[plain.createdBy]) {
        plain.createdBy = userMap[plain.createdBy];
      }
      return plain;
    });

    return { error: false, statusCode: httpStatus.OK, data: mappedEvents };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};
