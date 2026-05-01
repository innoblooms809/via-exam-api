
import httpStatus from "http-status";
import { Request, Response } from "express";
import bookingService from "../services/booking.service";


const newBooking = async (req: Request, res: Response) => {
  try {
   const response = await bookingService.bookingDetailsCreate(req?.body)
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }
  return res.status(httpStatus.CREATED).send({
    message: "Booking Details Created Successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}

const getAllBooking = async (req: Request, res: Response) => {

  try {
    const response = await bookingService.bookingDetailsgetAll(req?.body)
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }
  return res.status(httpStatus.CREATED).send({
    message: "Booking Details Created Successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}
const addPaymentBooking = async (req: Request, res: Response) => {
 const {applicationNo}= req?.params
  try {
    const response = await bookingService.addPaymentDetails(req?.body, applicationNo)
   if (response.error) {
    return res.status(response.statusCode).send({
      message: response.message,
    });
  }else{
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      })
  }
}
  return res.status(httpStatus.CREATED).send({
    message: "Payment details added successfully",
    data: response,
  });
  } catch (error) {
    console.error("data not Found")
    res.status(500).send({ message: "Internal Server error" })
  }
}

const getPaymentBooking = async (req: Request, res: Response) => {
  const {applicationNo}= req?.params
   try {
     const response = await bookingService.getOnePaymentDetails( applicationNo)
    if (response.error) {
     return res.status(response.statusCode).send({
       message: response.message,
     });
   }else{
     if (response.error) {
       return res.status(response.statusCode).send({
         message: response.message,
       })
   }
 }
   return res.status(httpStatus.CREATED).send({
     message: "Payment details fetched successfully",
     data: response,
   });
   } catch (error) {
     console.error("data not Found")
     res.status(500).send({ message: "Internal Server error" })
   }
 }

export default { newBooking, getAllBooking, addPaymentBooking, getPaymentBooking}
