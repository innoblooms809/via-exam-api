import httpStatus from "http-status";
import { sequelize } from "../config/sequelize";
import Role from "../modals/Role.modal";
import Access from "../modals/Access.modal";

const getAllRoleList = async (): Promise<any> => {
  try {
    const allRoles = await Role.findAll({
      include: [
        {
          model: Access,
          as: "access",
          required: false,
          attributes: ["moduleName", "create", "edit", "delete", "view"],
        },
      ],
    });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: allRoles,
      message: "Role with Access list is fetched.",
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

const getOneRoleAccess = async (id: any): Promise<any> => {
  try {
    const role = await Role.findOne({
      where: {
        id,
      },
      include: [
        {
          model: Access,
          as: "access",
          required: true,
          attributes: ["moduleName", "create", "edit", "delete", "view"],
        },
      ],
    });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: role,
      message: "Role with Access is fetched.",
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

const createRoleWithAccess = async (payload: any) => {
  const transaction = await sequelize.transaction();
  try {
    // Start a transaction to ensure data consistency

    // Create the Role
    const role = await Role.create(
      {
        role: payload.role,
        roleDescription: payload.roleDescription,
      },
      { transaction }
    );
    await transaction.commit();

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: role ,
      message: "Role created Successfullly",
    };
  } catch (error: any) {
    // If any error occurs, rollback the transaction
    await transaction.rollback();
    console.error(error);
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
};


const updateRoleWithAccess = async (roleId: number, payload: any) => {
  const transaction = await sequelize.transaction();

  try {
    if (!payload || !payload.access) {
      throw new Error("Access data is missing in payload");
    }

    const existingAccess = await Access.findAll({
      where: { roleId },
      transaction,
    });

    if (existingAccess.length === 0) {
      await Access.bulkCreate(
        payload.access.map((item: any) => ({
          moduleName: item.moduleName,
          create: item.create,
          edit: item.edit,
          delete: item.delete,
          view: item.view,
          roleId,
        })),
        { transaction }
      );
    } else {
      await Promise.all(
        payload.access.map((item: any) =>
          Access.update(
            {
              create: item.create,
              edit: item.edit,
              delete: item.delete,
              view: item.view,
            },
            {
              where: {
                roleId,
                moduleName: item.moduleName,
              },
              transaction,
            }
          )
        )
      );
    }

    await transaction.commit();

    return {
      error: false,
      statusCode: 201,
      message: "Role with access updated successfully",
    };
  } catch (error: any) {
    await transaction.rollback();

    return {
      error: true,
      statusCode: 500,
      message: `Failed to update role with access: ${error.message}`,
    };
  }
};

export default {
  createRoleWithAccess,
  getAllRoleList,
  getOneRoleAccess,
  updateRoleWithAccess
};
