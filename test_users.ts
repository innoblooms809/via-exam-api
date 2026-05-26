import { sequelize } from './src/config/sequelize';
import User from './src/modals/User.modal';

async function run() {
  const users = await User.findAll({ order: [['createdAt', 'DESC']], limit: 5 });
  console.log(JSON.stringify(users, null, 2));
  process.exit(0);
}
run();
