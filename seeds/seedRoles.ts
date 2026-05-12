import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

import Role from '../src/modals/Role.modal';
import { sequelize } from '../src/config/sequelize';

const seedRoles = async () => {
  try {
    // Sync the database
    await sequelize.sync();

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
      const existingRole = await Role.findOne({
        where: { role: roleData.role },
      });

      if (!existingRole) {
        await Role.create(roleData);
        console.log(`✓ Role created: ${roleData.role}`);
      } else {
        console.log(`✓ Role already exists: ${roleData.role}`);
      }
    }

    console.log('Seed completed successfully!');
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding roles:', error);
    await sequelize.close();
    process.exit(1);
  }
};

seedRoles();
