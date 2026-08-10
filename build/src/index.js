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
    // Set server timeouts to 1 hour to support slow CPU model processing
    server.timeout = 3600000;
    server.keepAliveTimeout = 3600000;
    server.headersTimeout = 3605000;
};
(0, connect_1.default)(bootApp);
const shutdown = (signal) => {
    logger_1.default.info(`${signal} received. Closing server...`);
    if (server) {
        if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
        }
        server.close(() => {
            logger_1.default.info("Server closed successfully.");
            process.exit(0);
        });
        // Fallback: force exit after 1s if connections hang
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
    else {
        process.exit(0);
    }
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGUSR2", () => shutdown("SIGUSR2"));
const unexpectedErrorHandler = (error) => {
    logger_1.default.error(error);
    shutdown("UNCAUGHT_ERROR");
};
process.on("uncaughtException", unexpectedErrorHandler);
process.on("unhandledRejection", unexpectedErrorHandler);
