import httpStatus from "http-status";
import leadservice from "../services/leadservice";
import { Request, Response } from "express";
import { error } from "console";
import { leadAssignServices } from "../services";

const getAlluser = async (req: Request, res: Response) => {
  try {
    
    const users = await leadservice.LeadModal();
    return res.status(httpStatus.OK).send(users);
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const createLeadAssign = async (req: Request, res: Response) => {
  try {
    const response = await leadAssignServices.leadAssignCreate(req?.body);
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.CREATED).send({
      message: "Lead Assign Created Successfully",
      data: response,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({
      message: "Error creating master entry",
      error:
        error instanceof Error ? error.message : "An unknown error occurred",
    });
  }
};

// const DeleteUser = async (req: Request, res: Response) => {
//   const { _id } = req.params;
//   try {
//     const response = await leadservice.DeleteTheData(_id);
//     if (response.error) {
//       return res.status(response.code).send("User not deleted");
//     }
//     res.send({ message: "User deleted successfully" });
//   } catch (error) {
//     console.error("Error deleting user:", error);
//     res.status(500).send("An error occurred while deleting the user");
//   }
// };

// const updateTheData = async (req: Request, res: Response) => {
//   const { _id } = req.params;
//   try {
//     const response = await leadservice.updateLeadData(_id, req);
//     if (response.error) {
//       return res.status(response.code).send("User not found or update failed");
//     }
//     res.status(200).send({ message: "User updated successfully", user: response.response });
//   } catch (error) {
//     console.error("Error in update process:", error);
//     res.status(500).send("An error occurred while updating the user");
//   }
// }

export default { getAlluser, createLeadAssign };
