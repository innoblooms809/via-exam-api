"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const accessRole_controller_1 = __importDefault(require("../../controllers/accessRole.controller"));
const router = express_1.default.Router();
router.route("/get").get(accessRole_controller_1.default.getAccessRoles);
router.route("/create").post(accessRole_controller_1.default.newAccessRoleCreate);
router.route("/get/:id").get(accessRole_controller_1.default.getOneAccessRoles);
router.route("/update/:id").put(accessRole_controller_1.default.updateAccessRoles);
exports.default = router;
