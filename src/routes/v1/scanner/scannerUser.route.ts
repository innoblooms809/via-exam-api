import { Router } from "express";
import Controller from "../../../controllers/scanner/scannerUser.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { profileUpload } from "../../../utils/multer";
import { ADMINS } from "../../../config/roles";

const router = Router();

// Scanner accounts are managed by the school admin.
router.post("/create", authenticate, authorize(ADMINS), profileUpload, Controller.createScanner);
router.get("/getAllScanners", authenticate, authorize(ADMINS), Controller.getAllScanners);
router.get("/getScanner/:userId", authenticate, authorize(ADMINS), Controller.getScannerById);
router.put("/updateScanner/:userId", authenticate, authorize(ADMINS), profileUpload, Controller.updateScanner);
router.delete("/deleteScanner/:userId", authenticate, authorize(ADMINS), Controller.deleteScanner);
router.patch("/reactivateScanner/:userId", authenticate, authorize(ADMINS), Controller.reactivateScanner);

export default router;
