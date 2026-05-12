"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const package_json_1 = require("../../package.json");
const config_1 = __importDefault(require("../config/config"));
const swaggerDef = {
    openapi: '3.0.0',
    info: {
        title: `${package_json_1.name} API documentation`,
        version: package_json_1.version,
        license: {
            name: 'MIT',
            url: package_json_1.repository
        }
    },
    servers: [
        {
            url: `http://localhost:${config_1.default.port}/v1`
        }
    ]
};
exports.default = swaggerDef;
