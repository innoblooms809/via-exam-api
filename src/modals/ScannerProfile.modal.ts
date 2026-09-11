import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface ScannerProfileAttributes {
  id: number;
  userId: string; // FK -> User
  instituteId: string; // FK -> Institute
  address: string | null;
  dob: Date | null;
  gender: string | null;
  aadhar: string | null;
  profileUrl: string | null;
}

interface ScannerProfileCreationAttributes
  extends Optional<
    ScannerProfileAttributes,
    "id" | "address" | "dob" | "gender" | "aadhar" | "profileUrl"
  > {}

class ScannerProfile extends Model<
  ScannerProfileAttributes,
  ScannerProfileCreationAttributes
> {
  public id!: number;
  public userId!: string;
  public instituteId!: string;
  public address!: string | null;
  public dob!: Date | null;
  public gender!: string | null;
  public aadhar!: string | null;
  public profileUrl!: string | null;
}

ScannerProfile.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    address: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    dob: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    gender: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    aadhar: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    profileUrl: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_scanner_profiles",
    modelName: "ScannerProfile",
    timestamps: true,
  }
);

export default ScannerProfile;
