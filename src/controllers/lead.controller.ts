import httpStatus from "http-status";
import leadservice from "../services/leadservice";
import { Request, Response } from "express";
import { error } from "console";

const getAlluser = async (req: Request, res: Response) => {
  try {
    console.log(11)
    const users = await leadservice.LeadModal();
    return res.status(httpStatus.OK).send(users);
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const createUser = async (req: Request, res: Response) => {
  try {
    const { mobileNo, customerEmail, agentName } = req.body;
    const CurrentTime = Date.now();
    let text = CurrentTime.toString();
    const AgentName = agentName.slice(0, 2);
    const CustomerMobileNo = mobileNo;
    const UserMobilenumber = CustomerMobileNo.slice(
      CustomerMobileNo.length - 4,
      CustomerMobileNo.length
    );
    let userId = text.slice(text.length - 4, text.length);
    const FinalId = `${AgentName}${UserMobilenumber}${userId}`;
    const dateObj = new Date();
    const month = dateObj.getUTCMonth() + 1; // months from 1-12
    const year = dateObj.getUTCFullYear();
    const pYear = year.toString().slice(2);
    const pMonth = month.toString().padStart(2, "0");
    const pTimeStamp = Math.round(+dateObj / 1000);
    const timeStamp = pTimeStamp.toString().slice(6);
    const applicationNo = `L${pYear}${pMonth}${timeStamp}`;
    console.log(applicationNo);
    const newData = {
      ...req.body,
      LeadId: FinalId,
      applicationNo: applicationNo,
      assignedTo: "Not Yet",
    };
    const existingLeads = await leadservice.LeadModal();
    const duplicateLead = existingLeads.data.find(
      (item: any) =>
        item.mobileNo === mobileNo || item.customerEmail === customerEmail
    );
    if (duplicateLead) {
      return res.status(httpStatus.CONFLICT).json({
        error: true,
        message: "This email & mobile is already exits the Lead Creation Time",
        statusCode: 409,
        data: {},
      });
    }
    const response = await leadservice.LeadDataCreation(newData);
    
    return res.status(httpStatus.CREATED).send({
      error: false,
      message: "Lead Created Successfully",
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

const DeleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const response: any = await leadservice.DeleteTheData(id);
    if (response.error) {
      return res.status(response.code).send("User not deleted");
    }
    res.send({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send("An error occurred while deleting the user");
  }
};

const updateTheData = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const response: any = await leadservice.updateLeadData(id, req);
    if (response.error) {
      return res.status(response.code).send("User not found or update failed");
    }
    res
      .status(200)
      .send({ message: "User updated successfully", user: response.response });
  } catch (error) {
    console.error("Error in update process:", error);
    res.status(500).send("An error occurred while updating the user");
  }
};

const getLeadData = async (req: Request, res: Response) => {
  const { leadId } = req.params;

  try {
    const response: any = await leadservice.leadDetailsGet(leadId);
    if (response.error) {
      return res.status(response.code).send("Lead not found or update failed");
    }
    res
      .status(response.statusCode)
      .send({ message: "Lead Assign Approved Successfully", data: response });
  } catch (error) {
    console.error("Error in update process:", error);
    res.status(500).send("An error occurred while updating the user");
  }
};
export default {
  getAlluser,
  createUser,
  DeleteUser,
  updateTheData,
  getLeadData,
};
