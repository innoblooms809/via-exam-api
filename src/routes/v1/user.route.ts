import express from "express";
// import masterController from '../../controllers/master.controller';
import { userController } from "../../controllers";
import { handleUploadFile } from "../../utils/uploadSingleFile";
import validate from "../../middlewares/validate";
import { user } from "../../validations";
import authenticate from "../../middlewares/auth";

const router = express.Router();

router.route("/get-all").get(userController.getUser);

router
  .route("/register")
  .post(
    handleUploadFile.fields([{ name: "userPhoto" }, { name: "userSignature" }]),
    userController.createUser
  );
// router.route("/register").post(validate(user.userCreateValidation), userController.createUser);
// router.route("/register").post(userController.createUser);

router.route("/login").post(userController.loginUser);

router.route("/captcha").get(userController.getCaptcha);

router.route("/update/:userId").patch(userController.updateUser);
router.route("/get-user/:userId").get(userController.getSingleUser);

export default router;
