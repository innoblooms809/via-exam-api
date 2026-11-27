/**
 * auth-session-cleanup (daily): sign-in sessions that ended or expired more than 30 days ago are
 * deleted. Until then they show who signed in from where, and why each session ended.
 */

import { Op } from "sequelize";
import UserSession from "../../models/UserSession.model";
import { defineMaintenanceTask } from "../../queue/maintenance";

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

defineMaintenanceTask("auth-session-cleanup", { pattern: "20 4 * * *" }, async () => {
  const before = new Date(Date.now() - KEEP_MS);
  const removed = await UserSession.destroy({
    where: { [Op.or]: [{ revokedAt: { [Op.lt]: before } }, { expiresAt: { [Op.lt]: before } }] },
  });
  return removed ? { removed } : null;
});
