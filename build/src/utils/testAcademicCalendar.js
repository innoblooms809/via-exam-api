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
const connect_1 = __importDefault(require("../db/connect"));
const AcademicCalendar_modal_1 = __importDefault(require("../modals/AcademicCalendar.modal"));
const run = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const res = yield AcademicCalendar_modal_1.default.findAll();
        console.log("SUCCESS!", res.length);
        process.exit(0);
    }
    catch (err) {
        console.error("ERROR QUERYING ACADEMIC CALENDAR:", err.message);
        console.error(err);
        process.exit(1);
    }
});
(0, connect_1.default)(run);
