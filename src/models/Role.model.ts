import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/sequelize';  // Assuming you have sequelize instance
import Access from './Access.model';  // Import the Access model

class Role extends Model {
  public role!: string;
  public roleDescription!: string;
  public readonly id!: number;
}

Role.init(
  {
    role: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    roleDescription: {
      type: DataTypes.STRING(255),
      allowNull: true,
    }
  },
  {
    sequelize, 
    tableName: 'roles',
    timestamps: false,
  }
);



export default Role;
