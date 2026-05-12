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
const http_status_1 = __importDefault(require("http-status"));
// import { accessRoleServices } from "../services";
const accessRole_service_1 = __importDefault(require("../services/accessRole.service"));
const newAccessRoleCreate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield accessRole_service_1.default.createRoleWithAccess(req === null || req === void 0 ? void 0 : req.body);
        if (response.error) {
            return res.status(response.statusCode).send({
                message: response.message,
            });
        }
        return res.status(http_status_1.default.CREATED).send({
            message: "Role created successfully",
            data: response.data,
        });
    }
    catch (error) {
        console.error("data not Found");
        res.status(500).send({ message: "Internal Server error" });
    }
});
const getAccessRoles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield accessRole_service_1.default.getAllRoleList();
        if (response.error) {
            return res.status(response.statusCode).send({
                message: response.message,
            });
        }
        return res.status(http_status_1.default.OK).send({
            message: "Role with Access Fetched Successfully",
            data: response,
        });
    }
    catch (error) {
        console.error("data not Found");
        res.status(500).send({ message: "Internal Server error" });
    }
});
const getOneAccessRoles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req === null || req === void 0 ? void 0 : req.params;
        const response = yield accessRole_service_1.default.getOneRoleAccess(id);
        if (response.error) {
            return res.status(response.statusCode).send({
                message: response.message,
            });
        }
        return res.status(http_status_1.default.OK).send({
            message: "Role with Access Fetched Successfully",
            data: response,
        });
    }
    catch (error) {
        console.error("data not Found");
        res.status(500).send({ message: "Internal Server error" });
    }
});
const updateAccessRoles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req === null || req === void 0 ? void 0 : req.params.id);
        if (isNaN(id)) {
            return res.status(400).send({ message: 'Invalid ID' });
        }
        const response = yield accessRole_service_1.default.updateRoleWithAccess(id, req === null || req === void 0 ? void 0 : req.body);
        if (response.error) {
            return res.status(response.statusCode).send({
                message: response.message,
            });
        }
        return res.status(http_status_1.default.OK).send({
            message: "Role with Access Fetched Successfully",
            data: response,
        });
    }
    catch (error) {
        console.error("data not Found");
        res.status(500).send({ message: "Internal Server error" });
    }
});
exports.default = { newAccessRoleCreate, getAccessRoles, getOneAccessRoles, updateAccessRoles };
