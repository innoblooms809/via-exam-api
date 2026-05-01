import httpStatus from "http-status";
import { sequelize } from "../config/sequelize";
import Role from "../models/Role.model";
import Access from "../models/Access.model";
import { IResponse } from "../types/response";

const getAllRoleList = async (): Promise<IResponse> => {
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

const getOneRoleAccess = async (id: any): Promise<IResponse> => {
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
    const existingAccess = await Access.findAll({ where: { roleId }, transaction });

    if (existingAccess.length === 0) {
      // No existing records, create new ones
      const createPromises = payload[0].access.map((accessItem: any) =>
        Access.create(
          {
            moduleName: accessItem.moduleName,
            create: accessItem.create,
            edit: accessItem.edit,
            delete: accessItem.delete,
            view: accessItem.view,
            roleId,
          },
          { transaction }
        )
      );
      await Promise.all(createPromises);
    } else {
      // Existing records found, update them
      const updatePromises = payload[0].access.map(async (accessItem: any) => {
        return Access.update(
          {
            create: accessItem.create,
            edit: accessItem.edit,
            delete: accessItem.delete,
            view: accessItem.view,
          },
          {
            where: {
              roleId,
              moduleName: accessItem.moduleName, // Match by roleId and moduleName
            },
            transaction,
          }
        );
      });
      await Promise.all(updatePromises);
    }

    // Commit the transaction
    await transaction.commit();

    return {
      error: false,
      statusCode: 201,
      message: 'Role with access updated successfully',
    };
  } catch (error: any) {
    // Rollback the transaction on error
    await transaction.rollback();
    console.error(error);
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
