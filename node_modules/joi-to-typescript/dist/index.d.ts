import { AnySchema } from 'joi';
import { Settings, ConvertedType } from './types';
export { Settings };
export declare function convertSchema(settings: Partial<Settings>, joi: AnySchema, exportedName?: string): ConvertedType | undefined;
export declare function getTypeFileNameFromSchema(schemaFileName: string, settings: Settings): string;
/**
 * Write index.ts file
 *
 * @param settings - Settings Object
 * @param fileNamesToExport - List of file names that will be added to the index.ts file
 */
export declare function writeIndexFile(settings: Settings, fileNamesToExport: string[]): void;
/**
 * Create types from schemas from a directory
 *
 * @param settings - Configuration settings
 * @returns The success or failure of this operation
 */
export declare function convertFromDirectory(settings: Partial<Settings>): Promise<boolean>;
//# sourceMappingURL=index.d.ts.map