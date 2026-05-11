import User from "../modals/User.modal";
import Role from "../modals/Role.modal";
import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";

const initSuperAdmin = async () => {
  try {
    // 1. Find super_admin role
    const role = await Role.findOne({
      where: { role: "SUPER_ADMIN" }, // ← match your exact role name in DB
    });

    if (!role) {
      console.log("⚠️  SUPER_ADMIN role not found — skipping.");
      return;
    }

    // 2. Check if superadmin already exists
    const existing = await User.findOne({
      where: { roleId: role.id },
    });

    if (existing) {
      console.log("✅ SuperAdmin already exists — skipping.");
      return;
    }

    // 3. Auto-create superadmin
    const plainPassword  = "SuperAdmin@123";
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
    const userId = await RegHelper.generateUserId();

    await User.create({
      userId,
      userName:    "Super Admin",
      emailId:     "superadmin@viaexam.com",
      phoneNumber: "0000000000",
      password:    encryptedPassword,
      roleId:      role.id,
      instituteId: null,
      status:      1,
    });

    console.log("✅ SuperAdmin created!");
    console.log("   email   : superadmin@viaexam.com");
    console.log("   password: SuperAdmin@123");
    console.log("⚠️  Change password after first login!");

  } catch (e: any) {
    console.error("❌ initSuperAdmin failed:", e.message);
  }
};

export default initSuperAdmin;