import { DataTypes, Model, Optional } from 'sequelize';
import {sequelize} from '../config/sequelize'; // Sequelize instance
import Submodule from './Submodule.model'; // Import Submodule model
import User from './user.model'; // Import User model

// Define the interface for Module
interface ModuleAttributes {
  moduleId: number;
  moduleName: string;
  moduleType: string;
  userId: number;  // Foreign key to User
}

interface ModuleCreationAttributes extends Optional<ModuleAttributes, 'moduleId'> {}

class Module extends Model<ModuleAttributes, ModuleCreationAttributes> implements ModuleAttributes {
  public moduleId!: number;
  public moduleName!: string;
  public moduleType!: string;
  public userId!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Initialize the Module model
Module.init(
  {
    moduleId: {
      type: DataTypes.INTEGER,
    //   primaryKey: true,
      allowNull: true,
    },
    moduleName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    moduleType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',  // References User table
        key: 'id',
      },
    },
  },
  {
    sequelize,
    tableName: 'modules',
    modelName: 'Module',
    timestamps: true,
  }
);

// Define associations
Module.belongsTo(User, { foreignKey: 'userId', as:'user' });
User.hasMany(Module, { foreignKey: 'userId',as:"module" });
Module.hasMany(Submodule, { foreignKey: 'moduleId' });

export default Module;
