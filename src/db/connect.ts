import logger from "../config/logger";
import { sequelize } from "../config/sequelize";

const connectDB = async (fn: any) => {
  try {
    await sequelize.authenticate();
    logger.info("Connected to PostgreSQL Database");
    await sequelize.sync({ force: false }); // Sync models with the database
    logger.info("Models synced with PostgreSQL");
    fn();
  } catch (err: any) {
    logger.error(`Error connecting to PostgreSQL: ${err.message}`);
    // Exit process with failure
    process.exit(1);
  }
};

export default connectDB;
