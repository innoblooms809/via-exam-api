import { Router } from "express";
import multer from "multer";
import Controller from "../../controllers/scannerUser.controller";
import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

router.post(
  "/create",
  authenticate,

  upload.fields([{ name: "profilePhoto", maxCount: 1 }]),
  Controller.createScanner
);

router.get(
  "/getAllScanners",
  authenticate,
  Controller.getAllScanners
);

router.get(
  "/getScanner/:userId",
  authenticate,

  Controller.getScannerById
);

router.put(
  "/updateScanner/:userId",
  authenticate,

  upload.fields([{ name: "profilePhoto", maxCount: 1 }]),
  Controller.updateScanner
);

router.delete(
  "/deleteScanner/:userId",
  authenticate,

  Controller.deleteScanner
);

router.patch(
  "/reactivateScanner/:userId",
  authenticate,
  Controller.reactivateScanner
);

export default router;
