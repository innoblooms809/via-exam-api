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
const Role_modal_1 = __importDefault(require("../src/modals/Role.modal"));
const sequelize_1 = require("../src/config/sequelize");
const seedRoles = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Sync the database
        yield sequelize_1.sequelize.sync();
        console.log('Seeding roles...');
        const roles = [
            {
                role: 'ADMIN',
                roleDescription: 'Administrator with full system access',
            },
            {
                role: 'USER',
                roleDescription: 'Regular user with limited access',
            },
            {
                role: 'MODERATOR',
                roleDescription: 'Moderator with content management access',
            },
            {
                role: 'INSTRUCTOR',
                roleDescription: 'Instructor role for teaching and exam creation',
            },
            {
                role: 'STUDENT',
                roleDescription: 'Student role for exam participation',
            },
            {
                role: 'SUPER_ADMIN',
                roleDescription: 'Super Administrator with unrestricted access',
            },
            {
                role: 'INSTITUTE_ADMIN',
                roleDescription: 'Institute administrator for managing institute',
            },
        ];
        // Check if roles already exist
        for (const roleData of roles) {
            const existingRole = yield Role_modal_1.default.findOne({
                where: { role: roleData.role },
            });
            if (!existingRole) {
                yield Role_modal_1.default.create(roleData);
                console.log(`✓ Role created: ${roleData.role}`);
            }
            else {
                console.log(`✓ Role already exists: ${roleData.role}`);
            }
        }
        console.log('Seed completed successfully!');
        yield sequelize_1.sequelize.close();
        process.exit(0);
    }
    catch (error) {
        console.error('Error seeding roles:', error);
        yield sequelize_1.sequelize.close();
        process.exit(1);
    }
});
seedRoles();
