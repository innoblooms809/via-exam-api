import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/sequelize';  // Assuming you have sequelize instance
import Role from './Role.modal';  // Import the Role model

class Access extends Model {
  public moduleName!: string;
  public create!: boolean;
  public edit!: boolean;
  public delete!: boolean;
  public view!: boolean;
  public roleId!: number;
  public readonly id!: number;
}

Access.init(
  {
    moduleName: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    create: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    edit: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    delete: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    view: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    roleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: Role, // Reference to the Role model
        key: 'id',
      },
    }
  },
  {
    sequelize,
    tableName: 'access',
    timestamps: false,
  }
);


export default Access;
