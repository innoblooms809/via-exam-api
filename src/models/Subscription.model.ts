import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

export type SubscriptionStatus = "trialing" | "active" | "expired" | "cancelled";
export type BillingCycle = "monthly" | "yearly";

// The current subscription of one institute (exactly one row per institute).
// Every payment or manual change is recorded in SubscriptionTransaction.
interface SubscriptionAttributes {
  id: number;
  subscriptionId: string;
  instituteId: string;
  planKey: string;
  billingCycle: BillingCycle | null;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  // What was paid for [currentPeriodStart, currentPeriodEnd] (minor units); basis for upgrade credit.
  periodValue: number;
  cancelledAt: Date | null;
  stripeCustomerId: string | null;
  // Last expiry reminder sent, so the hourly job never sends the same one twice.
  lastReminderKey: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SubscriptionCreationAttributes
  extends Optional<
    SubscriptionAttributes,
    | "id"
    | "billingCycle"
    | "trialEndsAt"
    | "currentPeriodStart"
    | "currentPeriodEnd"
    | "periodValue"
    | "cancelledAt"
    | "stripeCustomerId"
    | "lastReminderKey"
  > {}

class Subscription
  extends Model<SubscriptionAttributes, SubscriptionCreationAttributes>
  implements SubscriptionAttributes
{
  public id!: number;
  public subscriptionId!: string;
  public instituteId!: string;
  public planKey!: string;
  public billingCycle!: BillingCycle | null;
  public status!: SubscriptionStatus;
  public trialEndsAt!: Date | null;
  public currentPeriodStart!: Date | null;
  public currentPeriodEnd!: Date | null;
  public periodValue!: number;
  public cancelledAt!: Date | null;
  public stripeCustomerId!: string | null;
  public lastReminderKey!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Subscription.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subscriptionId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false, unique: true },
    planKey: { type: DataTypes.STRING(32), allowNull: false },
    billingCycle: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
    status: { type: DataTypes.STRING(16), allowNull: false },
    trialEndsAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    currentPeriodStart: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    currentPeriodEnd: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    periodValue: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    cancelledAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    stripeCustomerId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    lastReminderKey: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_subscriptions",
    modelName: "Subscription",
    timestamps: true,
    indexes: [{ fields: ["status"] }, { fields: ["planKey"] }],
  }
);

export default Subscription;
