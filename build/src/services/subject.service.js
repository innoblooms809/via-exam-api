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
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const TeacherProfile_modal_1 = __importDefault(require("../modals/TeacherProfile.modal"));
const sequelize_2 = require("../config/sequelize");
const specialization_1 = require("../utils/specialization");
const class_service_1 = require("./class.service");
const academicNames_1 = require("../utils/academicNames");
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const fail = (statusCode, message) => ({ error: true, statusCode, message });
const isBlankId = (value) => value === undefined || value === null || value === "" || value === "null";
/** Validates marks; returns cleaned numbers or an error message. */
const checkMarks = (total, passing, label = "") => {
    const totalMarks = total === undefined || total === null || total === "" ? 100 : Number(total);
    if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) {
        return { message: `${label}Total marks must be a whole number from 1 to 1000.` };
    }
    const passingMarks = passing === undefined || passing === null || passing === "" ? Math.ceil(totalMarks * 0.35) : Number(passing);
    if (!Number.isInteger(passingMarks) || passingMarks < 0) {
        return { message: `${label}Passing marks must be a whole number.` };
    }
    if (passingMarks > totalMarks)
        return { message: `${label}Passing marks can't be more than total marks.` };
    return { totalMarks, passingMarks };
};
// ─── CREATE SUBJECT(S) ──────────────────────────────────────────
// Accepts { classId | classIds[] } with either
//   subjects: [{ subjectName, totalMarks?, passingMarks?, sectionId? }]   (many at once)
// or the single fields { subjectName, subjectCode?, teacherId?, sectionId?, totalMarks?, passingMarks? }.
const createSubject = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    const instituteId = createdBy.instituteId;
    const classIds = Array.from(new Set((Array.isArray(body.classIds) ? body.classIds : [body.classId]).filter(Boolean).map(String)));
    if (classIds.length === 0)
        return fail(http_status_1.default.BAD_REQUEST, "Choose at least one class.");
    if (classIds.length > academicNames_1.MAX_BULK_ITEMS)
        return fail(http_status_1.default.BAD_REQUEST, `You can choose up to ${academicNames_1.MAX_BULK_ITEMS} classes at a time.`);
    const single = !Array.isArray(body.subjects);
    const input = single ? [body] : body.subjects;
    const sectionIdDefault = isBlankId(body.sectionId) ? null : String(body.sectionId);
    const sectionNameDefault = body.sectionName ? (0, academicNames_1.normalizeSectionName)(body.sectionName) : null;
    // Clean and de-duplicate the requested subjects.
    const subjects = [];
    const seen = new Set();
    for (const [i, item] of input.entries()) {
        const subjectName = (0, academicNames_1.normalizeSubjectName)(item === null || item === void 0 ? void 0 : item.subjectName);
        if (!subjectName)
            continue;
        const itemSecId = isBlankId(item === null || item === void 0 ? void 0 : item.sectionId) ? sectionIdDefault : String(item.sectionId);
        const itemSecName = (item === null || item === void 0 ? void 0 : item.sectionName) ? (0, academicNames_1.normalizeSectionName)(item.sectionName) : sectionNameDefault;
        const label = single ? "" : `${subjectName}: `;
        if (subjectName.length > academicNames_1.MAX_NAME_LENGTH) {
            return fail(http_status_1.default.BAD_REQUEST, `Subject ${i + 1} is too long (max ${academicNames_1.MAX_NAME_LENGTH} characters).`);
        }
        const marks = checkMarks(item === null || item === void 0 ? void 0 : item.totalMarks, item === null || item === void 0 ? void 0 : item.passingMarks, label);
        if (!("totalMarks" in marks))
            return fail(http_status_1.default.BAD_REQUEST, marks.message);
        const key = `${itemSecId || itemSecName || ""}_${(0, academicNames_1.nameKey)(subjectName)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        subjects.push({
            subjectName,
            sectionId: itemSecId,
            sectionName: itemSecName,
            totalMarks: marks.totalMarks,
            passingMarks: marks.passingMarks,
        });
    }
    if (subjects.length === 0)
        return fail(http_status_1.default.BAD_REQUEST, "Enter at least one subject.");
    if (subjects.length > academicNames_1.MAX_BULK_ITEMS)
        return fail(http_status_1.default.BAD_REQUEST, `You can add up to ${academicNames_1.MAX_BULK_ITEMS} subjects at a time.`);
    // Code and teacher only make sense for one subject in one class.
    const subjectCode = single && classIds.length === 1 ? (0, academicNames_1.normalizeSubjectCode)(body.subjectCode) : null;
    const teacherId = single && classIds.length === 1 && !isBlankId(body.teacherId) ? String(body.teacherId) : null;
    if (teacherId && !(yield User_modal_1.default.findOne({ where: { userId: teacherId, instituteId, isDeleted: false } }))) {
        return fail(http_status_1.default.NOT_FOUND, "Teacher not found.");
    }
    if (subjectCode && (yield Subject_modal_1.default.findOne({ where: { subjectCode } }))) {
        return fail(http_status_1.default.CONFLICT, `Subject code ${subjectCode} is already in use.`);
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
            const current = yield Subject_modal_1.default.findAll({ where: { classId: cls.classId }, transaction: t });
            const currentSections = yield Section_modal_1.default.findAll({ where: { classId: cls.classId }, transaction: t });
            for (const subject of subjects) {
                let targetSectionId = null;
                const secSearch = subject.sectionId || subject.sectionName;
                if (secSearch) {
                    const secById = currentSections.find((s) => s.sectionId === secSearch);
                    if (secById) {
                        if (secById.isDeleted) {
                            yield secById.update({ isDeleted: false, isActive: true }, { transaction: t });
                        }
                        targetSectionId = secById.sectionId;
                    }
                    else {
                        const secByName = currentSections.find((s) => (0, academicNames_1.nameKey)(s.sectionName) === (0, academicNames_1.nameKey)(secSearch));
                        if (secByName) {
                            if (secByName.isDeleted) {
                                yield secByName.update({ isDeleted: false, isActive: true }, { transaction: t });
                            }
                            targetSectionId = secByName.sectionId;
                        }
                        else {
                            const newSec = yield Section_modal_1.default.create({
                                sectionId: yield helper_1.default.generateUserId(),
                                classId: cls.classId,
                                instituteId,
                                sectionName: (0, academicNames_1.normalizeSectionName)(secSearch),
                            }, { transaction: t });
                            targetSectionId = newSec.sectionId;
                            currentSections.push(newSec);
                        }
                    }
                }
                const found = current.find((s) => { var _a; return ((_a = s.sectionId) !== null && _a !== void 0 ? _a : null) === targetSectionId && (0, academicNames_1.nameKey)(s.subjectName) === (0, academicNames_1.nameKey)(subject.subjectName); });
                if (found && !found.isDeleted) {
                    skipped.push(classes.length > 1 ? `${found.subjectName} (${cls.className})` : found.subjectName);
                    continue;
                }
                if (found) {
                    yield found.update(Object.assign(Object.assign({ isDeleted: false, isActive: true, sectionId: targetSectionId, subjectName: subject.subjectName, totalMarks: subject.totalMarks, passingMarks: subject.passingMarks }, (subjectCode ? { subjectCode } : {})), (teacherId ? { teacherId } : {})), { transaction: t });
                }
                else {
                    yield Subject_modal_1.default.create({
                        subjectId: yield helper_1.default.generateUserId(),
                        instituteId,
                        classId: cls.classId,
                        sectionId: targetSectionId,
                        subjectName: subject.subjectName,
                        subjectCode,
                        teacherId,
                        totalMarks: subject.totalMarks,
                        passingMarks: subject.passingMarks,
                    }, { transaction: t });
                }
                added += 1;
            }
        }
        if (added === 0) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, skipped.length === 1 ? `${skipped[0]} already exists in this class.` : `Already added: ${skipped.join(", ")}.`);
        }
        yield t.commit();
        const parts = [`${added} ${added === 1 ? "subject" : "subjects"} added`];
        if (skipped.length)
            parts.push(`${skipped.length} already existed`);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: `${parts.join(" · ")}.`,
            data: { added, skipped },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error("Error creating subject:", e);
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message || "Failed to create subject.");
    }
});
// ─── GET ALL SUBJECTS ──────────────────────────────────────────
const getAllSubjects = (query, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const where = { instituteId: createdBy.instituteId, isDeleted: false, isActive: true };
        if (query.classId)
            where.classId = query.classId;
        if (query.sectionId)
            where.sectionId = query.sectionId;
        const subjects = yield Subject_modal_1.default.findAll({
            where,
            include: [
                { model: Class_modal_1.default, as: "class", where: { isDeleted: false }, required: true },
                { model: Section_modal_1.default, as: "section", where: { isDeleted: false }, required: false },
                { model: User_modal_1.default, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        const sorted = subjects.sort((a, b) => {
            var _a, _b, _c, _d;
            return (0, class_service_1.compareClassNames)((_b = (_a = a.class) === null || _a === void 0 ? void 0 : _a.className) !== null && _b !== void 0 ? _b : "", (_d = (_c = b.class) === null || _c === void 0 ? void 0 : _c.className) !== null && _d !== void 0 ? _d : "") ||
                a.subjectName.localeCompare(b.subjectName);
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subjects fetched successfully.",
            data: { subjects: sorted, total: sorted.length },
        };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message);
    }
});
// ─── GET SUBJECT BY ID ─────────────────────────────────────────
const getSubjectById = (subjectId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const subject = yield Subject_modal_1.default.findOne({
            where: { subjectId, instituteId: createdBy.instituteId, isDeleted: false },
            include: [
                { model: Class_modal_1.default, as: "class", where: { isDeleted: false }, required: true },
                { model: Section_modal_1.default, as: "section", where: { isDeleted: false }, required: false },
                { model: User_modal_1.default, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        if (!subject)
            return fail(http_status_1.default.NOT_FOUND, "Subject not found.");
        return { error: false, statusCode: http_status_1.default.OK, message: "Subject fetched successfully.", data: subject };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message);
    }
});
// ─── UPDATE SUBJECT ────────────────────────────────────────────
const updateSubject = (subjectId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const instituteId = createdBy.instituteId;
        const subject = yield Subject_modal_1.default.findOne({ where: { subjectId, instituteId, isDeleted: false } });
        if (!subject)
            return fail(http_status_1.default.NOT_FOUND, "Subject not found.");
        const subjectName = body.subjectName !== undefined ? (0, academicNames_1.normalizeSubjectName)(body.subjectName) : subject.subjectName;
        if (!subjectName)
            return fail(http_status_1.default.BAD_REQUEST, "Subject name can't be empty.");
        if (subjectName.length > academicNames_1.MAX_NAME_LENGTH) {
            return fail(http_status_1.default.BAD_REQUEST, `Subject name can be at most ${academicNames_1.MAX_NAME_LENGTH} characters.`);
        }
        let sectionId = subject.sectionId;
        if (body.sectionId !== undefined || body.sectionName !== undefined) {
            const secSearch = isBlankId(body.sectionId) ? (body.sectionName ? String(body.sectionName) : null) : String(body.sectionId);
            if (!secSearch) {
                sectionId = null;
            }
            else {
                const classSections = yield Section_modal_1.default.findAll({ where: { classId: subject.classId, isDeleted: false } });
                const secById = classSections.find((s) => s.sectionId === secSearch);
                const secByName = classSections.find((s) => (0, academicNames_1.nameKey)(s.sectionName) === (0, academicNames_1.nameKey)(secSearch));
                sectionId = (_b = (_a = secById === null || secById === void 0 ? void 0 : secById.sectionId) !== null && _a !== void 0 ? _a : secByName === null || secByName === void 0 ? void 0 : secByName.sectionId) !== null && _b !== void 0 ? _b : null;
            }
        }
        if (subjectName !== subject.subjectName || sectionId !== subject.sectionId) {
            const siblings = yield Subject_modal_1.default.findAll({ where: { classId: subject.classId, subjectId: { [sequelize_1.Op.ne]: subjectId } } });
            const clash = siblings.find((s) => { var _a; return ((_a = s.sectionId) !== null && _a !== void 0 ? _a : null) === sectionId && (0, academicNames_1.nameKey)(s.subjectName) === (0, academicNames_1.nameKey)(subjectName); });
            if (clash) {
                return fail(http_status_1.default.CONFLICT, clash.isDeleted
                    ? `A deleted subject ${clash.subjectName} exists in this class. Add it again to restore it.`
                    : `${clash.subjectName} already exists in this class section.`);
            }
        }
        const subjectCode = body.subjectCode !== undefined ? (0, academicNames_1.normalizeSubjectCode)(body.subjectCode) : subject.subjectCode;
        if (subjectCode && subjectCode !== subject.subjectCode) {
            const taken = yield Subject_modal_1.default.findOne({ where: { subjectCode, subjectId: { [sequelize_1.Op.ne]: subjectId } } });
            if (taken)
                return fail(http_status_1.default.CONFLICT, `Subject code ${subjectCode} is already in use.`);
        }
        const marks = checkMarks((_c = body.totalMarks) !== null && _c !== void 0 ? _c : subject.totalMarks, (_d = body.passingMarks) !== null && _d !== void 0 ? _d : subject.passingMarks);
        if (!("totalMarks" in marks))
            return fail(http_status_1.default.BAD_REQUEST, marks.message);
        let teacherId = subject.teacherId;
        if (body.teacherId !== undefined) {
            teacherId = isBlankId(body.teacherId) ? null : String(body.teacherId);
            if (teacherId && !(yield User_modal_1.default.findOne({ where: { userId: teacherId, instituteId, isDeleted: false } }))) {
                return fail(http_status_1.default.NOT_FOUND, "Teacher not found.");
            }
        }
        // A (new) teacher for this subject must specialise in it.
        if (teacherId && teacherId !== subject.teacherId) {
            const profile = yield TeacherProfile_modal_1.default.findOne({ where: { userId: teacherId, instituteId } });
            if (!(0, specialization_1.specialisesIn)(profile === null || profile === void 0 ? void 0 : profile.specialization, subjectName)) {
                return fail(http_status_1.default.BAD_REQUEST, `This teacher does not specialise in ${subjectName}. Add ${subjectName} to their specialisations first.`);
            }
        }
        yield subject.update({
            subjectName,
            sectionId,
            subjectCode,
            teacherId,
            totalMarks: marks.totalMarks,
            passingMarks: marks.passingMarks,
        });
        return { error: false, statusCode: http_status_1.default.OK, message: `${subjectName} updated.`, data: subject };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message);
    }
});
// ─── DELETE SUBJECT (SOFT DELETE) ─────────────────────────────
const deleteSubject = (subjectId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = createdBy.instituteId;
        const subject = yield Subject_modal_1.default.findOne({ where: { subjectId, instituteId, isDeleted: false } });
        if (!subject)
            return fail(http_status_1.default.NOT_FOUND, "Subject not found.");
        const exams = yield Exam_modal_1.default.count({ where: { instituteId, subjectId, isDeleted: false } });
        if (exams) {
            return fail(http_status_1.default.CONFLICT, `${subject.subjectName} can't be deleted because it has ${exams} ${exams === 1 ? "exam" : "exams"}.`);
        }
        yield subject.update({ isDeleted: true, isActive: false });
        return { error: false, statusCode: http_status_1.default.OK, message: `${subject.subjectName} deleted.`, data: {} };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, e.message);
    }
});
exports.default = {
    createSubject,
    getAllSubjects,
    getSubjectById,
    updateSubject,
    deleteSubject,
};
