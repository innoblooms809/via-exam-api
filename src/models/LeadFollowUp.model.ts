import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/sequelize";

class LeadFollowUp extends Model {
  public followUpId!: number; // Auto-incremented ID (Primary key)
  public LeadId!: string;
  public applicantName!: string;
  public agentName!: string;
  public assignedTo!: string;
  public remark!: string;
  public date!: string;
  public status!: string;
  public readonly createdAt!: Date; // Automatically managed by Sequelize
  public readonly updatedAt!: Date; // Automatically managed by Sequelize
}

// Define the model
LeadFollowUp.init(
  {
    followUpId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: 'followUpId',
    },
    LeadId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    applicantName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    agentName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    assignedTo: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    remark: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    date: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'LeadFollowUp',
    tableName: 'leadFollowUp', // table name
    timestamps: true,
    indexes: [
      {
        unique: false,
        fields: ['followUpId'],
      },
    ],
  }
);

// Export the model
export default LeadFollowUp;