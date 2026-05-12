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
const Institute_modal_1 = __importDefault(require("../src/modals/Institute.modal"));
const Role_modal_1 = __importDefault(require("../src/modals/Role.modal"));
const User_modal_1 = __importDefault(require("../src/modals/User.modal"));
const sequelize_1 = require("../src/config/sequelize");
const encryption_1 = __importDefault(require("../src/utils/encryption"));
// Helper function to generate Institute ID
const generateInstituteId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'IB';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
};
// Helper function to generate User ID
const generateUserId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'IB';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
};
const seedInstitutes = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Sync the database
        yield sequelize_1.sequelize.sync();
        console.log('Seeding institutes with dummy data...');
        // Get ADMIN role
        const adminRole = yield Role_modal_1.default.findOne({ where: { role: 'ADMIN' } });
        if (!adminRole) {
            console.error('ADMIN role not found. Please run role seed first.');
            yield sequelize_1.sequelize.close();
            process.exit(1);
        }
        const dummyInstitutes = [
            {
                name: 'St. Xavier School',
                type: 'Secondary School',
                board: 'CBSE',
                registration: 'REG-001-2020',
                established: '1995',
                website: 'https://stxavier.edu.in',
                slug: 'st-xavier-school',
                address: '123 Marine Drive',
                city: 'Mumbai',
                state: 'Maharashtra',
                pincode: '400001',
                adminName: 'Dr. Rajesh Kumar',
                adminEmail: 'rajesh.kumar@stxavier.edu.in',
                adminPhone: '9876543210',
            },
            {
                name: 'Delhi Public School',
                type: 'Senior Secondary School',
                board: 'ICSE',
                registration: 'REG-002-2020',
                established: '1988',
                website: 'https://dps.edu.in',
                slug: 'delhi-public-school',
                address: '456 Connaught Place',
                city: 'Delhi',
                state: 'Delhi',
                pincode: '110001',
                adminName: 'Ms. Priya Sharma',
                adminEmail: 'priya.sharma@dps.edu.in',
                adminPhone: '8765432109',
            },
            {
                name: 'Sunflower International Academy',
                type: 'International School',
                board: 'IB',
                registration: 'REG-003-2021',
                established: '2010',
                website: 'https://sunflower.edu.in',
                slug: 'sunflower-academy',
                address: '789 Koramangala',
                city: 'Bangalore',
                state: 'Karnataka',
                pincode: '560001',
                adminName: 'Mr. Vikram Singh',
                adminEmail: 'vikram.singh@sunflower.edu.in',
                adminPhone: '7654321098',
            },
            {
                name: 'Heritage Convent School',
                type: 'Girls School',
                board: 'CBSE',
                registration: 'REG-004-2019',
                established: '1992',
                website: 'https://heritage.edu.in',
                slug: 'heritage-convent',
                address: '321 Park Street',
                city: 'Kolkata',
                state: 'West Bengal',
                pincode: '700001',
                adminName: 'Sister Mary Joseph',
                adminEmail: 'mary.joseph@heritage.edu.in',
                adminPhone: '6543210987',
            },
            {
                name: 'Lakshmi Narayan College',
                type: 'Senior Secondary',
                board: 'State Board',
                registration: 'REG-005-2018',
                established: '2005',
                website: 'https://lnc.edu.in',
                slug: 'lakshmi-narayan-college',
                address: '654 Jubilee Hills',
                city: 'Hyderabad',
                state: 'Telangana',
                pincode: '500001',
                adminName: 'Prof. Arjun Mehta',
                adminEmail: 'arjun.mehta@lnc.edu.in',
                adminPhone: '5432109876',
            },
            {
                name: 'Riverside Academy',
                type: 'Co-ed School',
                board: 'CBSE',
                registration: 'REG-006-2020',
                established: '2001',
                website: 'https://riverside.edu.in',
                slug: 'riverside-academy',
                address: '987 Cathedral Road',
                city: 'Chennai',
                state: 'Tamil Nadu',
                pincode: '600001',
                adminName: 'Mr. Suresh Iyer',
                adminEmail: 'suresh.iyer@riverside.edu.in',
                adminPhone: '4321098765',
            },
            {
                name: 'Goodwill Public School',
                type: 'Primary & Secondary',
                board: 'ICSE',
                registration: 'REG-007-2021',
                established: '1985',
                website: 'https://goodwill.edu.in',
                slug: 'goodwill-school',
                address: '147 MG Road',
                city: 'Pune',
                state: 'Maharashtra',
                pincode: '411001',
                adminName: 'Mrs. Deepa Desai',
                adminEmail: 'deepa.desai@goodwill.edu.in',
                adminPhone: '3210987654',
            },
            {
                name: 'Cambridge International School',
                type: 'International',
                board: 'Cambridge',
                registration: 'REG-008-2022',
                established: '2008',
                website: 'https://cambridge-intl.edu.in',
                slug: 'cambridge-international',
                address: '258 Iscon Ambli',
                city: 'Ahmedabad',
                state: 'Gujarat',
                pincode: '380001',
                adminName: 'Dr. Anand Patel',
                adminEmail: 'anand.patel@cambridge-intl.edu.in',
                adminPhone: '2109876543',
            },
            {
                name: 'Vidya Vihar Academy',
                type: 'Senior Secondary',
                board: 'State Board',
                registration: 'REG-009-2020',
                established: '1997',
                website: 'https://vidyavihar.edu.in',
                slug: 'vidya-vihar',
                address: '369 Aliganj',
                city: 'Lucknow',
                state: 'Uttar Pradesh',
                pincode: '226001',
                adminName: 'Mr. Ashok Verma',
                adminEmail: 'ashok.verma@vidyavihar.edu.in',
                adminPhone: '1098765432',
            },
            {
                name: 'Excel Educational Institute',
                type: 'Coaching Center',
                board: 'Multiple',
                registration: 'REG-010-2021',
                established: '2015',
                website: 'https://excel-edu.in',
                slug: 'excel-institute',
                address: '741 C-Scheme',
                city: 'Jaipur',
                state: 'Rajasthan',
                pincode: '302001',
                adminName: 'Ms. Neha Gupta',
                adminEmail: 'neha.gupta@excel-edu.in',
                adminPhone: '9012345678',
            },
        ];
        // Seed institutes
        for (const instituteData of dummyInstitutes) {
            const instituteId = generateInstituteId();
            // Create institute
            const institute = yield Institute_modal_1.default.create({
                instituteId,
                instituteName: instituteData.name,
                instituteType: instituteData.type,
                boardType: instituteData.board,
                registrationNumber: instituteData.registration,
                establishedYear: instituteData.established,
                websiteUrl: instituteData.website,
                slug: instituteData.slug,
                contactPersonName: instituteData.adminName,
                contactEmail: instituteData.adminEmail,
                contactPhone: instituteData.adminPhone,
                addressLine1: instituteData.address,
                city: instituteData.city,
                state: instituteData.state,
                pincode: instituteData.pincode,
                plan: 'pro',
                trialDays: 30,
                status: 1,
            });
            // Create admin user for institute
            const userId = generateUserId();
            const encryptedPassword = yield encryption_1.default.encryptPassword('Password@123');
            yield User_modal_1.default.create({
                userId,
                userName: instituteData.adminName,
                emailId: instituteData.adminEmail,
                phoneNumber: instituteData.adminPhone,
                password: encryptedPassword,
                roleId: adminRole.id,
                instituteId,
                status: 1,
            });
            console.log(`✓ Institute created: ${instituteData.name} (${instituteId})`);
        }
        console.log('\n✓ Seed completed successfully! 10 institutes added with admin users.');
        console.log('Default password for all admins: Password@123');
        yield sequelize_1.sequelize.close();
        process.exit(0);
    }
    catch (error) {
        console.error('Error seeding institutes:', error);
        yield sequelize_1.sequelize.close();
        process.exit(1);
    }
});
seedInstitutes();
