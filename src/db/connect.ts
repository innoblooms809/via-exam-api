import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import '../models/index'

const connectDB = async (fn: any) => {
  try {
    await sequelize.authenticate();
    logger.info("Connected to PostgreSQL Database");
    await import("../models/index"); // Ensure all models are imported and registered

    // Ensure newly added columns exist in database
    await sequelize.query(
      `ALTER TABLE "viaexam_users" ADD COLUMN IF NOT EXISTS "profileUrl" VARCHAR(255);`
    ).catch(() => null);
    await sequelize.query(
      `ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP WITH TIME ZONE;`
    ).catch(() => null);
    await sequelize.query(
      `ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "reviewedBy" VARCHAR(255);`
    ).catch(() => null);

    await sequelize.sync({ force: false });
    
    logger.info("Models synced with PostgreSQL");
    fn();
  } catch (err: any) {
    logger.error("Error connecting to PostgreSQL / syncing models");
    logger.error(err?.stack || err?.message || String(err));
    // Exit process with failure
    process.exit(1);
  }
};

export default connectDB;
