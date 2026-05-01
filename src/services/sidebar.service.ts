import httpStatus from "http-status";
import SidebarNew from "../models/sidebarNew.model";
import { Op } from "sequelize";
import { IResponse } from "../types/response";
const getAllSidebarMenu = async (): Promise<IResponse> => {
  try {
    const sidebar = await SidebarNew.findAll({
      where: {
        kind: {
          [Op.ne]: "children",
        },
      },
      include: [
        {
          model: SidebarNew, // Include self-referencing children model
          as: "children", // Alias for the children association
          required: false, // This ensures that the children are optional
        },
      ],
      order: [["id", "ASC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: sidebar,
      message: "Fetch all sidebar.",
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

const getModules = async (): Promise<IResponse> => {
  try {
    const sidebar = await SidebarNew.findAll({
      where: {
        kind: {
          [Op.ne]: "children",
        },
      },
      attributes: ["id", "moduleName"],
      order: [["id", "ASC"]],
    });
    const sidebarJSON = sidebar
      .map((item: any) => {
        if (item.moduleName === null) {
          return null;
        }
        return item;
      })
      .filter((item) => item !== null);

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: sidebarJSON,
      message: "Fetch all sidebar Modules.",
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
export default { getAllSidebarMenu, getModules };
