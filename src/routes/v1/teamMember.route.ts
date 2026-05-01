import express from "express";
import bookingController from "../../controllers/booking.controller";
import teamMemberController  from "../../controllers/teamMember.controller";

const router = express.Router();

router.route("/get").get(teamMemberController.getTeamLists);

router.route("/create").post(teamMemberController.newTeamCreate);


export default router;