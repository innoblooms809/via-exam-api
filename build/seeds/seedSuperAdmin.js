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
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load .env file
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../.env') });
const User_modal_1 = __importDefault(require("../src/modals/User.modal"));
const Role_modal_1 = __importDefault(require("../src/modals/Role.modal"));
const sequelize_1 = require("../src/config/sequelize");
const encryption_1 = __importDefault(require("../src/utils/encryption"));
// Helper function to generate User ID
const generateUserId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'SA';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
};
const seedSuperAdmin = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Sync the database
        yield sequelize_1.sequelize.sync();
        console.log('Seeding SUPER_ADMIN user...');
        // Get SUPER_ADMIN role
        const superAdminRole = yield Role_modal_1.default.findOne({ where: { role: 'SUPER_ADMIN' } });
        if (!superAdminRole) {
            console.error('SUPER_ADMIN role not found. Please run role seed first.');
            yield sequelize_1.sequelize.close();
            process.exit(1);
        }
        // Check if super admin already exists
        const existingSuperAdmin = yield User_modal_1.default.findOne({
            where: { roleId: superAdminRole.id }
        });
        if (existingSuperAdmin) {
            console.log(`✓ SUPER_ADMIN user already exists: ${existingSuperAdmin.userName}`);
            yield sequelize_1.sequelize.close();
            process.exit(0);
        }
        // Create SUPER_ADMIN user
        const userId = generateUserId();
        const plainPassword = 'SuperAdmin@123';
        const encryptedPassword = yield encryption_1.default.encryptPassword(plainPassword);
        yield User_modal_1.default.create({
            userId,
            userName: 'Super Administrator',
            emailId: 'superadmin@viaexam.com',
            phoneNumber: '9999999999',
            password: encryptedPassword,
            roleId: superAdminRole.id,
            instituteId: null,
            status: 1,
        });
        console.log(`✓ SUPER_ADMIN user created successfully!`);
        console.log(`  User ID: ${userId}`);
        console.log(`  Email: superadmin@viaexam.com`);
        console.log(`  Password: ${plainPassword}`);
        yield sequelize_1.sequelize.close();
        process.exit(0);
    }
    catch (error) {
        console.error('Error seeding SUPER_ADMIN:', error);
        yield sequelize_1.sequelize.close();
        process.exit(1);
    }
});
seedSuperAdmin();
