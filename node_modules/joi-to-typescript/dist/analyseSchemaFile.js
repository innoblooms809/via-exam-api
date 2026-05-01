"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyseSchemaFile = exports.convertSchemaInternal = void 0;
const joi_1 = __importDefault(require("joi"));
const path_1 = __importDefault(require("path"));
const index_1 = require("./index");
const parse_1 = require("./parse");
function convertSchemaInternal(settings, joi, exportedName, rootSchema) {
    var _a, _b;
    const details = joi.describe();
    const name = ((_b = (_a = details === null || details === void 0 ? void 0 : details.flags) === null || _a === void 0 ? void 0 : _a.label) === null || _b === void 0 ? void 0 : _b.replace(/\s/g, '')) || exportedName;
    if (!name) {
        throw new Error(`At least one "object" does not have a .label(). Details: ${JSON.stringify(details)}`);
    }
    if (settings.debug && name.toLowerCase().endsWith('schema')) {
        console.debug(`It is recommended you update the Joi Schema '${name}' similar to: ${name} = Joi.object().label('${name.replace('Schema', '')}')`);
    }
    // Set the label from the exportedName if missing
    if (!details.flags) {
        details.flags = { label: name };
    }
    else if (!details.flags.label) {
        // Unable to build any test cases for this line but will keep it if joi.describe() changes
        /* istanbul ignore next */
        details.flags.label = name;
    }
    const parsedSchema = parse_1.parseSchema(details, settings, false, undefined, rootSchema);
    if (parsedSchema) {
        const customTypes = parse_1.getAllCustomTypes(parsedSchema);
        const content = parse_1.typeContentToTs(settings, parsedSchema, true);
        return {
            name,
            customTypes,
            content
        };
    }
    // The only type that could return this is alternatives
    // see parseAlternatives for why this is ignored
    /* istanbul ignore next */
    return undefined;
}
exports.convertSchemaInternal = convertSchemaInternal;
/**
 * Analyse a schema file
 *
 * @param settings - Settings
 * @param schemaFileName - Schema File Name
 * @returns Schema analysis results
 */
async function analyseSchemaFile(settings, schemaFileName) {
    const allConvertedTypes = [];
    const fullFilePath = path_1.default.resolve(path_1.default.join(settings.schemaDirectory, schemaFileName));
    const schemaFile = await require(fullFilePath);
    // Create Type File Name
    const typeFileName = index_1.getTypeFileNameFromSchema(schemaFileName, settings);
    const fullOutputFilePath = path_1.default.join(settings.typeOutputDirectory, typeFileName);
    for (const exportedName in schemaFile) {
        const joiSchema = schemaFile[exportedName];
        if (!joi_1.default.isSchema(joiSchema)) {
            continue;
        }
        const convertedType = convertSchemaInternal(settings, joiSchema, exportedName, true);
        if (convertedType) {
            allConvertedTypes.push({ ...convertedType, location: fullOutputFilePath });
        }
    }
    if (allConvertedTypes.length === 0) {
        if (settings.debug) {
            console.debug(`${schemaFileName} - Skipped - no Joi Schemas found`);
        }
        return;
    }
    if (settings.debug) {
        console.debug(`${schemaFileName} - Processing`);
    }
    // Clean up type list
    // Sort Types
    const typesToBeWritten = allConvertedTypes.sort((interface1, interface2) => 0 - (interface1.name > interface2.name ? -1 : 1));
    // Write types
    const typeContent = typesToBeWritten.map(typeToBeWritten => typeToBeWritten.content);
    // Get imports for the current file
    const allExternalTypes = [];
    const allCurrentFileTypeNames = typesToBeWritten.map(typeToBeWritten => typeToBeWritten.name);
    for (const typeToBeWritten of typesToBeWritten) {
        for (const customType of typeToBeWritten.customTypes) {
            if (!allCurrentFileTypeNames.includes(customType) && !allExternalTypes.includes(typeToBeWritten)) {
                allExternalTypes.push(typeToBeWritten);
            }
        }
    }
    const fileContent = `${typeContent.join('\n\n').concat('\n')}`;
    return {
        externalTypes: allExternalTypes,
        internalTypes: typesToBeWritten,
        fileContent,
        typeFileName,
        typeFileLocation: settings.typeOutputDirectory
    };
}
exports.analyseSchemaFile = analyseSchemaFile;
