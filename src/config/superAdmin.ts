import User from "../modals/User.modal";
import Role from "../modals/Role.modal";
import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";

const initSuperAdmin = async () => {
  try {
    let role = await Role.findOne({
      where: { role: "SUPER_ADMIN" },
    });

    if (!role) {
      console.log("⚠️ Creating SUPER_ADMIN role...");
      role = await Role.create({ role: "SUPER_ADMIN" });
    }

    const existing = await User.findOne({
      where: { roleId: role.id },
    });

    if (existing) {
      console.log("✅ SuperAdmin already exists — skipping.");
      return;
    }

    const encryptedPassword = await EncryptPassword.encryptPassword("SuperAdmin@123");
    const userId = await RegHelper.generateUserId();

    await User.create({
      userId,
      userName: "Super Admin",
      emailId: "superadmin@viaexam.com",
      phoneNumber: "9999999999", // IMPORTANT: avoid duplicates
      password: encryptedPassword,
      roleId: role.id,
      instituteId: null,
      status: 1,
    });

    console.log("✅ SuperAdmin created!");
  } catch (e: any) {
    console.error("FULL ERROR:", e); // IMPORTANT
  }
};

export default initSuperAdmin;