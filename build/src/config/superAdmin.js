"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
const initSuperAdmin = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let role = yield Role_modal_1.default.findOne({
            where: { role: "SUPER_ADMIN" },
        });
        if (!role) {
            console.log("⚠️ Creating SUPER_ADMIN role...");
            role = yield Role_modal_1.default.create({ role: "SUPER_ADMIN" });
        }
        const existing = yield User_modal_1.default.findOne({
            where: { roleId: role.id },
        });
        if (existing) {
            console.log("✅ SuperAdmin already exists — skipping.");
            return;
        }
        const encryptedPassword = yield encryption_1.default.encryptPassword("SuperAdmin@123");
        const userId = yield helper_1.default.generateUserId();
        yield User_modal_1.default.create({
            userId,
            userName: "Super Admin",
            emailId: "superadmin@viaexam.com",
            phoneNumber: "9999999999",
            password: encryptedPassword,
            roleId: role.id,
            instituteId: null,
            status: 1,
        });
        console.log("✅ SuperAdmin created!");
    }
    catch (e) {
        console.error("FULL ERROR:", e); // IMPORTANT
    }
});
exports.default = initSuperAdmin;
