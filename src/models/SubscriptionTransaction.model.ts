import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

export type TransactionKind = "trial" | "purchase" | "renewal" | "upgrade" | "downgrade" | "manual";
export type TransactionStatus = "pending" | "paid" | "failed" | "expired";
export type TransactionProvider = "stripe" | "manual" | "system";

// Billing ledger: every Stripe checkout, trial start and super-admin change.
// Amounts are in the currency's minor unit (paise for INR).
interface SubscriptionTransactionAttributes {
  id: number;
  transactionId: string;
  instituteId: string;
  kind: TransactionKind;
  planKey: string;
  billingCycle: string | null;
  originalAmount: number; // plan price for the period
  creditApplied: number; // unused value of the previous plan, deducted on a plan change
  amount: number; // what was actually charged
  currency: string;
  status: TransactionStatus;
  provider: TransactionProvider;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  receiptUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  createdBy: string | null;
  note: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SubscriptionTransactionCreationAttributes
  extends Optional<
    SubscriptionTransactionAttributes,
    | "id"
    | "billingCycle"
    | "originalAmount"
    | "creditApplied"
    | "amount"
    | "stripeSessionId"
    | "stripePaymentIntentId"
    | "receiptUrl"
    | "periodStart"
    | "periodEnd"
    | "paidAt"
    | "createdBy"
    | "note"
  > {}

class SubscriptionTransaction
  extends Model<SubscriptionTransactionAttributes, SubscriptionTransactionCreationAttributes>
  implements SubscriptionTransactionAttributes
{
  public id!: number;
  public transactionId!: string;
  public instituteId!: string;
  public kind!: TransactionKind;
  public planKey!: string;
  public billingCycle!: string | null;
  public originalAmount!: number;
  public creditApplied!: number;
  public amount!: number;
  public currency!: string;
  public status!: TransactionStatus;
  public provider!: TransactionProvider;
  public stripeSessionId!: string | null;
  public stripePaymentIntentId!: string | null;
  public receiptUrl!: string | null;
  public periodStart!: Date | null;
  public periodEnd!: Date | null;
  public paidAt!: Date | null;
  public createdBy!: string | null;
  public note!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SubscriptionTransaction.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    transactionId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    planKey: { type: DataTypes.STRING(32), allowNull: false },
    billingCycle: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
    originalAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    creditApplied: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false },
    provider: { type: DataTypes.STRING(16), allowNull: false },
    stripeSessionId: { type: DataTypes.STRING, allowNull: true, unique: true, defaultValue: null },
    stripePaymentIntentId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    receiptUrl: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    periodStart: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    periodEnd: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    paidAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    createdBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    note: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_subscription_transactions",
    modelName: "SubscriptionTransaction",
    timestamps: true,
    indexes: [{ fields: ["instituteId"] }, { fields: ["status"] }],
  }
);

export default SubscriptionTransaction;
