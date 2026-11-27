"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const joi_1 = __importDefault(require("joi"));
dotenv_1.default.config({ path: path_1.default.join(process.cwd(), '.env') });
const envVarsSchema = joi_1.default.object()
    .keys({
    NODE_ENV: joi_1.default.string().valid('production', 'development', 'test').required(),
    PORT: joi_1.default.number().default(3000),
    JWT_SECRET: joi_1.default.string().required().description('JWT secret key'),
    JWT_ACCESS_EXPIRATION_MINUTES: joi_1.default.number()
        .positive()
        .default(15)
        .description('minutes after which access tokens expire'),
    JWT_REFRESH_EXPIRATION_MINUTES: joi_1.default.number()
        .positive()
        .default(30)
        .description('minutes without use after which a sign-in session ends'),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: joi_1.default.number()
        .default(10)
        .description('minutes after which reset password token expires'),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: joi_1.default.number()
        .default(10)
        .description('minutes after which verify email token expires'),
    SMTP_HOST: joi_1.default.string().description('server that will send the emails'),
    SMTP_PORT: joi_1.default.number().description('port to connect to the email server'),
    SMTP_USERNAME: joi_1.default.string().description('username for email server'),
    SMTP_PASSWORD: joi_1.default.string().description('password for email server'),
    EMAIL_FROM: joi_1.default.string().description('the from field in the emails sent by the app'),
    CORS_ORIGIN: joi_1.default.string().default('http://localhost:3000'),
    SESSION_SECRET: joi_1.default.string().default('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'),
    FRONTEND_URL: joi_1.default.string().default('http://localhost:3000'),
    FIREBASE_SERVICE_ACCOUNT_PATH: joi_1.default.string().description('Path to the Firebase service-account JSON (push notifications)'),
    FIREBASE_SERVICE_ACCOUNT_JSON: joi_1.default.string().description('Firebase service-account JSON, raw or base64 (instead of the path)'),
    STRIPE_SECRET_KEY: joi_1.default.string().description('Stripe secret key (sk_test_… / sk_live_…)'),
    STRIPE_WEBHOOK_SECRET: joi_1.default.string().description('Stripe webhook signing secret (whsec_…)'),
    STRIPE_CURRENCY: joi_1.default.string().lowercase().length(3).default('inr').description('Currency of plan prices and checkout')
})
    .unknown();
const { value: envVars, error } = envVarsSchema
    .prefs({ errors: { label: 'key' } })
    .validate(process.env);
if (error) {
    throw new Error(`Config validation error: ${error.message}`);
}
exports.default = {
    env: envVars.NODE_ENV,
    port: envVars.PORT,
    corsOrigin: envVars.CORS_ORIGIN,
    sessionSecret: envVars.SESSION_SECRET,
    frontendUrl: envVars.FRONTEND_URL,
    jwt: {
        secret: envVars.JWT_SECRET,
        accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
        refreshExpirationMinutes: envVars.JWT_REFRESH_EXPIRATION_MINUTES,
        resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
        verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES
    },
    email: {
        smtp: {
            host: envVars.SMTP_HOST,
            port: envVars.SMTP_PORT,
            auth: {
                user: envVars.SMTP_USERNAME,
                pass: envVars.SMTP_PASSWORD
            }
        },
        from: envVars.EMAIL_FROM
    },
    ACCESS_SECRET: envVars.ACCESS_SECRET,
    REFRESH_SECTRET: envVars.REFRESH_SECTRET,
    payment: {
        secret_key: envVars.SECRET_KEY,
        secret_iv: envVars.SECRET_IV,
        ecnryption_method: envVars.ECNRYPTION_METHOD
    },
    firebase: {
        serviceAccountPath: envVars.FIREBASE_SERVICE_ACCOUNT_PATH,
        serviceAccountJson: envVars.FIREBASE_SERVICE_ACCOUNT_JSON
    },
    stripe: {
        secretKey: envVars.STRIPE_SECRET_KEY,
        webhookSecret: envVars.STRIPE_WEBHOOK_SECRET,
        currency: envVars.STRIPE_CURRENCY
    }
};
