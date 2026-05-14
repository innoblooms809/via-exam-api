import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import { DataTypes } from "sequelize";

const ensureQuestionPaperColumns = async () => {
  const queryInterface = sequelize.getQueryInterface();
  const tableName = "viaexam_question_papers";

  let tableDescription: Record<string, unknown>;

  try {
    tableDescription = await queryInterface.describeTable(tableName);
  } catch (error) {
    return;
  }

  if (tableDescription.paper_set) {
    return;
  }

  if (tableDescription.paperSet) {
    await queryInterface.renameColumn(tableName, "paperSet", "paper_set");
    return;
  }

  await queryInterface.addColumn(tableName, "paper_set", {
    type: DataTypes.STRING(1),
    allowNull: false,
    defaultValue: "A",
  });
};

const connectDB = async (fn: any) => {
  try {
    await sequelize.authenticate();
    logger.info("Connected to PostgreSQL Database");
    await ensureQuestionPaperColumns();
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
