"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const section_service_1 = __importDefault(require("../services/section.service"));
const createSection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield section_service_1.default.createSection(req.body, req.viaExamUser);
    return res.status(result.statusCode).send(result);
});
const getAllSections = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield section_service_1.default.getAllSections(req.query, req.viaExamUser);
    return res.status(result.statusCode).send(result);
});
const getSectionById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield section_service_1.default.getSectionById(req.params.sectionId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
});
const updateSection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield section_service_1.default.updateSection(req.params.sectionId, req.body, req.viaExamUser);
    return res.status(result.statusCode).send(result);
});
const deleteSection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield section_service_1.default.deleteSection(req.params.sectionId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
});
exports.default = {
    createSection,
    getAllSections,
    getSectionById,
    updateSection,
    deleteSection,
};
