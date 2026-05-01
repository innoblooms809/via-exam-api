import express from 'express';
import leadController from '../../controllers/lead.controller';
import leadservice from '../../services/leadservice';
const router = express.Router();
router.route("/getUserData").get(leadController.getAlluser);
router.route("/sendData").post(leadController.createUser)
router.route ("/deletedata/:id").delete(leadController.DeleteUser)
router.route("/updatetheData/:id").put(leadController.updateTheData);
router.route("/:leadId").get(leadController.getLeadData);


export default router;