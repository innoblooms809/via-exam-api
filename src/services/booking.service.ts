import httpStatus from "http-status";
import {
  BookingDetails,
  CoApplicantsData,
  PaymentTypeData,
} from "../models/bookingDetails.model";
import LeadModel from "../models/LeadCreation.model";
import { IResponse } from "../types/response";

// const bookingDetailsCreate = async (req: any): Promise<IResponse> => {
//   console.log(122222, req)
//   try {
//     const bookingId = Math.random().toString().slice(2, 11);
//     const booking = await BookingDetails.create({
//       bookingId: bookingId,
//       applicationNo: req?.applicationNo,
//       unitDescription: req?.unitDescription,
//       unitCode: req?.unitCode,
//       unitCategory: req?.unitCategory,
//       floor: req?.floor,
//       finalizedArea: req?.finalizedArea,
//       location: req?.location,
//       areaOrDiffArea: req?.areaOrDiffArea,
//       phase: req?.phase,
//       priceList: req?.priceList,
//       basicRate: req?.basicRate,
//       saleRate: req?.saleRate,
//       unitCost: req?.unitCost,
//       loanFromBank: req?.loanFromBank,
//       loanPaperSubmitDate: req?.loanPaperSubmitDate,
//       issueDate: req?.issueDate,
//       possessionDate: req?.possessionDate,
//       psnNo: req?.psnNo,
//       transferable: req?.transferable,
//       unitType: req?.unitType,
//       paymentPlan: req?.paymentPlan,
//       taxStructure: req?.taxStructure,
//       remark: req?.remark,
//       selectArea: req?.selectArea,
//       bankName: req?.bankName,
//       loanAmount: req?.loanAmount,
//       gst: req?.gst,
//       gstStructure: req?.gstStructure,
//     });

//     // Add co-applicants if provided
//     console.log(req?.coApplicants);
//     if (req?.coApplicants && req?.coApplicants.length > 0) {
//       for (const coApplicant of req?.coApplicants) {
//         const applicants = await CoApplicantsData.create({
//           ...coApplicant,
//           bookingDetailsId: booking.bookingId, // Set the foreign key
//         });
//       }
//     }

//     // Add payment schedule if provided
//     if (req?.paymentSchedule && req?.paymentSchedule.length > 0) {
//       for (const payment of req?.paymentSchedule) {
//         await PaymentTypeData.create({
//           ...payment,
//           bookingDetailsId: booking.bookingId, // Set the foreign key
//         });
//       }
//     }
//     // const response = await BookingDetailsModel.create(newReq);

//     return {
//       error: false,
//       statusCode: httpStatus.CREATED,
//       data: booking,
//       message: "Booking is created.",
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
const bookingDetailsCreate = async (req: any): Promise<IResponse> => {
  try {
    const bookingId = Math.random().toString().slice(2, 11);
    const booking = await BookingDetails.create({
      bookingId: bookingId,
      applicationNo: req?.applicationNo ||"",
      unitDescription: req?.unitDescription||"",
      unitCode: req?.unitCode||"",
      unitCategory: req?.unitCategory||"",
      floor: req?.floor||"",
      finalizedArea: req?.finalizedArea||"",
      location: req?.location||"",
      areaOrDiffArea: req?.areaOrDiffArea||"",
      phase: req?.phase||"",
      priceList: req?.priceList||"",
      basicRate: req?.basicRate||"",
      saleRate: req?.saleRate||"",
      unitCost: req?.unitCost||"",
      loanFromBank: req?.loanFromBank||"",
      loanPaperSubmitDate: req?.loanPaperSubmitDate||"",
      issueDate: req?.issueDate||"",
      possessionDate: req?.possessionDate||"",
      psnNo: req?.psnNo||"",
      transferable: req?.transferable||"",
      unitType: req?.unitType||"",
      paymentPlan: req?.paymentPlan||"",
      taxStructure: req?.taxStructure||"",
      remark: req?.remark||"",
      selectArea: req?.selectArea||"",
      bankName: req?.bankName||"",
      loanAmount: req?.loanAmount||"",
      gst: req?.gst||"",
      gstStructure: req?.gstStructure||"",
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: booking,
      message: "Booking is created.",
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

const bookingDetailsgetAll = async (req: any): Promise<IResponse> => {
  try {
    // Fetch all bookings with related leadDetails
    const bookings = await BookingDetails.findAll({
      include: [
        {
          model: LeadModel,
          as: 'leadDetails', // Alias for the associated model
          required: false,   // Whether to return records even if there's no associated leadDetails
        }
      ],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: bookings,
      message: "Fetched all bookings.",
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

const addPaymentDetails = async (
  req: any,
  applicationNo: string
): Promise<IResponse> => {
  try {
    const booking = await BookingDetails.findOne({
      where: { applicationNo },
    });

    if (!booking) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        data: {},
        message: "Booking not found.",
      };
    }

    // Create new payment schedule entry in the PaymentTypeData model
    const newPayment = await PaymentTypeData.create({
      ...req, // Spread the req to include all payment details
      bookingDetailsId: booking.bookingId, // Associate payment with the found booking
    });
    if (!newPayment) {
      return {
        error: true,
        statusCode: httpStatus.NOT_MODIFIED,
        data: [],
        message: "Something went wrong.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: newPayment,
      message: "Fetched all bookings.",
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

const getOnePaymentDetails = async (applicationNo: string): Promise<IResponse> => {
  try {
    // Find the booking by applicationNo
    const booking = await BookingDetails.findOne({
      where: { applicationNo },
      include: [
        {
          model: CoApplicantsData,
          as: "coApplicants", // Assuming the alias is 'coApplicants'
        },
        { model: PaymentTypeData, as: "paymentSchedule" },
      ], // If you need to include payment details too
    });

    if (!booking) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        data: {},
        message: "Booking not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: booking,
      message: "Fetched booking details successfully.",
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
  bookingDetailsCreate,
    bookingDetailsgetAll,
  addPaymentDetails,
  getOnePaymentDetails,
};
