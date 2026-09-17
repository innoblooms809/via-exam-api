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
const sequelize_1 = require("sequelize");
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const sequelize_2 = require("../config/sequelize");
const class_service_1 = require("./class.service");
const academicNames_1 = require("../utils/academicNames");
const fail = (statusCode, message) => ({ error: true, statusCode, message });
const MAX_SECTIONS_PER_REQUEST = 26;
const findTeacher = (userId, instituteId) => User_modal_1.default.findOne({ where: { userId, instituteId, isDeleted: false } });
// ─── CREATE SECTION(S) ────────────────────────────────────────────────────────
// Accepts { classId | classIds[], sectionName | sectionNames[] } — every section
// is added to every class chosen.
const createSection = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const instituteId = createdBy.instituteId;
    const classIds = Array.from(new Set((Array.isArray(body.classIds) ? body.classIds : [body.classId]).filter(Boolean).map(String)));
    const sectionNames = (0, academicNames_1.uniqueNames)((_a = body.sectionNames) !== null && _a !== void 0 ? _a : body.sectionName, academicNames_1.normalizeSectionName);
    if (classIds.length === 0)
        return fail(http_status_1.default.BAD_REQUEST, "Choose at least one class.");
    if (sectionNames.length === 0)
        return fail(http_status_1.default.BAD_REQUEST, "Enter at least one section.");
    if (sectionNames.length > MAX_SECTIONS_PER_REQUEST || classIds.length > 50) {
        return fail(http_status_1.default.BAD_REQUEST, `You can add up to ${MAX_SECTIONS_PER_REQUEST} sections to 50 classes at a time.`);
    }
    const tooLong = sectionNames.find((n) => n.length > 20);
    if (tooLong)
        return fail(http_status_1.default.BAD_REQUEST, `Section "${tooLong.slice(0, 20)}" is too long (max 20 characters).`);
    const classTeacherId = body.classTeacherId ? String(body.classTeacherId) : null;
    if (classTeacherId && !(yield findTeacher(classTeacherId, instituteId))) {
        return fail(http_status_1.default.NOT_FOUND, "Teacher not found.");
    }
    const t = yield sequelize_2.sequelize.transaction();
    try {
        const classes = yield Class_modal_1.default.findAll({
            where: { classId: { [sequelize_1.Op.in]: classIds }, instituteId, isDeleted: false },
            transaction: t,
        });
        if (classes.length !== classIds.length) {
            yield t.rollback();
            return fail(http_status_1.default.NOT_FOUND, "One of the chosen classes was not found. Refresh and try again.");
        }
        let added = 0;
        const skipped = [];
        for (const cls of classes.sort((a, b) => (0, class_service_1.compareClassNames)(a.className, b.className))) {
            const current = yield Section_modal_1.default.findAll({ where: { classId: cls.classId }, transaction: t });
            const byKey = new Map(current.map((s) => [(0, academicNames_1.nameKey)(s.sectionName), s]));
            for (const sectionName of sectionNames) {
                const found = byKey.get((0, academicNames_1.nameKey)(sectionName));
                if (found && !found.isDeleted) {
                    skipped.push(`${cls.className}-${found.sectionName}`);
                    continue;
                }
                if (found) {
                    yield found.update({ isDeleted: false, isActive: true, classTeacherId: classTeacherId !== null && classTeacherId !== void 0 ? classTeacherId : found.classTeacherId }, { transaction: t });
                }
                else {
                    yield Section_modal_1.default.create({
                        sectionId: yield helper_1.default.generateUserId(),
                        classId: cls.classId,
                        instituteId,
                        sectionName,
                        classTeacherId,
                    }, { transaction: t });
                }
                added += 1;
            }
        }
        if (added === 0) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, skipped.length === 1 ? `Section ${skipped[0]} already exists.` : `These sections already exist: ${skipped.join(", ")}.`);
        }
        yield t.commit();
        const parts = [`${added} ${added === 1 ? "section" : "sections"} added`];
        if (skipped.length)
            parts.push(`${skipped.join(", ")} already existed`);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: `${parts.join(" · ")}.`,
            data: { added, skipped },
        };
    }
    catch (e) {
        yield t.rollback();
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message);
    }
});
// ─── GET ALL SECTIONS ─────────────────────────────────────────────────────────
const getAllSections = (query, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = createdBy.instituteId;
        const where = { instituteId, isDeleted: false, isActive: true };
        if (query.classId)
            where.classId = query.classId;
        const sections = yield Section_modal_1.default.findAll({
            where,
            include: [
                { model: Class_modal_1.default, as: "class", attributes: ["classId", "className"], where: { isDeleted: false }, required: true },
                { model: User_modal_1.default, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        const studentRows = (yield Student_modal_1.default.findAll({
            attributes: ["sectionId", [sequelize_2.sequelize.fn("COUNT", sequelize_2.sequelize.col("id")), "count"]],
            where: { instituteId },
            group: ["sectionId"],
            raw: true,
        }));
        const students = new Map(studentRows.map((r) => [r.sectionId, Number(r.count)]));
        const rows = sections
            .map((s) => { var _a; return (Object.assign(Object.assign({}, s.toJSON()), { studentCount: (_a = students.get(s.sectionId)) !== null && _a !== void 0 ? _a : 0 })); })
            .sort((a, b) => {
            var _a, _b, _c, _d;
            return (0, class_service_1.compareClassNames)((_b = (_a = a.class) === null || _a === void 0 ? void 0 : _a.className) !== null && _b !== void 0 ? _b : "", (_d = (_c = b.class) === null || _c === void 0 ? void 0 : _c.className) !== null && _d !== void 0 ? _d : "") ||
                (0, class_service_1.compareClassNames)(a.sectionName, b.sectionName);
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Sections fetched successfully.",
            data: { sections: rows, total: rows.length },
        };
    }
    catch (e) {
        return fail(500, e.message);
    }
});
// ─── GET SECTION BY ID ────────────────────────────────────────────────────────
const getSectionById = (sectionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const section = yield Section_modal_1.default.findOne({
            where: { sectionId, instituteId: createdBy.instituteId, isDeleted: false },
            include: [
                { model: Class_modal_1.default, as: "class", attributes: ["classId", "className"], where: { isDeleted: false }, required: true },
                { model: User_modal_1.default, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        if (!section)
            return fail(404, "Section not found.");
        const studentCount = yield Student_modal_1.default.count({ where: { instituteId: createdBy.instituteId, sectionId } });
        return {
            error: false,
            statusCode: 200,
            message: "Section fetched successfully.",
            data: Object.assign(Object.assign({}, section.toJSON()), { studentCount }),
        };
    }
    catch (e) {
        return fail(500, e.message);
    }
});
// ─── UPDATE SECTION ───────────────────────────────────────────────────────────
const updateSection = (sectionId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = createdBy.instituteId;
        const section = yield Section_modal_1.default.findOne({ where: { sectionId, instituteId, isDeleted: false } });
        if (!section)
            return fail(404, "Section not found.");
        const hasName = Object.prototype.hasOwnProperty.call(body, "sectionName");
        const sectionName = hasName ? (0, academicNames_1.normalizeSectionName)(body.sectionName) : section.sectionName;
        if (!sectionName)
            return fail(http_status_1.default.BAD_REQUEST, "Section name can't be empty.");
        if (sectionName.length > 20)
            return fail(http_status_1.default.BAD_REQUEST, "Section name can be at most 20 characters.");
        if (sectionName !== section.sectionName) {
            const siblings = yield Section_modal_1.default.findAll({ where: { classId: section.classId, sectionId: { [sequelize_1.Op.ne]: sectionId } } });
            const clash = siblings.find((s) => (0, academicNames_1.nameKey)(s.sectionName) === (0, academicNames_1.nameKey)(sectionName));
            if (clash) {
                return fail(http_status_1.default.CONFLICT, clash.isDeleted
                    ? `A deleted section ${clash.sectionName} exists in this class. Add it again to restore it.`
                    : `Section ${clash.sectionName} already exists in this class.`);
            }
        }
        let classTeacherId = section.classTeacherId;
        if (body.classTeacherId !== undefined) {
            classTeacherId = body.classTeacherId ? String(body.classTeacherId) : null;
            if (classTeacherId && !(yield findTeacher(classTeacherId, instituteId))) {
                return fail(http_status_1.default.NOT_FOUND, "Teacher not found.");
            }
        }
        yield section.update({ sectionName, classTeacherId });
        yield section.reload({
            include: [
                { model: Class_modal_1.default, as: "class", attributes: ["classId", "className"] },
                { model: User_modal_1.default, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        return { error: false, statusCode: 200, message: `Section ${sectionName} updated.`, data: section };
    }
    catch (e) {
        return fail(500, e.message);
    }
});
// ─── DELETE SECTION ───────────────────────────────────────────────────────────
const deleteSection = (sectionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    try {
        const instituteId = createdBy.instituteId;
        const section = yield Section_modal_1.default.findOne({
            where: { sectionId, instituteId, isDeleted: false },
            include: [{ model: Class_modal_1.default, as: "class", attributes: ["className"] }],
        });
        if (!section)
            return fail(404, "Section not found.");
        const label = `${(_c = (_b = section.class) === null || _b === void 0 ? void 0 : _b.className) !== null && _c !== void 0 ? _c : ""}-${section.sectionName}`.replace(/^-/, "");
        const [students, exams] = yield Promise.all([
            Student_modal_1.default.count({ where: { instituteId, sectionId } }),
            Exam_modal_1.default.count({ where: { instituteId, sectionId, isDeleted: false } }),
        ]);
        if (students || exams) {
            const used = [
                students && `${students} ${students === 1 ? "student" : "students"}`,
                exams && `${exams} ${exams === 1 ? "exam" : "exams"}`,
            ]
                .filter(Boolean)
                .join(" and ");
            return fail(http_status_1.default.CONFLICT, `Section ${label} can't be deleted because it has ${used}.`);
        }
        yield section.update({ isDeleted: true, isActive: false });
        return { error: false, statusCode: 200, message: `Section ${label} deleted.`, data: {} };
    }
    catch (e) {
        return fail(500, e.message);
    }
});
exports.default = {
    createSection,
    getAllSections,
    getSectionById,
    updateSection,
    deleteSection,
};
