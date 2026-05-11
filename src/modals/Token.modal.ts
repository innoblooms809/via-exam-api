import { DataTypes, Model } from 'sequelize';
import {sequelize} from '../config/sequelize'; // Assuming you have a sequelize instance

class Token extends Model {}

Token.init({
  token: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expires: {
    type: DataTypes.STRING,
    allowNull: false
  },
  type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  blacklisted: {
    type: DataTypes.BOOLEAN,
    allowNull: true
  },
  uuid: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  sequelize,
  modelName: 'Token',  // Model name
  timestamps: true,  // To enable createdAt and updatedAt
  tableName: 'tokens',  // Specify the table name
  underscored: true,   // To use snake_case in the database
  paranoid: true      // If you want soft deletes (similar to Mongoose's `deletedAt`)
});

export default Token;
