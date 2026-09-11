"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const cors_1 = __importDefault(require("cors"));
const http_status_1 = __importDefault(require("http-status"));
const config_1 = __importDefault(require("./config/config"));
const morgan_1 = __importDefault(require("./config/morgan"));
const logger_1 = __importDefault(require("./config/logger"));
const xss_1 = __importDefault(require("./middlewares/xss"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const rateLimiter_1 = require("./middlewares/rateLimiter");
const v1_1 = __importDefault(require("./routes/v1"));
const error_1 = require("./middlewares/error");
const ApiError_1 = __importDefault(require("./utils/ApiError"));
const path_1 = __importDefault(require("path"));
const express_session_1 = __importDefault(require("express-session"));
const body_parser_1 = __importDefault(require("body-parser"));
const app = (0, express_1.default)();
if (config_1.default.env !== 'test') {
    app.use(morgan_1.default.successHandler);
    app.use(morgan_1.default.errorHandler);
}
// set security HTTP headers
// app.use(helmet());
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: false,
}));
// parse json request body
app.use(express_1.default.json({ limit: "60MB" }));
// parse urlencoded request body
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// sanitize request data
app.use((0, xss_1.default)());
// gzip compression
app.use((0, compression_1.default)());
// enable cors
const corsOptions = {
    origin: (origin, callback) => {
        // Allow all origins (including localhost, subdomains, and live tunnels)
        callback(null, true);
    },
    credentials: true,
};
app.use((0, cors_1.default)(corsOptions));
app.options("*", (0, cors_1.default)(corsOptions));
app.use((0, express_session_1.default)({
    secret: config_1.default.sessionSecret,
    resave: false,
    saveUninitialized: false,
}));
app.use(body_parser_1.default.json());
// limit repeated failed requests to auth endpoints
if (config_1.default.env === 'production') {
    app.use('/v1/auth', rateLimiter_1.authLimiter);
}
const allowCrossOriginUploads = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
};
const uploadsPath = path_1.default.resolve(process.cwd(), 'uploads');
app.use('/uploads', allowCrossOriginUploads, express_1.default.static(uploadsPath, {
    setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
}));
app.use('/v1/uploads', allowCrossOriginUploads, express_1.default.static(uploadsPath, {
    setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
}));
// v1 api routes
app.use('/v1', v1_1.default);
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// send back a 404 error for any unknown api request
app.use((req, res, next) => {
    logger_1.default.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    next(new ApiError_1.default(http_status_1.default.NOT_FOUND, `Route ${req.method} ${req.originalUrl} Not Found`));
});
// convert error to ApiError, if needed
app.use(error_1.errorConverter);
// handle error
app.use(error_1.errorHandler);
exports.default = app;
