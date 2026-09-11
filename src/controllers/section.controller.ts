import { Response } from "express";
import SectionService from "../services/section.service";
import httpStatus from "http-status";

const createSection = async (req: any, res: Response) => {
  try{
const result = await SectionService.createSection(
    req.body,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
}catch(e:any){
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
    error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
  });
}
  }
    

const getAllSections = async (req: any, res: Response) => {
    try
  {
    const result = await SectionService.getAllSections(
    req.query,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
}catch(e:any){
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
    error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",     
  }
    )}
};


const getSectionById = async (req: any, res: Response) => {
    try{
        const result = await SectionService.getSectionById(
            req.params.sectionId,
            req.viaExamUser
        );

        return res.status(result.statusCode).send(result);
    }catch(e:any){
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: httpStatus.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error"
        });
    }
};

const updateSection = async (req: any, res: Response) => {
  try{
    const result = await SectionService.updateSection(
      req.params.sectionId,
      req.body,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);
  }catch(e:any){
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error"
    });
  }
};

const deleteSection = async (req: any, res: Response) => {
  try{
    const result = await SectionService.deleteSection(
      req.params.sectionId,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);
  }catch(e:any){
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error"
    });
  }
};

export default {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection,
};