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
const sequelize_1 = require("../config/sequelize");
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Access_modal_1 = __importDefault(require("../modals/Access.modal"));
const getAllRoleList = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const allRoles = yield Role_modal_1.default.findAll({
            include: [
                {
                    model: Access_modal_1.default,
                    as: "access",
                    required: false,
                    attributes: ["moduleName", "create", "edit", "delete", "view"],
                },
            ],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: allRoles,
            message: "Role with Access list is fetched.",
        };
    }
    catch (e) {
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            data: {},
            message: `Something went wrong: ${e.message}`,
        };
    }
});
const getOneRoleAccess = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const role = yield Role_modal_1.default.findOne({
            where: {
                id,
            },
            include: [
                {
                    model: Access_modal_1.default,
                    as: "access",
                    required: true,
                    attributes: ["moduleName", "create", "edit", "delete", "view"],
                },
            ],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: role,
            message: "Role with Access is fetched.",
        };
    }
    catch (e) {
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            data: {},
            message: `Something went wrong: ${e.message}`,
        };
    }
});
const createRoleWithAccess = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    const transaction = yield sequelize_1.sequelize.transaction();
    try {
        // Start a transaction to ensure data consistency
        // Create the Role
        const role = yield Role_modal_1.default.create({
            role: payload.role,
            roleDescription: payload.roleDescription,
        }, { transaction });
        yield transaction.commit();
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            data: role,
            message: "Role created Successfullly",
        };
    }
    catch (error) {
        // If any error occurs, rollback the transaction
        yield transaction.rollback();
        console.error(error);
        return {
            success: false,
            message: `Error: ${error.message}`,
        };
    }
});
const updateRoleWithAccess = (roleId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const transaction = yield sequelize_1.sequelize.transaction();
    try {
        if (!payload || !payload.access) {
            throw new Error("Access data is missing in payload");
        }
        const existingAccess = yield Access_modal_1.default.findAll({
            where: { roleId },
            transaction,
        });
        if (existingAccess.length === 0) {
            yield Access_modal_1.default.bulkCreate(payload.access.map((item) => ({
                moduleName: item.moduleName,
                create: item.create,
                edit: item.edit,
                delete: item.delete,
                view: item.view,
                roleId,
            })), { transaction });
        }
        else {
            yield Promise.all(payload.access.map((item) => Access_modal_1.default.update({
                create: item.create,
                edit: item.edit,
                delete: item.delete,
                view: item.view,
            }, {
                where: {
                    roleId,
                    moduleName: item.moduleName,
                },
                transaction,
            })));
        }
        yield transaction.commit();
        return {
            error: false,
            statusCode: 201,
            message: "Role with access updated successfully",
        };
    }
    catch (error) {
        yield transaction.rollback();
        return {
            error: true,
            statusCode: 500,
            message: `Failed to update role with access: ${error.message}`,
        };
    }
});
exports.default = {
    createRoleWithAccess,
    getAllRoleList,
    getOneRoleAccess,
    updateRoleWithAccess
};
