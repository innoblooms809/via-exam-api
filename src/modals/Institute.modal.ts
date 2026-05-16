import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface InstituteAttributes {
  id: number;
  instituteId: string;

  instituteName: string;
  instituteType: string;
  boardType: string;

  registrationNumber: string | null;
  establishedYear: string | null;
  websiteUrl: string | null;

  slug: string;

  contactPersonName: string;
  contactEmail: string;
  contactPhone: string;
  alternatePhone: string | null;

  addressLine1: string;
  addressLine2: string | null;

  city: string;
  state: string;
  pincode: string;

  plan: string;
  trialDays: number;
  trialEndsAt: Date | null;

  logoUrl: string | null;
  bannerUrl: string | null;

  status: number;
  isDeleted: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

interface InstituteCreationAttributes
  extends Optional<
    InstituteAttributes,
    | "id"
    | "instituteId"
    | "registrationNumber"
    | "establishedYear"
    | "websiteUrl"
    | "alternatePhone"
    | "addressLine2"
    | "trialEndsAt"
    | "logoUrl"
    | "bannerUrl"
    | "status"
    | "isDeleted"
  > {}

// ─── Model ───────────────────────────────────────────────────────────────────

class Institute
  extends Model<InstituteAttributes, InstituteCreationAttributes>
  implements InstituteAttributes
{
  public id!: number;
  public instituteId!: string;

  public instituteName!: string;
  public instituteType!: string;
  public boardType!: string;

  public registrationNumber!: string | null;
  public establishedYear!: string | null;
  public websiteUrl!: string | null;

  public slug!: string;

  public contactPersonName!: string;
  public contactEmail!: string;
  public contactPhone!: string;
  public alternatePhone!: string | null;

  public addressLine1!: string;
  public addressLine2!: string | null;

  public city!: string;
  public state!: string;
  public pincode!: string;

  public plan!: string;
  public trialDays!: number;
  public trialEndsAt!: Date | null;

  public logoUrl!: string | null;
  public bannerUrl!: string | null;

  public status!: number;
  public isDeleted!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Institute.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    instituteName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    instituteType: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    boardType: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    registrationNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    establishedYear: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    websiteUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    contactPersonName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    contactEmail: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    contactPhone: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    alternatePhone: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    addressLine1: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    addressLine2: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    city: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    state: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    pincode: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    plan: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    trialDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 14,
    },

    trialEndsAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },

    logoUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    bannerUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    isDeleted: {
  type: DataTypes.BOOLEAN,
  allowNull: false,
  defaultValue: false,
},
  },
  {
    sequelize,
    tableName: "viaexam_institutes",
    modelName: "Institute",
    timestamps: true,
    indexes: [
  {
    unique: true,
    fields: ["slug"],
  },
  {
    unique: true,
    fields: ["contactEmail"],
  },
],
  },
);

// // One institute has many users
// Institute.hasMany(User, {
//   foreignKey: "instituteId",  // ← string FK not integer
//   sourceKey:  "instituteId",  // ← links via instituteId not id
//   as: "users",
// });

// // User belongs to institute
// User.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey:  "instituteId",  // ← links via instituteId not id
//   as: "institute",
// });

// Institute.hasMany(Class, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "classes",
// });

// Institute.hasMany(Section, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "sections",
// });

// Institute.hasMany(Subject, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "subjects",
// });

// Institute.hasMany(Exam, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "exams",
// });

// Institute.hasMany(Session, {
//   foreignKey: "instituteId",
//   sourceKey: "instituteId",
//   as: "sessions",
// });



export default Institute;
