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
const app_1 = __importDefault(require("./app"));
const config_1 = __importDefault(require("./config/config"));
const logger_1 = __importDefault(require("./config/logger"));
const connect_1 = __importDefault(require("./db/connect")); // Change to sequelize connection
const superAdmin_1 = __importDefault(require("./config/superAdmin"));
let server;
const bootApp = () => {
    server = app_1.default.listen(config_1.default.port, () => __awaiter(void 0, void 0, void 0, function* () {
        logger_1.default.info(`Listening on port ${config_1.default.port}`);
        yield (0, superAdmin_1.default)();
    }));
};
(0, connect_1.default)(bootApp);
const exitHandler = () => {
    if (server) {
        server.close(() => {
            logger_1.default.info("Server closed");
            process.exit(1);
        });
    }
    else {
        process.exit(1);
    }
};
const unexpectedErrorHandler = (error) => {
    // console.error(JSON.stringify(error, null, 2));
    logger_1.default.error(error);
    exitHandler();
};
process.on("uncaughtException", unexpectedErrorHandler);
process.on("unhandledRejection", unexpectedErrorHandler);
process.on("SIGTERM", () => {
    logger_1.default.info("SIGTERM received");
    if (server) {
        server.close();
    }
});
