
import httpStatus from "http-status";
import { Request, Response } from "express";
import bookingService from "../services/booking.service";
import { teamMemberServices } from "../services";


const newTeamCreate = async (req: Request, res: Response) => {
  try {
   const response = await teamMemberServices.createTeamMembers(req?.body)
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

const getTeamLists = async (req: Request, res: Response) => {

  try {
    const response = await teamMemberServices.getAllTeamList()
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }
  return res.status(httpStatus.OK).send({
    message: "Team Member Details Fetched Successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}


export default { newTeamCreate, getTeamLists}
