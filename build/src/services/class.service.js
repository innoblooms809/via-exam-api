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
exports.compareClassNames = void 0;
const http_status_1 = __importDefault(require("http-status"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const sequelize_1 = require("../config/sequelize");
const academicNames_1 = require("../utils/academicNames");
const fail = (statusCode, message) => ({ error: true, statusCode, message });
/** "2" before "10", "LKG"/"Nursery" after the numbered classes. */
const compareClassNames = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
exports.compareClassNames = compareClassNames;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// ─── CREATE CLASS(ES) ─────────────────────────────────────────────────────────
// Accepts { className } or { classNames: [] }, plus optional sections / subjects
// that are added to every class created.
const createClass = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const instituteId = createdBy.instituteId;
    const classNames = (0, academicNames_1.uniqueNames)((_a = body.classNames) !== null && _a !== void 0 ? _a : body.className, academicNames_1.normalizeClassName);
    const sectionNames = (0, academicNames_1.uniqueNames)((_b = body.sections) !== null && _b !== void 0 ? _b : [], academicNames_1.normalizeSectionName);
    const subjectNames = (0, academicNames_1.uniqueNames)((_c = body.subjects) !== null && _c !== void 0 ? _c : [], academicNames_1.normalizeSubjectName);
    if (classNames.length === 0)
        return fail(http_status_1.default.BAD_REQUEST, "Enter at least one class.");
    if (classNames.length > academicNames_1.MAX_BULK_ITEMS || sectionNames.length > 26 || subjectNames.length > academicNames_1.MAX_BULK_ITEMS) {
        return fail(http_status_1.default.BAD_REQUEST, `You can add up to ${academicNames_1.MAX_BULK_ITEMS} classes or subjects and 26 sections at a time.`);
    }
    const tooLong = [...classNames, ...sectionNames, ...subjectNames].find((n) => n.length > academicNames_1.MAX_NAME_LENGTH);
    if (tooLong)
        return fail(http_status_1.default.BAD_REQUEST, `"${tooLong.slice(0, 20)}…" is too long (max ${academicNames_1.MAX_NAME_LENGTH} characters).`);
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const existing = yield Class_modal_1.default.findAll({ where: { instituteId }, transaction: t });
        const byKey = new Map(existing.map((c) => [(0, academicNames_1.nameKey)(c.className), c]));
        const created = [];
        const restored = [];
        const skipped = [];
        const touched = [];
        for (const className of classNames) {
            const found = byKey.get((0, academicNames_1.nameKey)(className));
            if (found && !found.isDeleted) {
                skipped.push(found.className);
                continue;
            }
            if (found) {
                yield found.update({ isDeleted: false, isActive: true }, { transaction: t });
                restored.push(found.className);
                touched.push(found);
                continue;
            }
            const row = yield Class_modal_1.default.create({ classId: yield helper_1.default.generateUserId(), instituteId, className }, { transaction: t });
            created.push(className);
            touched.push(row);
        }
        // Sections and subjects for the new classes (existing ones are left as they are).
        for (const cls of touched) {
            if (sectionNames.length) {
                const current = yield Section_modal_1.default.findAll({ where: { classId: cls.classId }, transaction: t });
                const sections = new Map(current.map((s) => [(0, academicNames_1.nameKey)(s.sectionName), s]));
                for (const sectionName of sectionNames) {
                    const found = sections.get((0, academicNames_1.nameKey)(sectionName));
                    if (found) {
                        if (found.isDeleted)
                            yield found.update({ isDeleted: false, isActive: true }, { transaction: t });
                        continue;
                    }
                    yield Section_modal_1.default.create({ sectionId: yield helper_1.default.generateUserId(), classId: cls.classId, instituteId, sectionName }, { transaction: t });
                }
            }
            if (subjectNames.length) {
                const current = yield Subject_modal_1.default.findAll({ where: { classId: cls.classId }, transaction: t });
                const subjects = new Map(current.map((s) => [(0, academicNames_1.nameKey)(s.subjectName), s]));
                for (const subjectName of subjectNames) {
                    const found = subjects.get((0, academicNames_1.nameKey)(subjectName));
                    if (found) {
                        if (found.isDeleted)
                            yield found.update({ isDeleted: false, isActive: true }, { transaction: t });
                        continue;
                    }
                    yield Subject_modal_1.default.create({
                        subjectId: yield helper_1.default.generateUserId(),
                        classId: cls.classId,
                        instituteId,
                        subjectName,
                        totalMarks: 100,
                        passingMarks: 35,
                    }, { transaction: t });
                }
            }
        }
        if (created.length + restored.length === 0) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, skipped.length === 1 ? `Class ${skipped[0]} already exists.` : `Classes ${skipped.join(", ")} already exist.`);
        }
        yield t.commit();
        const added = created.length + restored.length;
        const parts = [`${added} ${added === 1 ? "class" : "classes"} added`];
        if (skipped.length)
            parts.push(`${skipped.join(", ")} already existed`);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: `${parts.join(" · ")}.`,
            data: { created, restored, skipped, classes: touched },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error("POST /v1/class/createClass 500 - Error in service:", e);
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message);
    }
});
// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = (createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = createdBy.instituteId;
        const classes = yield Class_modal_1.default.findAll({
            where: { instituteId, isActive: true, isDeleted: false },
            include: [
                { model: Section_modal_1.default, as: "sections", where: { isDeleted: false }, required: false },
                { model: Subject_modal_1.default, as: "subjects", where: { isDeleted: false }, required: false },
                { model: User_modal_1.default, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        const studentRows = (yield Student_modal_1.default.findAll({
            attributes: ["classId", [sequelize_1.sequelize.fn("COUNT", sequelize_1.sequelize.col("id")), "count"]],
            where: { instituteId },
            group: ["classId"],
            raw: true,
        }));
        const students = new Map(studentRows.map((r) => [r.classId, Number(r.count)]));
        const rows = classes
            .map((c) => {
            var _a, _b, _c;
            const json = c.toJSON();
            json.sections = [...((_a = json.sections) !== null && _a !== void 0 ? _a : [])].sort((a, b) => (0, exports.compareClassNames)(a.sectionName, b.sectionName));
            json.subjects = [...((_b = json.subjects) !== null && _b !== void 0 ? _b : [])].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
            json.studentCount = (_c = students.get(c.classId)) !== null && _c !== void 0 ? _c : 0;
            return json;
        })
            .sort((a, b) => (0, exports.compareClassNames)(a.className, b.className));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Classes fetched successfully.",
            data: { classes: rows, total: rows.length },
        };
    }
    catch (e) {
        return fail(500, e.message);
    }
});
// ─── GET ONE CLASS ────────────────────────────────────────────────────────────
const getClassById = (classId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e;
    try {
        const classData = yield Class_modal_1.default.findOne({
            where: { classId, instituteId: createdBy.instituteId, isDeleted: false },
            include: [
                { model: Section_modal_1.default, as: "sections", where: { isDeleted: false }, required: false },
                { model: Subject_modal_1.default, as: "subjects", where: { isDeleted: false }, required: false },
                { model: User_modal_1.default, as: "classTeacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        if (!classData)
            return fail(404, "Class not found.");
        const json = classData.toJSON();
        json.sections = [...((_d = json.sections) !== null && _d !== void 0 ? _d : [])].sort((a, b) => (0, exports.compareClassNames)(a.sectionName, b.sectionName));
        json.subjects = [...((_e = json.subjects) !== null && _e !== void 0 ? _e : [])].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
        json.studentCount = yield Student_modal_1.default.count({ where: { instituteId: createdBy.instituteId, classId } });
        return { error: false, statusCode: 200, message: "Class fetched successfully.", data: json };
    }
    catch (e) {
        return fail(500, e.message);
    }
});
// ─── UPDATE CLASS ─────────────────────────────────────────────────────────────
const updateClass = (classId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _f;
    const instituteId = createdBy.instituteId;
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const classData = yield Class_modal_1.default.findOne({ where: { classId, instituteId, isDeleted: false }, transaction: t });
        if (!classData) {
            yield t.rollback();
            return fail(404, "Class not found.");
        }
        const className = (0, academicNames_1.normalizeClassName)((_f = body.className) !== null && _f !== void 0 ? _f : classData.className);
        if (!className) {
            yield t.rollback();
            return fail(http_status_1.default.BAD_REQUEST, "Class name can't be empty.");
        }
        if (className.length > academicNames_1.MAX_NAME_LENGTH) {
            yield t.rollback();
            return fail(http_status_1.default.BAD_REQUEST, `Class name can be at most ${academicNames_1.MAX_NAME_LENGTH} characters.`);
        }
        const others = yield Class_modal_1.default.findAll({ where: { instituteId }, transaction: t });
        const clash = others.find((c) => c.classId !== classId && (0, academicNames_1.nameKey)(c.className) === (0, academicNames_1.nameKey)(className));
        if (clash) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, clash.isDeleted
                ? `A deleted class ${clash.className} exists. Add class ${clash.className} again to restore it.`
                : `Class ${clash.className} already exists.`);
        }
        const oldName = classData.className;
        yield classData.update({ className }, { transaction: t });
        // Student profiles keep a copy of the class name.
        if (oldName !== className) {
            yield Student_modal_1.default.update({ className }, { where: { instituteId, classId }, transaction: t });
        }
        yield t.commit();
        return { error: false, statusCode: 200, message: `Class ${className} updated.`, data: classData };
    }
    catch (e) {
        yield t.rollback();
        return fail(500, e.message);
    }
});
// ─── DELETE CLASS ─────────────────────────────────────────────────────────────
const deleteClass = (classId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    const instituteId = createdBy.instituteId;
    try {
        const classData = yield Class_modal_1.default.findOne({ where: { classId, instituteId, isDeleted: false } });
        if (!classData)
            return fail(http_status_1.default.NOT_FOUND, "Class not found.");
        const [students, exams] = yield Promise.all([
            Student_modal_1.default.count({ where: { instituteId, classId } }),
            Exam_modal_1.default.count({ where: { instituteId, classId, isDeleted: false } }),
        ]);
        if (students || exams) {
            const used = [students && plural(students, "student"), exams && plural(exams, "exam")].filter(Boolean).join(" and ");
            return fail(http_status_1.default.CONFLICT, `Class ${classData.className} can't be deleted because it has ${used}.`);
        }
        yield sequelize_1.sequelize.transaction((t) => __awaiter(void 0, void 0, void 0, function* () {
            yield classData.update({ isDeleted: true, isActive: false }, { transaction: t });
            yield Section_modal_1.default.update({ isDeleted: true, isActive: false }, { where: { classId }, transaction: t });
            yield Subject_modal_1.default.update({ isDeleted: true, isActive: false }, { where: { classId }, transaction: t });
        }));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Class ${classData.className} and its sections and subjects were deleted.`,
            data: {},
        };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
exports.default = {
    createClass,
    getAllClasses,
    getClassById,
    updateClass,
    deleteClass,
};
