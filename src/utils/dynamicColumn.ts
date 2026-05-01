import { Sequelize, QueryInterface, DataTypes } from "sequelize";

/**
 * Check if a column exists in a given table.
 * @param {Sequelize} sequelize - Sequelize instance
 * @param {string} tableName - The name of the table
 * @param {string} columnName - The name of the column to check
 */
async function columnExists(
  sequelize: Sequelize,
  tableName: string,
  columnName: string
): Promise<boolean> {
  try {
    const queryInterface: QueryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable(tableName);
    return columnName in tableDescription;
  } catch (error) {
    console.error(
      `Error checking if column exists in table ${tableName}:`,
      error
    );
    throw error;
  }
}

/**
 * Drop a column from a table dynamically.
 * @param {Sequelize} sequelize - Sequelize instance
 * @param {string} tableName - The name of the table
 * @param {string} columnName - The name of the column to remove
 */

export async function addColumn(
  sequelize: Sequelize,
  tableName: string,
  columnName: string,
  type: string,
  allowNull: boolean
): Promise<boolean> {
  try {
    const exists = await columnExists(sequelize, tableName, columnName);
    if (exists) {
      throw new Error(
        `Column ${columnName} already exist in table ${tableName}`
      );
    }

    const queryInterface: QueryInterface = sequelize.getQueryInterface();
    // Attempt to remove the column
    await queryInterface.addColumn(tableName, columnName, {
      type: DataTypes[type as keyof typeof DataTypes],
      allowNull: allowNull,
      defaultValue: "-",
    });
    console.log(`Column ${columnName} added in table ${tableName}`);
    return true;
  } catch (error) {
    console.error(
      `Error adding column ${columnName} in table ${tableName}:`,
      error
    );
    throw error;
    return false;
  }
}

export async function dropColumn(
  sequelize: Sequelize,
  tableName: string,
  columnName: string
): Promise<void> {
  try {
    const exists = await columnExists(sequelize, tableName, columnName);
    if (!exists) {
      throw new Error(
        `Column ${columnName} does not exist in table ${tableName}`
      );
    }

    const queryInterface: QueryInterface = sequelize.getQueryInterface();
    // Attempt to remove the column
    await queryInterface.removeColumn(tableName, columnName);
    console.log(`Column ${columnName} removed from table ${tableName}`);
  } catch (error) {
    console.error(
      `Error removing column ${columnName} from table ${tableName}:`,
      error
    );
    throw error;
  }
}

/**
 * Rename a column in a table dynamically
 * @param {Sequelize} sequelize - Sequelize instance
 * @param {string} tableName - The name of the table
 * @param {string} oldColumnName - The current column name
 * @param {string} newColumnName - The new column name
 */
export async function renameColumn(
  sequelize: Sequelize,
  tableName: string,
  oldColumnName: string,
  newColumnName: string
): Promise<void> {
  try {
    const queryInterface: QueryInterface = sequelize.getQueryInterface();
    // Rename the column
    await queryInterface.renameColumn(tableName, oldColumnName, newColumnName);
    console.log(
      `Column renamed from ${oldColumnName} to ${newColumnName} in table ${tableName}`
    );
  } catch (error) {
    console.error(
      `Error renaming column ${oldColumnName} to ${newColumnName} in table ${tableName}:`,
      error
    );
    throw error;
  }
}

// export async function changeColumn(
//   sequelize: Sequelize,
//   tableName: string,
//   columnName: string,
//   type: string,
//   allowNull: boolean
// ): Promise<void> {
//   try {
//     const queryInterface: QueryInterface = sequelize.getQueryInterface();
//     // Change the column's attributes (e.g., type, allowNull, etc.)
//     await queryInterface.changeColumn(tableName, columnName, {
//       type: DataTypes[type as keyof typeof DataTypes],
//       allowNull: allowNull,
//     });
//     console.log(`Column ${columnName} updated in table ${tableName}`);
//   } catch (error) {
//     console.error(
//       `Error changing column ${columnName} in table ${tableName}:`,
//       error
//     );
//     throw error;
//   }
// }
