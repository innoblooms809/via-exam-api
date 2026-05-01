import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize"; // Assuming you have a sequelize instance in this path
import Lead from "./LeadCreation.model";

// CoApplicantsData Attributes Interface
interface ICoApplicantsDataAttributes {
  relation?: string;
  applicantName?: string;
  fatherName?: string;
  address?: string;
  mobileNo?: string;
  cityName?: string;
  pinNo?: string;
  customerEmail?: string;
  panNo?: string;
  aadharNo?: string;
}

// PaymentTypeData Attributes Interface
interface IPaymentTypeDataAttributes {
  stage?: string;
  overHead?: string;
  date?: string;
  percentage?: string;
  baseAmount?: string;
  taxAmount?: string;
  netAmount?: string;
  adjustedAmount?: string;
}

// BookingDetails Attributes Interface
interface IBookingDetailsAttributes {
  bookingId: string;
  applicationNo: string;
  unitDescription?: string;
  unitCode?: string;
  unitCategory?: string;
  floor?: number[];
  finalizedArea?: string;
  location?: string;
  areaOrDiffArea?: string;
  phase?: string;
  priceList?: string;
  basicRate?: string;
  saleRate?: string;
  unitCost?: string;
  loanFromBank?: string;
  loanPaperSubmitDate?: string;
  issueDate?: string;
  possessionDate?: string;
  psnNo?: string;
  transferable?: string;
  unitType?: string;
  paymentPlan?: string;
  taxStructure?: string;
  remark?: string;
  selectArea?: string;
  bankName?: string;
  loanAmount?: string;
  gst?: string;
  gstStructure?: string;
  paymentSchedule?: IPaymentTypeDataAttributes[];
  coApplicants?: ICoApplicantsDataAttributes[];
}

// Optional attributes for creating an instance (excluding required fields like bookingId and applicationNo)
interface IBookingDetailsCreationAttributes extends Optional<IBookingDetailsAttributes, 'bookingId' | 'applicationNo'> {}

class BookingDetails extends Model<IBookingDetailsAttributes, IBookingDetailsCreationAttributes> implements IBookingDetailsAttributes {
  public bookingId!: string;
  public applicationNo!: string;
  public unitDescription?: string;
  public unitCode?: string;
  public unitCategory?: string;
  public floor?: number[];
  public finalizedArea?: string;
  public location?: string;
  public areaOrDiffArea?: string;
  public phase?: string;
  public priceList?: string;
  public basicRate?: string;
  public saleRate?: string;
  public unitCost?: string;
  public loanFromBank?: string;
  public loanPaperSubmitDate?: string;
  public issueDate?: string;
  public possessionDate?: string;
  public psnNo?: string;
  public transferable?: string;
  public unitType?: string;
  public paymentPlan?: string;
  public taxStructure?: string;
  public remark?: string;
  public selectArea?: string;
  public bankName?: string;
  public loanAmount?: string;
  public gst?: string;
  public gstStructure?: string;
  public paymentSchedule?: IPaymentTypeDataAttributes[];
  public coApplicants?: ICoApplicantsDataAttributes[];

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

BookingDetails.init(
  {
    bookingId: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
    },
    applicationNo: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    unitDescription: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    unitCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    unitCategory: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    floor: {
      type:DataTypes.INTEGER,
      allowNull: true,
    },
    finalizedArea: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    areaOrDiffArea: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phase: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    priceList: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    basicRate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    saleRate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    unitCost: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    loanFromBank: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    loanPaperSubmitDate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    issueDate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    possessionDate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    psnNo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    transferable: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    unitType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    paymentPlan: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    taxStructure: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    remark: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    selectArea: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    loanAmount: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    gst: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    gstStructure: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'BookingDetails',
    tableName: 'booking_details',
    timestamps: true,
  }
);

// CoApplicantsData Model
class CoApplicantsData extends Model<ICoApplicantsDataAttributes> implements ICoApplicantsDataAttributes {
  public relation?: string;
  public applicantName?: string;
  public fatherName?: string;
  public address?: string;
  public mobileNo?: string;
  public cityName?: string;
  public pinNo?: string;
  public customerEmail?: string;
  public panNo?: string;
  public aadharNo?: string;
}

CoApplicantsData.init(
  {
    relation: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    applicantName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    fatherName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    mobileNo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cityName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    pinNo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    panNo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    aadharNo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'CoApplicantsData',
    tableName: 'co_applicants_data',
    timestamps: true,
  }
);

// PaymentTypeData Model
class PaymentTypeData extends Model<IPaymentTypeDataAttributes> implements IPaymentTypeDataAttributes {
  public stage?: string;
  public overHead?: string;
  public date?: string;
  public percentage?: string;
  public baseAmount?: string;
  public taxAmount?: string;
  public netAmount?: string;
  public adjustedAmount?: string;
}

PaymentTypeData.init(
  {
    stage: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    overHead: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    date: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    percentage: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    baseAmount: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    taxAmount: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    netAmount: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    adjustedAmount: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'PaymentTypeData',
    tableName: 'payment_type_data',
    timestamps: true,
  }
);

// Associations
BookingDetails.hasMany(CoApplicantsData, { foreignKey: 'bookingDetailsId', as: 'coApplicants' });
CoApplicantsData.belongsTo(BookingDetails, { foreignKey: 'bookingDetailsId' });

BookingDetails.hasMany(PaymentTypeData, { foreignKey: 'bookingDetailsId', as: 'paymentSchedule' });
PaymentTypeData.belongsTo(BookingDetails, { foreignKey: 'bookingDetailsId' });

BookingDetails.belongsTo(Lead, {
  foreignKey: 'applicationNo',
  targetKey: 'applicationNo',
  as: 'leadDetails', // Alias for the associated model
});
export { BookingDetails, CoApplicantsData, PaymentTypeData };
