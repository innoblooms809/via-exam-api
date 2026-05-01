
import httpStatus from "http-status";
import { Request, Response } from "express";
import bookingService from "../services/booking.service";
import { accessRoleServices, teamMemberServices } from "../services";


const newAccessRoleCreate = async (req: Request, res: Response) => {
  try {
   const response = await accessRoleServices.createRoleWithAccess(req?.body)
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }
  return res.status(httpStatus.CREATED).send({
    message: "Team member Details Created Successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}

const getAccessRoles = async (req: Request, res: Response) => {

  try {
    const response = await accessRoleServices.getAllRoleList()
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }
  return res.status(httpStatus.OK).send({
    message: "Role with Access Fetched Successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}

const getOneAccessRoles = async (req: Request, res: Response) => {

  try {
    const {id} = req?.params
    const response = await accessRoleServices.getOneRoleAccess(id)
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }
  return res.status(httpStatus.OK).send({
    message: "Role with Access Fetched Successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}

const updateAccessRoles = async (req: Request, res: Response) => {

  try {
    const id = Number(req?.params.id); 
    if (isNaN(id)) {
      return res.status(400).send({ message: 'Invalid ID' }); 
    }

    const response = await accessRoleServices.updateRoleWithAccess(id, req?.body); 
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: "Role with Access Fetched Successfully",
      data: response,
    });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}

export default { newAccessRoleCreate, getAccessRoles, getOneAccessRoles,  updateAccessRoles}
