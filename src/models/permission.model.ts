import { DataTypes, Model, Optional } from 'sequelize';
import {sequelize} from '../config/sequelize';  // Sequelize instance

// Define the interface for the Permission model
interface PermissionAttributes {
  read: number;
  create: number;
  edit: number;
  delete: number;
  userId: string;
}

// Define the type for creating a permission (optional)
interface PermissionCreationAttributes extends Optional<PermissionAttributes, 'read' | 'create' | 'edit' | 'delete'> {}

class Permission extends Model<PermissionAttributes, PermissionCreationAttributes> implements PermissionAttributes {
  public read!: number;
  public create!: number;
  public edit!: number;
  public delete!: number;
  public userId!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Permission.init(
  {
    read: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    create: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    edit: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    delete: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {  // Add userId to the column definition
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users', // Reference to User model
        key: 'id',
      },
    },
  },
  {
    sequelize,
    tableName: 'permissions',
    modelName: 'Permission',
    timestamps: true,
  }
);

export default Permission;
