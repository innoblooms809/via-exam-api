import httpStatus from "http-status";
import propertyService from "../services/property.service";
import { Request, Response } from "express";
import sidebarService from "../services/sidebar.service";

// const getAllSidebarMenu = async (req: Request, res: Response) => {
//   try {
//     // console.log(req.body)
//     const response = await sidebarService.getAllSidebarMenu();
//     return res.status(res.statusCode).send(response);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       data: {},
//       message: "Internal Server Error",
//     });
//   }
// };

const getAllSidebarMenu = async (req: Request, res: Response) => {
  try {
    // console.log(req.body)
    const response = await sidebarService.getAllSidebarMenu();
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};
const getSidebarModules = async (req: Request, res: Response) => {
  try {
    // console.log(req.body)
    const response = await sidebarService.getModules();
    return res.status(res.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

export default { getAllSidebarMenu, getSidebarModules };
