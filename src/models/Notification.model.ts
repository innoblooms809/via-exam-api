import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import PushService from "../services/notification/push.service";

interface NotificationAttributes {
  id: number;
  notificationId: string;
  instituteId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  referenceId: string | null;
  isRead: boolean;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NotificationCreationAttributes
  extends Optional<
    NotificationAttributes,
    "id" | "notificationId" | "referenceId" | "isRead" | "isDeleted"
  > {}

class Notification extends Model<NotificationAttributes, NotificationCreationAttributes> {
  public id!: number;
  public notificationId!: string;
  public instituteId!: string;
  public userId!: string;
  public type!: string;
  public title!: string;
  public message!: string;
  public referenceId!: string | null;
  public isRead!: boolean;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Notification.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    notificationId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    referenceId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    tableName: "viaexam_notifications",
    modelName: "Notification",
    timestamps: true,
  }
);

// Every in-app notification is also pushed to the user's browsers (Firebase Cloud Messaging).
// Inside a transaction, wait for the commit so a rolled-back notification is never pushed.
Notification.afterCreate((notification, options) => {
  const send = () => void PushService.sendToUser(notification.get({ plain: true }));
  if (options.transaction) {
    options.transaction.afterCommit(send);
  } else {
    send();
  }
});

export default Notification;
