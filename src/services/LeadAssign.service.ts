import httpStatus from "http-status";
import PropertyModel from "../models/property.model";
import LeadAssignModal from "../models/LeadAssign.model";
import LeadModal from "../models/LeadCreation.model";
import UserModel from "../models/user.model";
import { IResponse } from "../types/response";

// const propertyGetAll = async (): Promise<IResponse> => {
//   try {
//     const response = await PropertyModel.find();
//     return {
//       error: false,
//       statusCode: httpStatus.CREATED,
//       data: response,
//       message: "Fetch all Properties.",
//     };
//   } catch (e: any) {
//     console.error(e);
//     return {
//       error: true,
//       statusCode: httpStatus.BAD_REQUEST,
//       data: {},
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

const leadAssignCreate = async (req: any): Promise<IResponse> => {
  try {
    const { userId, leadIds } = req;

    const userData = await UserModel.findOne({ where: { userId: userId } });

    const duplicateChecks = leadIds.map(async (item: any) => {
      const duplicateLead = await LeadAssignModal.findOne({
        where: { LeadId: item },
      });
      if (duplicateLead) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: `This Lead:${duplicateLead?.LeadId} is already assigned`,
        };
      }
      return null;
    });

    const duplicates = await Promise.all(duplicateChecks);
    const foundDuplicate = duplicates.find((result) => result && result.error);
    if (foundDuplicate) {
      return foundDuplicate;
    }

    const createLeads = leadIds.map(async (item: any) => {
      await LeadModal.update(
        { assignedTo: userData?.userName },
        { where: { LeadId: item } }
      );
      return LeadAssignModal.create({ userId, LeadId: item });
    });
    const response = await Promise.all(createLeads);
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: response,
      message: "Assignment of lead is created.",
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

// const propertyUpdate = async (id: string, req: IProperty): Promise<IResponse> => {
//   try {

//     const duplicateProperty = await PropertyModel.findById(id);
//     if (!duplicateProperty) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Property not found",
//       };
//     }
//     const response = await PropertyModel.findByIdAndUpdate(id, req, {
//       new: true,
//     });
//     return {
//       error: false,
//       statusCode: httpStatus.ACCEPTED,
//       data: response,
//       message: "Property Updated successfully.",
//     };
//   } catch (e: any) {
//     console.error(e);
//     return {
//       error: true,
//       statusCode: httpStatus.BAD_REQUEST,
//       data: {},
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// const propertyDelete = async (id: string): Promise<IResponse> => {
//   try {

//     const duplicateProperty = await PropertyModel.findById(id);
//     if (!duplicateProperty) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Property not found",
//       };
//     }
//     await PropertyModel.findByIdAndDelete(id);
//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       data: {},
//       message: "Property deleted successfully.",
//     };
//   } catch (e: any) {
//     console.error(e);
//     return {
//       error: true,
//       statusCode: httpStatus.BAD_REQUEST,
//       data: {},
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
export default { leadAssignCreate };
