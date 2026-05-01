import Joi from 'joi';
/**
 * This file extends the TypeScript Types that are packaged as part of joi
 */
export interface BaseDescribe extends Joi.Description {
    flags?: {
        label?: string;
        description?: string;
        presence?: 'optional' | 'required';
        unknown?: boolean;
    };
}
export interface ArrayDescribe extends BaseDescribe {
    type: 'array';
    items: Describe[];
}
export interface ObjectDescribe extends BaseDescribe {
    type: 'object';
    keys: Record<'string', Describe>;
}
export interface AlternativesDescribe extends BaseDescribe {
    type: 'alternatives';
    matches: {
        schema: Describe;
    }[];
}
export interface StringDescribe extends BaseDescribe {
    type: 'string';
    allow?: string[];
}
export interface BasicDescribe extends BaseDescribe {
    type: 'any' | 'boolean' | 'date' | 'number';
}
export declare type Describe = ArrayDescribe | BasicDescribe | ObjectDescribe | AlternativesDescribe | StringDescribe;
//# sourceMappingURL=joiDescribeTypes.d.ts.map