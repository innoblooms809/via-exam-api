import express from "express";
import { sidebarController } from "../../controllers";
// import authenticate from "../../middlewares/auth";

const router = express.Router();

// router.route("/get").get(sidebarController.getAllSidebarMenu);
router.route("/get-menu").get(sidebarController.getAllSidebarMenu);
router.route("/get-sidebar-modules").get(sidebarController.getSidebarModules);
export default router;
