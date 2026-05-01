import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize"; // Make sure you import the sequelize instance

interface ILeadAttributes {
  LeadId: string;
  entryType?: string;
  entryNo?: number;
  entryDate?: string;
  visitThrough?: string;
  agentName?: string;
  applicationNo?: string;
  applicantName?: string;
  fatherName?: string;
  address?: string;
  addressII?: string;
  cityName?: string;
  pinNo?: string;
  stateName?: string;
  districtName?: string;
  mobileNo?: string;
  phoneNo?: string;
  customerEmail?: string;
  panNo?: string;
  aadharNo?: string;
  project?: string;
  unitCategory?: string;
  floor?: string;
  propertyType?: string;
  discussions?: string;
  nextFollowUp?: string;
  selectiveRemark?: string;
  assignedTo?: string;
  status?: string;
  furtherAction?: string;
  leadApprovalStatus?: number; // 1: Pending, 2: Approval InProgress , 3: FirstApproval, 4: Final Approved
  createdBy?: string;
  modifiedBy?: string;
}

interface ILeadCreationAttributes extends Optional<ILeadAttributes, 'LeadId'> {}

class Lead extends Model<ILeadAttributes, ILeadCreationAttributes> implements ILeadAttributes {
  public LeadId!: string;
  public entryType!: string;
  public entryNo!: number;
  public entryDate!: string;
  public visitThrough?: string;
  public agentName?: string;
  public applicationNo?: string;
  public applicantName!: string;
  public fatherName!: string;
  public address!: string;
  public addressII?: string;
  public cityName!: string;
  public pinCode!: string;
  public stateName!: string;
  public districtName!: string;
  public mobileNo!: string;
  public phoneNo?: string;
  public customerEmail?: string;
  public panNo?: string;
  public aadharNo?: string;
  public project!: string;
  public unitCategory!: string;
  public floor!: string;
  public propertyType!: string;
  public discussions?: string;
  public nextFollowUp?: string;
  public selectiveRemark?: string;
  public assignedTo?: string;
  public status!: string;
  public furtherAction?: string;
  public leadApprovalStatus?: number; // 1: Pending, 2: Approval InProgress , 3: FirstApproval, 4: Final Approved
  public createdBy?: string;
  public modifiedBy?: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Lead.init(
  {
    LeadId: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
    },
    entryType: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    entryNo: {
      type: DataTypes.INTEGER,
      allowNull: true, // Allow null since it's optional in the interface
    },
    entryDate: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    visitThrough: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    agentName: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    applicationNo: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
      unique: true,
    },
    applicantName: {
      type: DataTypes.STRING,
      allowNull: false, // Required field
    },
    fatherName: {
      type: DataTypes.STRING,
      allowNull: false, // Required field
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    addressII: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    cityName: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    // pinNo: {
    //   type: DataTypes.STRING,
    //   allowNull: true, // Allow null since it's optional in the interface
    // },
    stateName: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    districtName: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    mobileNo: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    phoneNo: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
      // validate: {
      //   len: [8, 10],
      // },
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
      validate: {
        isEmail: true,
      },
    },
    panNo: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
      // validate: {
      //   len: [8, 11],
      // },
    },
    aadharNo: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    project: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    unitCategory: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    floor: {
      type: DataTypes.STRING, // String type as per interface
      allowNull: true, // Allow null since it's optional in the interface
    },
    propertyType: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    discussions: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    nextFollowUp: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    selectiveRemark: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    assignedTo: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    furtherAction: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    leadApprovalStatus: {
      type: DataTypes.INTEGER,
      allowNull: true, // Allow null since it's optional in the interface
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
    modifiedBy: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null since it's optional in the interface
    },
  },
  {
    sequelize, // instance of sequelize
    modelName: 'Lead',
    tableName: 'leads',
    timestamps: true, // automatically adds createdAt and updatedAt
  }
);

export default Lead;
