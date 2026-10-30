/**
 * Telling people about exam work: the helpers every workflow step uses.
 *
 *   notifyAll          writes the notifications, in the caller's transaction when there is
 *                      one; each is pushed to the person's browsers once committed (see
 *                      Notification.afterCreate). One per person and type per call.
 *   instituteAdminIds  the school's active admins.
 *   examLabel          "Mathematics · Mid Term · Class 9-A", for messages (the exam loaded
 *                      with its subject, class and section, e.g. EXAM_INCLUDES).
 */

import { Op, Transaction } from "sequelize";
import Notification from "../../models/Notification.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import { newId } from "../../utils/idGenerator";

export type NotificationInput = {
  instituteId: string;
  userId: string | null | undefined;
  type: string;
  title: string;
  message: string;
  referenceId: string;
};

/** Pass the open transaction when called inside one, so the notifications commit with it. */
export const notifyAll = async (items: NotificationInput[], transaction?: Transaction) => {
  const unique = new Map(items.filter((n) => n.userId).map((n) => [`${n.userId}|${n.type}`, n]));
  if (!unique.size) return;
  await Notification.bulkCreate(
    [...unique.values()].map((n) => ({ ...n, userId: n.userId as string, title: n.title.slice(0, 255), notificationId: newId("notification") })),
    { transaction, individualHooks: true }
  );
};

/** The school's active admins. Pass the open transaction when called inside one. */
export const instituteAdminIds = async (instituteId: string, transaction?: Transaction): Promise<string[]> => {
  const roles = await Role.findAll({ where: { role: { [Op.in]: ["ADMIN", "INSTITUTE_ADMIN"] } }, attributes: ["id"], transaction });
  const admins = await UserModal.findAll({
    where: { instituteId, roleId: { [Op.in]: roles.map((r) => r.id) }, status: 1, isDeleted: false },
    attributes: ["userId"],
    transaction,
  });
  return admins.map((a) => a.userId);
};

export const examLabel = (exam: any) =>
  `${exam.subject?.subjectName ?? "Subject"} · ${exam.examType} · Class ${exam.class?.className ?? exam.classId ?? ""}${
    exam.section?.sectionName ? `-${exam.section.sectionName}` : ""
  }`;

/** "Diya Patel: The diagram in Q4 is blurred…", short enough for a notification. */
export const preview = (text: string, max = 160) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
