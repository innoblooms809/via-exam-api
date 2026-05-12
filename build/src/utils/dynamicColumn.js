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
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameColumn = exports.dropColumn = exports.addColumn = void 0;
const sequelize_1 = require("sequelize");
/**
 * Check if a column exists in a given table.
 * @param {Sequelize} sequelize - Sequelize instance
 * @param {string} tableName - The name of the table
 * @param {string} columnName - The name of the column to check
 */
function columnExists(sequelize, tableName, columnName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const queryInterface = sequelize.getQueryInterface();
            const tableDescription = yield queryInterface.describeTable(tableName);
            return columnName in tableDescription;
        }
        catch (error) {
            console.error(`Error checking if column exists in table ${tableName}:`, error);
            throw error;
        }
    });
}
/**
 * Drop a column from a table dynamically.
 * @param {Sequelize} sequelize - Sequelize instance
 * @param {string} tableName - The name of the table
 * @param {string} columnName - The name of the column to remove
 */
function addColumn(sequelize, tableName, columnName, type, allowNull) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const exists = yield columnExists(sequelize, tableName, columnName);
            if (exists) {
                throw new Error(`Column ${columnName} already exist in table ${tableName}`);
            }
            const queryInterface = sequelize.getQueryInterface();
            // Attempt to remove the column
            yield queryInterface.addColumn(tableName, columnName, {
                type: sequelize_1.DataTypes[type],
                allowNull: allowNull,
                defaultValue: "-",
            });
            console.log(`Column ${columnName} added in table ${tableName}`);
            return true;
        }
        catch (error) {
            console.error(`Error adding column ${columnName} in table ${tableName}:`, error);
            throw error;
            return false;
        }
    });
}
exports.addColumn = addColumn;
function dropColumn(sequelize, tableName, columnName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const exists = yield columnExists(sequelize, tableName, columnName);
            if (!exists) {
                throw new Error(`Column ${columnName} does not exist in table ${tableName}`);
            }
            const queryInterface = sequelize.getQueryInterface();
            // Attempt to remove the column
            yield queryInterface.removeColumn(tableName, columnName);
            console.log(`Column ${columnName} removed from table ${tableName}`);
        }
        catch (error) {
            console.error(`Error removing column ${columnName} from table ${tableName}:`, error);
            throw error;
        }
    });
}
exports.dropColumn = dropColumn;
/**
 * Rename a column in a table dynamically
 * @param {Sequelize} sequelize - Sequelize instance
 * @param {string} tableName - The name of the table
 * @param {string} oldColumnName - The current column name
 * @param {string} newColumnName - The new column name
 */
function renameColumn(sequelize, tableName, oldColumnName, newColumnName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const queryInterface = sequelize.getQueryInterface();
            // Rename the column
            yield queryInterface.renameColumn(tableName, oldColumnName, newColumnName);
            console.log(`Column renamed from ${oldColumnName} to ${newColumnName} in table ${tableName}`);
        }
        catch (error) {
            console.error(`Error renaming column ${oldColumnName} to ${newColumnName} in table ${tableName}:`, error);
            throw error;
        }
    });
}
exports.renameColumn = renameColumn;
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
