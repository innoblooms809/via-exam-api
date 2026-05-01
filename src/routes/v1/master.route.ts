
import express from "express";
import masterController from "../../controllers/master.controller";

const router = express.Router();

router.route("/get/:masterIds").get(masterController.getmaster);

router.route("/create").post(masterController.createMaster);

export default router;

