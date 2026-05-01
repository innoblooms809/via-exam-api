import httpStatus from "http-status";
import { query, Request, Response } from "express";
import dynamicModuleService from "../services/dynamicModule.service";
// import { accessRoleServices } from "../services";

const dynamicModuleCreate = async (req: Request, res: Response) => {
  try {
    const response = await dynamicModuleService.createDynamicModule(req?.body);
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(response.statusCode).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const getModuleOne = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const response = await dynamicModuleService.getOneModule(id);
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const updateModule = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const response = await dynamicModuleService.updateDynamicModule(
      id,
      req?.body
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const deleteModule = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const response = await dynamicModuleService.deleteDynamicModule(id);
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const updateModuleHeading = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const response = await dynamicModuleService.updateDynamicHeading(
      id,
      req?.body
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const updateModuleField = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const response = await dynamicModuleService.updateDynamicField(
      id,
      req?.body
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const getModule = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const response = await dynamicModuleService.getAllModule();
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const getModuleBySlug = async (req: Request, res: Response) => {
  try {
    const slug = req.query.slug as string;
    const response = await dynamicModuleService.getModuleBySlug(slug);
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const oneFieldUpdate = async (req: Request, res: Response) => {
  try {
    const { moduleId, fieldId } = req?.query;
    const response = await dynamicModuleService.updateOneField(
      Number(moduleId),
      Number(fieldId),
      req?.body
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const oneHeadingUpdate = async (req: Request, res: Response) => {
  try {
    const { moduleId, headingId } = req?.query;
    const response = await dynamicModuleService.updateOneHeading(
      Number(moduleId),
      Number(headingId),
      req?.body
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const oneFieldDelete = async (req: Request, res: Response) => {
  try {
    const { moduleId, fieldId } = req?.query;
    const response = await dynamicModuleService.deleteField(
      Number(moduleId),
      Number(fieldId)
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};

const oneHeadingDelete = async (req: Request, res: Response) => {
  try {
    const { moduleId, headingId } = req?.query;
    const response = await dynamicModuleService.deleteHeading(
      Number(moduleId),
      Number(headingId)
    );
    if (response.error) {
      return res.status(response.statusCode).send({
        message: response.message,
      });
    }
    return res.status(httpStatus.OK).send({
      message: response.message,
      data: response,
    });
  } catch (error) {
    console.error("data not Found");
    res.status(500).send({ message: "Internal Server error" });
  }
};
export default {
  dynamicModuleCreate,
  getModuleOne,
  updateModuleHeading,
  updateModuleField,
  getModule,
  oneFieldUpdate,
  oneFieldDelete,
  oneHeadingUpdate,
  oneHeadingDelete,
  updateModule,
  deleteModule,
  getModuleBySlug
};
