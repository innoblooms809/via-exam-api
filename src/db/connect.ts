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

const ensureQuestionPaperConstraints = async () => {
  const tableName = "viaexam_question_papers";
  const oldConstraintName = "uq_exam_teacher";
  const newConstraintName = "uq_question_paper_exam_paper_set";

  await sequelize.query(
    `ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${oldConstraintName}"`
  );
  await sequelize.query(`DROP INDEX IF EXISTS "${oldConstraintName}"`);

  const [constraints] = await sequelize.query(
    `select 1
       from pg_constraint c
       join pg_class t on c.conrelid = t.oid
      where t.relname = :tableName
        and c.conname = :constraintName
      limit 1`,
    {
      replacements: {
        tableName,
        constraintName: newConstraintName,
      },
    }
  );

  if ((constraints as unknown[]).length === 0) {
    await sequelize.query(
      `ALTER TABLE "${tableName}"
       ADD CONSTRAINT "${newConstraintName}" UNIQUE ("examId", "paper_set")`
    );
  }
};

const connectDB = async (fn: any) => {
  try {
    await sequelize.authenticate();
    logger.info("Connected to PostgreSQL Database");
    await ensureQuestionPaperColumns();
    await ensureQuestionPaperConstraints();
    // await sequelize.sync({ force: false }); // Sync models with the database
    await sequelize.sync({ alter: true });
    logger.info("Models synced with PostgreSQL");
    fn();
  } catch (err: any) {
    logger.error(`Error connecting to PostgreSQL: ${err.message}`);
    // Exit process with failure
    process.exit(1);
  }
};

export default connectDB;
