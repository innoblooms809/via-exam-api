import express from "express";
import bookingController from "../../controllers/booking.controller";

const router = express.Router();

router.route("/get").get(bookingController.getAllBooking);

router.route("/create").post(bookingController.newBooking);
router.route("/add/:applicationNo").put(bookingController.addPaymentBooking);
router.route("/get/:applicationNo").get(bookingController.getPaymentBooking);

export default router;