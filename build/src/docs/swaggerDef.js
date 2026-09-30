"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config/config"));
const name = 'via-exam-api';
const version = '1.0.0';
const repository = 'https://github.com/innoblooms809/via-exam-api.git';
const swaggerDef = {
    openapi: '3.0.0',
    info: {
        title: `${name} API documentation`,
        version,
        license: {
            name: 'MIT',
            url: repository
        }
    },
    servers: [
        {
            url: `http://localhost:${config_1.default.port}/v1`
        }
    ]
};
exports.default = swaggerDef;
