import express from "express";
import { accessRoleController } from "../../controllers";

const router = express.Router();

router.route("/get").get(accessRoleController.getAccessRoles);

router.route("/create").post(accessRoleController.newAccessRoleCreate);
router.route("/get/:id").get(accessRoleController.getOneAccessRoles);
router.route("/update/:id").put(accessRoleController.updateAccessRoles);

export default router;