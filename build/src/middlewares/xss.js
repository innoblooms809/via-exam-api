"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clean = void 0;
const xss_filters_1 = require("xss-filters");
/**
 * Clean for xss.
 * @param {string/object} data - The value to sanitize
 * @return {string/object} The sanitized value
 */
const clean = (data = '') => {
    let isObject = false;
    if (typeof data === 'object') {
        data = JSON.stringify(data);
        isObject = true;
    }
    data = (0, xss_filters_1.inHTMLData)(data).trim();
    if (isObject)
        data = JSON.parse(data);
    return data;
};
exports.clean = clean;
const middleware = () => {
    return (req, res, next) => {
        if (req.body)
            req.body = (0, exports.clean)(req.body);
        if (req.query)
            req.query = (0, exports.clean)(req.query);
        if (req.params)
            req.params = (0, exports.clean)(req.params);
        next();
    };
};
exports.default = middleware;
