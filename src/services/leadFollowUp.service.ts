import httpStatus from "http-status";
import LeadFollowUp from "../models/LeadFollowUp.model";
import { IResponse } from "../types/response";

const leadFollowUpCreate = async (req: any): Promise<IResponse> => {
  try {
    const response = await LeadFollowUp.create(req);
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: response,
      message: "New Lead FollowUp Details is created.",
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

const leadFollowUpGetByLeadId = async (id: string): Promise<IResponse> => {
  try {
    const leads :any= await LeadFollowUp.findAll({where:{ LeadId: id} })
    if (leads.length === 0) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "FollowUp not found",
        data: [],
      };
    }
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: leads,
      message: "Successfully fetched.",
    };
    console.log(leads);
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

export default { leadFollowUpCreate, leadFollowUpGetByLeadId };
