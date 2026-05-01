import express from "express";
import { propertyController } from "../../controllers";
// import authenticate from "../../middlewares/auth";

const router = express.Router();

router.route("/create").post( propertyController.createProperty);
router.route("/getall").get( propertyController.getAllProperty);
router.route("/update/:id").patch( propertyController.updateProperty);
router.route("/delete/:id").delete( propertyController.deleteProperty);
router.route("/get-properties").get( propertyController.getPropertyName);

export default router;
