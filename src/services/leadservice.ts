import { promises } from "dns";
import leadModal from "../models/LeadCreation.model";
import { error } from "console";
import { response } from "express";
import { where } from "sequelize";
import httpStatus from "http-status";
import { IResponse } from "../types/response";

const LeadModal = async (): Promise<IResponse> => {
  try {
    console.log(1222)
    const user = await leadModal.findAll({
    });
    console.log(user)
    let respose = {
      error: false,
      statusCode: httpStatus.OK,
      message: "Leads Fetched successfully.",
      data: user,
    };
    return respose;
  } catch (e: any) {
    console.log(e)
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const LeadDataCreation = async (req: any): Promise<IResponse> => {
  try {
    const newUser = await leadModal.create(req);
    // if (newUser) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "Leads created successfully.",
        data: newUser,
      };
    // }
  } catch (e: any) {
    console.log(122, e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const DeleteTheData = async (id: string) => {
  try {
    const user = await leadModal.destroy({ where: { LeadId: id } });
    if (!user) {
      return {
        error: true,
        code: 404, // Not found
      };
    }
    return {
      response: user,
      code: 200,
    };
  } catch (error) {
    console.error("Error in DeleteTheData:", error);
    return {
      error: true,
      code: 500,
    };
  }
};

const updateLeadData = async (id: string, req: any) => {
  try {
    // Extract update data from the request body
    const updateData = req.body;
    // Attempt to update the lead
    const user = await leadModal.update(
      updateData, // Use the extracted updateData
      {
        where: {
          LeadId: id,
        },
      } // This will return the updated document
    );
    if (!user) {
      return {
        error: true,
        code: 404, // Not found
      };
    }
    return {
      response: user,
      code: 200, // find the Successfully
    };
  } catch (error) {
    console.error("Error updating the data:", error);
    return {
      error: true,
      code: 500,
    };
  }
};
const leadDetailsGet = async (id: string): Promise<IResponse> => {
  try {
    const response = await leadModal.findOne({ where: { LeadId: id } });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: response,
      message: "Fetch Lead Data.",
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
  LeadModal,
  LeadDataCreation,
  DeleteTheData,
  updateLeadData,
  leadDetailsGet,
};
