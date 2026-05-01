"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeTypeContentRoot = exports.makeTypeContentChild = void 0;
function makeTypeContentChild({ content, customTypes, required, name, jsDoc }) {
    return {
        __isRoot: false,
        content,
        customTypes,
        required,
        name,
        jsDoc
    };
}
exports.makeTypeContentChild = makeTypeContentChild;
function makeTypeContentRoot({ joinOperation, name, children, required, jsDoc }) {
    return {
        __isRoot: true,
        joinOperation,
        name,
        children,
        required,
        jsDoc
    };
}
exports.makeTypeContentRoot = makeTypeContentRoot;
