import httpStatus from "http-status";
import User from "../../models/user.model"; // Sequelize User model
import RegHelper from "../../utils/registrationHelper";
import EncryptPassword from "../../utils/encryption";
import exclude from "../../utils/exclude"; // If you need to exclude sensitive fields
import Access from "../../models/Access.model";
import Role from "../../models/Role.model";
import { IResponse } from "../../types/response";

/**
 * Create a new user along with modules, permissions, and submodules
 */
const userCreate = async (req: any): Promise<IResponse> => {
  try {
    // const permissionsArray = req.body.permissions; // Access the permissions array
    const userPhoto = req.files["userPhoto"][0];
    const userSignature = req.files["userSignature"][0];
    const userPhotoUrl = `${req.protocol}://${req.hostname}:${process.env.PORT}/uploads/${userPhoto.filename}`;
    const userSignatureUrl = `${req.protocol}://${req.hostname}:${process.env.PORT}/uploads/${userSignature.filename}`;
    const conflictFields = [];
    const existUserEmail: any = await getUserByEmail(req.body.emailId);
    const existUserMobile: any = await getUserByMobile(req.body.phoneNumber);

    if (existUserEmail) conflictFields.push("email");
    if (existUserMobile) conflictFields.push("mobile");

    if (conflictFields.length > 0) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        data: {},
        message: `This ${conflictFields.join(
          " & "
        )} is already registered with this Portal.`,
      };
    }

    // Generate and encrypt password
    const password = await RegHelper.generatePassword();
    const encryptedPassword = await EncryptPassword.encryptPassword(password);
    req.body.password = encryptedPassword;
    req.body.userPhoto = userPhotoUrl;
    req.body.userSignature = userSignatureUrl;
    // Generate custom user ID
    const id = await RegHelper.generateUserId();
    req.body.userId = id;

    // Create the new user in the database using Sequelize
    const newUser = await User.create(req.body);

    // Prepare to create modules, permissions, and submodules
    // const modulePromises = permissionsArray.map(async (permissionData: any) => {
    //   // Create the Module associated with the user
    //   const module = await Module.create({
    //     moduleId: permissionData.moduleId,
    //     moduleName: permissionData.moduleName,
    //     moduleType: permissionData.moduleType,
    //     userId: newUser.id, // Link the module to the user
    //   });

    //   // Create Permissions for the module
    //   const permission: any = await Permission.create({
    //     read: permissionData.submodule.reduce(
    //       (acc: any, sub: any) => sub.permissions.read,
    //       0
    //     ),
    //     create: permissionData.submodule.reduce(
    //       (acc: any, sub: any) => sub.permissions.create,
    //       0
    //     ),
    //     edit: permissionData.submodule.reduce(
    //       (acc: any, sub: any) => sub.permissions.edit,
    //       0
    //     ),
    //     delete: permissionData.submodule.reduce(
    //       (acc: any, sub: any) => sub.permissions.delete,
    //       0
    //     ),
    //     userId: newUser.id, // Link permission to the user
    //   });

    //   // Loop through submodules and create each one, linking to the created permission
    //   const submodulePromises = permissionData.submodule.map(
    //     async (submoduleData: any) => {
    //       const submodule = await Submodule.create({
    //         submoduleId: submoduleData.submoduleId,
    //         submoduleName: submoduleData.submoduleName,
    //         permissionId: permission.id, // Link submodule to permission
    //       });
    //       return submodule;
    //     }
    //   );

    //   // Wait for all submodule creations to complete
    //   await Promise.all(submodulePromises);

    //   return { module, permission };
    // });

    // // Wait for all modules, permissions, and submodules to be created
    // const userModules = await Promise.all(modulePromises);

    // // Check if module and permission creation was successful
    // if (userModules.some(({ module, permission }) => !module || !permission)) {
    //   return {
    //     error: true,
    //     statusCode: httpStatus.CONFLICT,
    //     data: {},
    //     message: `Failed to create modules, permissions, or submodules.`,
    //   };
    // }

    // Exclude sensitive data (like password) from the response
    console.log(password);
    const { password: _, ...userResponse } = newUser.toJSON();
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: userResponse,
      password: password, // You may choose not to return the password
      message: "New user is created along with modules permissions.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

/**
 * Get user by email using Sequelize
 */
const getUserByEmail = async (emailId: string): Promise<any> => {
  const user = await User.findOne({
    include: [
      {
        model: Role,
        as: "role",
        include: [
          {
            model: Access,
            as: "access",
          },
        ],
      },
    ],
    where: {
      emailId: emailId,
    },
  });
  return user;
};

/**
 * Get user by mobile using Sequelize
 */
const getUserByMobile = async (phoneNumber: string): Promise<any> => {
  const user = await User.findOne({
    include: [
      {
        model: Role,
        as: "role",
        include: [
          {
            model: Access,
            as: "access",
          },
        ],
      },
    ],
    where: { phoneNumber: phoneNumber },
  });
  return user;
};

const userLogin = async (
  emailId: string,
  phoneNumber: string,
  password: string,
  type: number
): Promise<IResponse> => {
  try {
    let user: any;
    if (type === 1) {
      user = await getUserByEmail(emailId);
    } else {
      user = await getUserByMobile(phoneNumber);
    }
    if (user === null) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        data: {},
        message: `Invalid credentials.`,
      };
    }
    if (
      !user ||
      !(await EncryptPassword.isPasswordMatch(
        password,
        user?.password as string
      ))
    ) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        data: {},
        message: `Invalid credentials.`,
      };
    }
    // const userPermissions = await getUserPermissions(user._id);
    const userResponse = exclude(user.toJSON(), ["password"]);

    // Add permissions to the user response
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {
        user: userResponse,
        // permissions: userPermissions,
      },
      message: "User Login Successfully",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wront`,
    };
  }
};

const userUpdate = async (userId: string, reqBody: any): Promise<IResponse> => {
  try {
    const user = await User.findOne({ where: { userId: userId } });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Candidate not found",
      };
    }
    const newUser = await User.update(reqBody, { where: { userId: userId } });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {},
      message: "Updated Succesfully",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wront.xss`,
    };
  }
};

// const getUserPermissions = async (userId: string): Promise<any[]> => {
//   return await permissios.find({ userId }).sort({ moduleId: 1 });
// };

const userGet = async (): Promise<IResponse> => {
  try {
    const users = await User.findAll({
      include: [
        {
          model: Role,
          as: "role",
        },
      ],
    });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: users,
      message: "Users fetched succesfully.",
    };
  } catch (e: any) {
    console.log(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const singleUserGet = async (id: string): Promise<IResponse> => {
  try {
    const user = await User.findOne({ where: { userId: id } });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: user,
      message: "Users fetched succesfully.",
    };
  } catch (e: any) {
    console.log(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};
export default {
  userGet,
  userCreate,
  userLogin,
  userUpdate,
  singleUserGet,
};
