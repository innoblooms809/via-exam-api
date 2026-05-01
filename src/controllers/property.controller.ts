import httpStatus from "http-status";
import propertyService from "../services/property.service";
import { Request, Response } from "express";

const getAllProperty = async (req: Request, res: Response) => {
  try {
    // console.log(req.body)
    const response = await propertyService.propertyGetAll();
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

const createProperty = async (req: Request, res: Response) => {
  try {
    // console.log(req.body)
    const response = await propertyService.propertyCreate(req.body);
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

const updateProperty = async (req: Request, res: Response) => {
  try {

    const {id}= req.params
    console.log(id, req?.params)
    const response = await propertyService.propertyUpdate(id,req.body);
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

const deleteProperty = async (req: Request, res: Response) => {
  try {
    const {id}= req.params
    const response = await propertyService.propertyDelete(id);
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

const getPropertyName = async (req: Request, res: Response) => {
  try {
    const response = await propertyService.propertyNameGetasync();
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};
export default { createProperty, getAllProperty,updateProperty, deleteProperty, getPropertyName };
