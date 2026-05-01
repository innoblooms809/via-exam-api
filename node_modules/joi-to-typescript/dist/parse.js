"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSchema = exports.typeContentToTs = exports.getAllCustomTypes = exports.supportedJoiTypes = void 0;
const utils_1 = require("./utils");
const types_1 = require("./types");
// see __tests__/joiTypes.ts for more information
exports.supportedJoiTypes = ['array', 'object', 'alternatives', 'any', 'boolean', 'date', 'number', 'string'];
function getCommonDetails(details, settings) {
    var _a, _b, _c, _d, _e;
    const label = (_b = (_a = details.flags) === null || _a === void 0 ? void 0 : _a.label) === null || _b === void 0 ? void 0 : _b.replace(/\s/g, '');
    const description = (_c = details.flags) === null || _c === void 0 ? void 0 : _c.description;
    const presence = (_d = details.flags) === null || _d === void 0 ? void 0 : _d.presence;
    const example = (_e = details.examples) === null || _e === void 0 ? void 0 : _e[0];
    let required;
    if (presence === 'optional') {
        required = false;
    }
    else if (presence === 'required') {
        required = true;
    }
    else {
        required = settings.defaultToRequired;
    }
    return { label, jsDoc: { description, example }, required };
}
function getAllCustomTypes(parsedSchema) {
    if (parsedSchema.__isRoot) {
        return parsedSchema.children.flatMap(child => getAllCustomTypes(child));
    }
    else {
        return parsedSchema.customTypes || [];
    }
}
exports.getAllCustomTypes = getAllCustomTypes;
/**
 * Get all indent characters for this indent level
 * @param settings includes what the indent characters are
 * @param indentLevel how many indent levels
 */
function getIndentStr(settings, indentLevel) {
    return settings.indentationChacters.repeat(indentLevel);
}
/**
 * Get Interface jsDoc
 */
function getDescriptionStr(settings, name, jsDoc, indentLevel = 0) {
    var _a;
    if (!settings.commentEverything && !(jsDoc === null || jsDoc === void 0 ? void 0 : jsDoc.description) && !(jsDoc === null || jsDoc === void 0 ? void 0 : jsDoc.example)) {
        return '';
    }
    const lines = ['/**'];
    if (settings.commentEverything || (jsDoc && jsDoc.description)) {
        lines.push(` * ${(_a = jsDoc === null || jsDoc === void 0 ? void 0 : jsDoc.description) !== null && _a !== void 0 ? _a : name}`);
    }
    if (jsDoc === null || jsDoc === void 0 ? void 0 : jsDoc.example) {
        lines.push(` * @example ${jsDoc.example}`);
    }
    lines.push(' */');
    return lines.map(line => `${getIndentStr(settings, indentLevel)}${line}`).join('\n') + '\n';
}
function typeContentToTsHelper(settings, parsedSchema, indentLevel, doExport = false) {
    if (!parsedSchema.__isRoot) {
        return {
            tsContent: parsedSchema.content,
            jsDoc: parsedSchema.jsDoc
        };
    }
    const children = parsedSchema.children;
    if (doExport && !parsedSchema.name) {
        throw new Error(`Type ${JSON.stringify(parsedSchema)} needs a name to be exported`);
    }
    switch (parsedSchema.joinOperation) {
        case 'list': {
            const childrenContent = children.map(child => typeContentToTsHelper(settings, child, indentLevel));
            if (childrenContent.length > 1) {
                throw new Error('Multiple array item types not supported');
            }
            let content = childrenContent[0].tsContent;
            if (content.includes('|')) {
                // TODO: might need a better way to add the parens for union
                content = `(${content})`;
            }
            const arrayStr = `${content}[]`;
            if (doExport) {
                return {
                    tsContent: `export type ${parsedSchema.name} = ${arrayStr};`,
                    jsDoc: parsedSchema.jsDoc
                };
            }
            return { tsContent: arrayStr, jsDoc: parsedSchema.jsDoc };
        }
        case 'union': {
            const childrenContent = children.map(child => typeContentToTsHelper(settings, child, indentLevel).tsContent);
            const unionStr = childrenContent.join(' | ');
            if (doExport) {
                return { tsContent: `export type ${parsedSchema.name} = ${unionStr};`, jsDoc: parsedSchema.jsDoc };
            }
            return { tsContent: unionStr, jsDoc: parsedSchema.jsDoc };
        }
        case 'object': {
            if (!children.length && !doExport) {
                return { tsContent: 'object', jsDoc: parsedSchema.jsDoc };
            }
            // interface can have no properties {} if the joi object has none defined
            let objectStr = '{}';
            if (children.length !== 0) {
                const childrenContent = children.map(child => {
                    const childInfo = typeContentToTsHelper(settings, child, indentLevel + 1, false);
                    // forcing name to be defined here, might need a runtime check but it should be set if we are here
                    const descriptionStr = getDescriptionStr(settings, child.name, childInfo.jsDoc, indentLevel);
                    const optionalStr = child.required ? '' : '?';
                    const indentString = getIndentStr(settings, indentLevel);
                    return `${descriptionStr}${indentString}${child.name}${optionalStr}: ${childInfo.tsContent};`;
                });
                objectStr = `{\n${childrenContent.join('\n')}\n${getIndentStr(settings, indentLevel - 1)}}`;
            }
            if (doExport) {
                return {
                    tsContent: `export interface ${parsedSchema.name} ${objectStr}`,
                    jsDoc: parsedSchema.jsDoc
                };
            }
            return { tsContent: objectStr, jsDoc: parsedSchema.jsDoc };
        }
        default:
            throw new Error(`Unsupported join operation ${parsedSchema.joinOperation}`);
    }
}
function typeContentToTs(settings, parsedSchema, doExport = false) {
    const { tsContent, jsDoc } = typeContentToTsHelper(settings, parsedSchema, 1, doExport);
    // forcing name to be defined here, might need a runtime check but it should be set if we are here
    const descriptionStr = getDescriptionStr(settings, parsedSchema.name, jsDoc);
    return `${descriptionStr}${tsContent}`;
}
exports.typeContentToTs = typeContentToTs;
// TODO: will be issues with useLabels if a nested schema has a label but is not exported on its own
// TODO: will need to pass around ignoreLabels more
/**
 * Parses a joi schema into a TypeContent
 * @param details: the joi schema
 * @param Settings: settings used for parsing
 * @param useLabels if true and if a schema has a label we won't parse it and instead just reference the label in the outputted type
 * @param ignoreLabels a list a label to ignore if found. Sometimes nested joi schemas will inherit the parents label so we want to ignore that
 */
function parseSchema(details, settings, useLabels = true, ignoreLabels = [], rootSchema) {
    function parseHelper() {
        switch (details.type) {
            case 'array':
                return parseArray(details, settings);
            case 'string':
                return parseStringSchema(details, settings, rootSchema !== null && rootSchema !== void 0 ? rootSchema : false);
            case 'alternatives':
                return parseAlternatives(details, settings);
            case 'object':
                return parseObjects(details, settings);
            default:
                return parseBasicSchema(details, settings, rootSchema !== null && rootSchema !== void 0 ? rootSchema : false);
        }
    }
    const { label, jsDoc, required } = getCommonDetails(details, settings);
    if (label && useLabels && !ignoreLabels.includes(label)) {
        // skip parsing and just reference the label since we assumed we parsed the schema that the label references
        // TODO: do we want to use the labels description if we reference it?
        const child = types_1.makeTypeContentChild({ content: label, customTypes: [label], jsDoc, required });
        const allowedValues = createAllowTypes(details);
        if (allowedValues.length !== 0) {
            allowedValues.unshift(child);
            return types_1.makeTypeContentRoot({ joinOperation: 'union', name: '', children: allowedValues, jsDoc, required });
        }
        return child;
    }
    if (settings.debug && !exports.supportedJoiTypes.includes(details.type)) {
        console.debug(`unsupported type: ${details.type}`);
        return undefined;
    }
    const parsedSchema = parseHelper();
    if (!parsedSchema) {
        return undefined;
    }
    parsedSchema.name = label;
    parsedSchema.jsDoc = jsDoc;
    parsedSchema.required = required;
    return parsedSchema;
}
exports.parseSchema = parseSchema;
function parseBasicSchema(details, settings, rootSchema) {
    const { label: name, jsDoc } = getCommonDetails(details, settings);
    const joiType = details.type;
    let content = joiType;
    if (joiType === 'date') {
        content = 'Date';
    }
    const values = details.allow;
    // at least one value
    if (values && values.length !== 0) {
        const allowedValues = createAllowTypes(details);
        if (values[0] === null) {
            allowedValues.unshift(types_1.makeTypeContentChild({ content }));
        }
        return types_1.makeTypeContentRoot({ joinOperation: 'union', children: allowedValues, name, jsDoc });
    }
    if (rootSchema) {
        return types_1.makeTypeContentRoot({
            joinOperation: 'union',
            children: [types_1.makeTypeContentChild({ content, name, jsDoc })],
            name,
            jsDoc
        });
    }
    else {
        return types_1.makeTypeContentChild({ content, name, jsDoc });
    }
}
function createAllowTypes(details) {
    const values = details.allow;
    // at least one value
    if (values && values.length !== 0) {
        const allowedValues = values.map((value) => types_1.makeTypeContentChild({ content: typeof value === 'string' ? utils_1.toStringLiteral(value) : `${value}` }));
        return allowedValues;
    }
    return [];
}
/**
 * `undefined` is not part of this list as that would make the field optional instead
 */
const stringAllowValues = [null, ''];
function parseStringSchema(details, settings, rootSchema) {
    const { label: name, jsDoc } = getCommonDetails(details, settings);
    const values = details.allow;
    // at least one value
    if (values && values.length !== 0) {
        if (values.length === 1 && values[0] === '') {
            // special case of empty string sometimes used in Joi to allow just empty string
        }
        else {
            const allowedValues = values.map(value => stringAllowValues.includes(value) && value !== ''
                ? types_1.makeTypeContentChild({ content: `${value}` })
                : types_1.makeTypeContentChild({ content: utils_1.toStringLiteral(value) }));
            if (values.filter(value => stringAllowValues.includes(value)).length == values.length) {
                allowedValues.unshift(types_1.makeTypeContentChild({ content: 'string' }));
            }
            return types_1.makeTypeContentRoot({ joinOperation: 'union', children: allowedValues, name, jsDoc });
        }
    }
    if (rootSchema) {
        return types_1.makeTypeContentRoot({
            joinOperation: 'union',
            children: [types_1.makeTypeContentChild({ content: 'string', name, jsDoc })],
            name,
            jsDoc
        });
    }
    else {
        return types_1.makeTypeContentChild({ content: 'string', name, jsDoc });
    }
}
function parseArray(details, settings) {
    // TODO: handle multiple things in the items arr
    const item = details.items ? details.items[0] : { type: 'any' };
    const { label: name, jsDoc } = getCommonDetails(details, settings);
    const child = parseSchema(item, settings);
    if (!child) {
        return undefined;
    }
    const allowedValues = createAllowTypes(details);
    // at least one value
    if (allowedValues.length !== 0) {
        allowedValues.unshift(types_1.makeTypeContentRoot({ joinOperation: 'list', children: [child], name, jsDoc }));
        return types_1.makeTypeContentRoot({ joinOperation: 'union', children: allowedValues, name, jsDoc });
    }
    return types_1.makeTypeContentRoot({ joinOperation: 'list', children: [child], name, jsDoc });
}
function parseAlternatives(details, settings) {
    const { label, jsDoc } = getCommonDetails(details, settings);
    const ignoreLabels = label ? [label] : [];
    const children = utils_1.filterMap(details.matches, match => {
        return parseSchema(match.schema, settings, true, ignoreLabels);
    });
    // This is an check that cannot be tested as Joi throws an error before this package
    // can be called, there is test for it in alternatives
    if (children.length === 0) {
        /* istanbul ignore next */
        return undefined;
    }
    return types_1.makeTypeContentRoot({ joinOperation: 'union', children, name: label, jsDoc });
}
function parseObjects(details, settings) {
    var _a;
    let children = utils_1.filterMap(Object.entries(details.keys || {}), ([key, value]) => {
        const parsedSchema = parseSchema(value, settings);
        // The only type that could return this is alternatives
        // see parseAlternatives for why this is ignored
        if (!parsedSchema) {
            return undefined;
        }
        parsedSchema.name = /^[$A-Z_][0-9A-Z_$]*$/i.test(key || '') ? key : `'${key}'`;
        return parsedSchema;
    });
    if (((_a = details === null || details === void 0 ? void 0 : details.flags) === null || _a === void 0 ? void 0 : _a.unknown) === true) {
        const unknownProperty = {
            content: 'any',
            name: '[x: string]',
            required: true,
            jsDoc: { description: 'Unknown Property' }
        };
        children.push(unknownProperty);
    }
    if (settings.sortPropertiesByName) {
        children = children.sort((a, b) => {
            if (a.name > b.name) {
                return 1;
            }
            else if (a.name < b.name) {
                return -1;
            }
            // this next line can never happen as the object is totally invalid as the object is invalid
            // the code would not build so ignoring this
            /* istanbul ignore next */
            return 0;
        });
    }
    const { label: name, jsDoc } = getCommonDetails(details, settings);
    const allowedValues = createAllowTypes(details);
    // at least one value
    if (allowedValues.length !== 0) {
        allowedValues.unshift(types_1.makeTypeContentRoot({ joinOperation: 'object', children, name, jsDoc }));
        return types_1.makeTypeContentRoot({ joinOperation: 'union', children: allowedValues, name, jsDoc });
    }
    return types_1.makeTypeContentRoot({ joinOperation: 'object', children, name, jsDoc });
}
