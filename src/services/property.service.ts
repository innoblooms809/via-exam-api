import httpStatus from "http-status";
import PropertyModel from "../models/property.model";
import { IResponse } from "../types/response";

const propertyGetAll = async (): Promise<IResponse> => {
  try {
    const response = await PropertyModel.findAll();
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: response,
      message: "Fetch all Properties.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const propertyCreate = async (req: any): Promise<IResponse> => {
  try {
    const { unitCode } = req;
    const duplicateProperty = await PropertyModel.findOne({
      where: { unitCode: unitCode },
    });
    if (duplicateProperty) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        data: {},
        message: "This Property Details is already filled.",
      };
    }
    const response = await PropertyModel.create(req);
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: response,
      message: "New Property Details is created.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const propertyUpdate = async (id: string, req: any): Promise<IResponse> => {
  try {
    const duplicateProperty = await PropertyModel.findOne({
      where: { id: id },
    });
    console.log(duplicateProperty)
    if (!duplicateProperty) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Property not found",
      };
    }
    const response = await PropertyModel.update(req, { where: { id: id } });
    return {
      error: false,
      statusCode: httpStatus.ACCEPTED,
      data: response,
      message: "Property Updated successfully.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const propertyDelete = async (id: string): Promise<IResponse> => {
  try {
    const duplicateProperty = await PropertyModel.findOne({
      where: { id: id },
    });
    if (!duplicateProperty) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Property not found",
      };
    }
    await PropertyModel.destroy({ where: { id: id } });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {},
      message: "Property deleted successfully.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const propertyNameGetasync = async (): Promise<IResponse> => {
  try {
    const res = await PropertyModel.findAll();
    return {
      error: false,
      statusCode: httpStatus.OK,
      data:res,
      message: "fetched successfully.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  propertyCreate,
  propertyGetAll,
  propertyUpdate,
  propertyDelete,
  propertyNameGetasync,
};
