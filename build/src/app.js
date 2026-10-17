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
const subscription_controller_1 = __importDefault(require("./controllers/subscription/subscription.controller"));
const error_1 = require("./middlewares/error");
const ApiError_1 = __importDefault(require("./utils/ApiError"));
const path_1 = __importDefault(require("path"));
// import session from 'express-session'; // Commented out: captcha is disabled, MemoryStore not needed in production
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
// Stripe webhook: must see the raw body (signature check), so it is mounted before the JSON parsers.
app.post('/v1/subscription/webhook', express_1.default.raw({ type: 'application/json', limit: '1mb' }), subscription_controller_1.default.stripeWebhook);
// Parse JSON request body.
// 100MB was needed while answer sheets were base64'd through JSON. They are
// multipart now and handled by their own middleware, so this only has to cover
// real JSON payloads — question paper content is the largest of them.
app.use(express_1.default.json({ limit: "25mb" }));
// parse urlencoded request body
app.use(express_1.default.urlencoded({ limit: "25mb", extended: true }));
app.use((0, cookie_parser_1.default)());
// sanitize request data
app.use((0, xss_1.default)());
// gzip compression
app.use((0, compression_1.default)());
// enable cors
// Auth also accepts cookies, so a credentialed request may only come from the
// app's own front ends (CORS_ORIGIN, comma separated; "*.example.com" allows
// subdomains). Requests without an Origin (same-origin, curl, servers) pass.
const allowedOrigins = String(config_1.default.corsOrigin || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
const isAllowedOrigin = (origin) => allowedOrigins.some((allowed) => {
    if (allowed === '*')
        return true;
    if (allowed.startsWith('*.')) {
        try {
            const host = new URL(origin).hostname;
            return host.endsWith(allowed.slice(1)) || host === allowed.slice(2);
        }
        catch (_a) {
            return false;
        }
    }
    return allowed === origin;
});
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin.replace(/\/+$/, '')))
            return callback(null, true);
        logger_1.default.warn(`CORS: blocked origin ${origin}`);
        return callback(null, false);
    },
    credentials: true,
};
app.use((0, cors_1.default)(corsOptions));
app.options("*", (0, cors_1.default)(corsOptions));
// app.use(session({
//   secret: config.sessionSecret,
//   resave: false,
//   saveUninitialized: false,
// })); // Commented out: session only used for CAPTCHA which is disabled
app.use(body_parser_1.default.json({ limit: "25mb" }));
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
// Uploaded files are data, never pages: only image/PDF extensions (and the
// extension-less files older uploads left behind) are served, the browser may
// not sniff them into another type, and the sandbox CSP stops anything that
// slips through from running script on this origin.
const SERVABLE_UPLOAD = /(^[^.]*$)|\.(png|jpe?g|webp|pdf)$/i;
// The app's own front ends preview uploads (PDFs) in iframes; no other site may frame them.
const uploadFrameAncestors = ["'self'", ...allowedOrigins].join(' ');
const uploadsStatic = [
    allowCrossOriginUploads,
    (req, res, next) => {
        let name = '';
        try {
            name = path_1.default.basename(decodeURIComponent(req.path || ''));
        }
        catch (_a) {
            return res.status(http_status_1.default.BAD_REQUEST).end();
        }
        if (!name || !SERVABLE_UPLOAD.test(name))
            return res.status(http_status_1.default.NOT_FOUND).end();
        return next();
    },
    express_1.default.static(uploadsPath, {
        dotfiles: 'deny',
        index: false,
        redirect: false,
        setHeaders: (res, filePath) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            // frame-ancestors below decides who may frame it (helmet's SAMEORIGIN would block the app).
            res.removeHeader('X-Frame-Options');
            // Chrome won't render a PDF in a sandboxed or 'none'-restricted document ("This content
            // is blocked"), so PDFs only limit framing; every other file keeps the strict sandbox.
            res.setHeader('Content-Security-Policy', /\.pdf$/i.test(filePath)
                ? `frame-ancestors ${uploadFrameAncestors}`
                : `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors ${uploadFrameAncestors}; sandbox`);
        },
    }),
];
app.use('/uploads', ...uploadsStatic);
app.use('/v1/uploads', ...uploadsStatic);
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
