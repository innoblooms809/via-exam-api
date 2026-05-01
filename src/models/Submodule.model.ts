import { DataTypes, Model, Optional } from 'sequelize';
import {sequelize} from '../config/sequelize'; // Sequelize instance
import Permission from './permission.model'; // Import the Permission model

// Define the interface for Submodule
interface SubmoduleAttributes {
  submoduleId: number;
  submoduleName: string;
  permissionId: number;  // Foreign key to Permission
}

interface SubmoduleCreationAttributes extends Optional<SubmoduleAttributes, 'submoduleId'> {}

class Submodule extends Model<SubmoduleAttributes, SubmoduleCreationAttributes> implements SubmoduleAttributes {
  public submoduleId!: number;
  public submoduleName!: string;
  public permissionId!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Initialize the Submodule model
Submodule.init(
  {
    submoduleId: {
      type: DataTypes.INTEGER,
    //   primaryKey: true,
      allowNull: false,
    },
    submoduleName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    permissionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'permissions',  // References Permission table
        key: 'id',
      },
    },
  },
  {
    sequelize,
    tableName: 'submodules',
    modelName: 'Submodule',
    timestamps: true,
  }
);

// Define associations
Submodule.belongsTo(Permission, { foreignKey: 'permissionId' });

export default Submodule;
