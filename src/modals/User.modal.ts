import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize"; // same import as your boilerplate
import Access from "./Access.modal";
import Role from "./Role.modal";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface UserAttributes {
  id: number;                  // auto-increment PK (internal)
  userId: string;              // custom generated ID
  password: string;
  userName: string;
  emailId: string;
  phoneNumber: string;
  roleId: number;              // FK → Role
  instituteId: string | null;  // null for super_admin (platform-level)
  status: number;              // 1 = active, 0 = inactive, 2 = suspended
  loginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  refreshToken: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserCreationAttributes
  extends Optional<
    UserAttributes,
    | "id"
    | "userId"
    | "status"
    | "loginAttempts"
    | "lockedUntil"
    | "lastLoginAt"
    | "refreshToken"
    | "instituteId"
  > {}

// ─── Model ───────────────────────────────────────────────────────────────────

class User extends Model<
  UserAttributes,
  UserCreationAttributes
> {
  public id!: number;
  public userId!: string;
  public password!: string;
  public userName!: string;
  public emailId!: string;
  public phoneNumber!: string;
  public roleId!: number;
  public instituteId!: string | null;
  public status!: number;
  public loginAttempts!: number;
  public lockedUntil!: Date | null;
  public lastLoginAt!: Date | null;
  public refreshToken!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Helper: is the account locked?
  isLocked(): boolean {
    return !!(this.lockedUntil && this.lockedUntil > new Date());
  }
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    userName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    emailId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    roleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    instituteId: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1, // matches your boilerplate (1 = active)
    },
    loginAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    lockedUntil: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "viaexam_users",
    modelName: "User",
    timestamps: true,
  }
);

// Association — matches your existing pattern: User.belongsTo(Role, ...)
 User.hasMany(Access, { foreignKey: 'roleId', as: 'permissions' })
User.belongsTo(Role, { foreignKey: "roleId", as: "role" });

export default User;