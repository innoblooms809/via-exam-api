import express from "express";
import { dynamicModulesRoleController } from "../../controllers";
import dynamicModuleController from "../../controllers/dynamicModule.controller";


const router = express.Router();
router.route("/get-all").get(dynamicModuleController.getModule);
router.route("/get-by-slug").get(dynamicModuleController.getModuleBySlug);
router.route("/get/:id").get(dynamicModuleController.getModuleOne);
router.route("/create").post(dynamicModulesRoleController.dynamicModuleCreate);
router.route("/heading/update/:id").put(dynamicModulesRoleController.updateModuleHeading);
router.route("/field/update/:id").put(dynamicModulesRoleController.updateModuleField);
router.route("/field/update").patch(dynamicModulesRoleController.oneFieldUpdate);
router.route("/heading/update").patch(dynamicModulesRoleController.oneHeadingUpdate);
router.route("/field/delete").delete(dynamicModulesRoleController.oneFieldDelete);
router.route("/heading/delete").delete(dynamicModulesRoleController.oneHeadingDelete);
router.route("/module/update/:id").patch(dynamicModulesRoleController.updateModule);
router.route("/module/delete/:id").delete(dynamicModulesRoleController.deleteModule);

export default router;
