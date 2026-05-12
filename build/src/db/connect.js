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
const logger_1 = __importDefault(require("../config/logger"));
const sequelize_1 = require("../config/sequelize");
const connectDB = (fn) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield sequelize_1.sequelize.authenticate();
        logger_1.default.info("Connected to PostgreSQL Database");
        yield sequelize_1.sequelize.sync({ force: false }); // Sync models with the database
        logger_1.default.info("Models synced with PostgreSQL");
        fn();
    }
    catch (err) {
        logger_1.default.error(`Error connecting to PostgreSQL: ${err.message}`);
        // Exit process with failure
        process.exit(1);
    }
});
exports.default = connectDB;
