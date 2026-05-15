import { Response } from "express";
import SectionService from "../services/section.service";

const createSection = async (req: any, res: Response) => {
  const result = await SectionService.createSection(
    req.body,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
};

const getAllSections = async (req: any, res: Response) => {
  const result = await SectionService.getAllSections(
    req.query,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
};

const getSectionById = async (req: any, res: Response) => {
  const result = await SectionService.getSectionById(
    req.params.sectionId,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
};

const updateSection = async (req: any, res: Response) => {
  const result = await SectionService.updateSection(
    req.params.sectionId,
    req.body,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
};

const deleteSection = async (req: any, res: Response) => {
  const result = await SectionService.deleteSection(
    req.params.sectionId,
    req.viaExamUser
  );

  return res.status(result.statusCode).send(result);
};

export default {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection,
};