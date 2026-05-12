import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

import User from '../src/modals/User.modal';
import Role from '../src/modals/Role.modal';
import { sequelize } from '../src/config/sequelize';
import EncryptPassword from '../src/utils/encryption';

// Helper function to generate User ID
const generateUserId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'SA';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
};

const seedSuperAdmin = async () => {
  try {
    // Sync the database
    await sequelize.sync();

    console.log('Seeding SUPER_ADMIN user...');

    // Get SUPER_ADMIN role
    const superAdminRole = await Role.findOne({ where: { role: 'SUPER_ADMIN' } });
    if (!superAdminRole) {
      console.error('SUPER_ADMIN role not found. Please run role seed first.');
      await sequelize.close();
      process.exit(1);
    }

    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({
      where: { roleId: superAdminRole.id }
    });

    if (existingSuperAdmin) {
      console.log(`✓ SUPER_ADMIN user already exists: ${existingSuperAdmin.userName}`);
      await sequelize.close();
      process.exit(0);
    }

    // Create SUPER_ADMIN user
    const userId = generateUserId();
    const plainPassword = 'SuperAdmin@123';
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);

    await User.create({
      userId,
      userName: 'Super Administrator',
      emailId: 'superadmin@viaexam.com',
      phoneNumber: '9999999999',
      password: encryptedPassword,
      roleId: superAdminRole.id,
      instituteId: null, // platform-level user
      status: 1,
    });

    console.log(`✓ SUPER_ADMIN user created successfully!`);
    console.log(`  User ID: ${userId}`);
    console.log(`  Email: superadmin@viaexam.com`);
    console.log(`  Password: ${plainPassword}`);
    
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding SUPER_ADMIN:', error);
    await sequelize.close();
    process.exit(1);
  }
};

seedSuperAdmin();
