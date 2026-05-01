import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/sequelize';
 // adjust the path to your Sequelize instance

// Define the AssignLead model
class AssignLead extends Model {
  // Define attributes
  public assignId!: number; // or `string` if you are using UUID
  public LeadId!: string;
  public userId!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Initialize the model
AssignLead.init(
  {
    assignId: {
      type: DataTypes.INTEGER, // Use DataTypes.UUID if you're using UUID
      autoIncrement: true, // Assuming assignId is auto-incrementing
      primaryKey: true,
      allowNull: false,
    },
    LeadId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize, // passing the `sequelize` instance is required
    modelName: 'AssignLead', // Model name
    tableName: 'assignLeads', // Optional: custom table name if different
    timestamps: true, // To enable createdAt and updatedAt
  }
);

export default AssignLead;
