import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import httpStatus from 'http-status';
import config from './config/config';
import morgan from './config/morgan';
import logger from './config/logger';
import xss from './middlewares/xss';
import cookieParser from 'cookie-parser';
import { authLimiter } from './middlewares/rateLimiter';
import routes from './routes/v1';
import SubscriptionController from './controllers/subscription/subscription.controller';
import { errorConverter, errorHandler } from './middlewares/error';
import ApiError from './utils/ApiError';
import path from 'path';
// import session from 'express-session'; // Commented out: captcha is disabled, MemoryStore not needed in production
import bodyParser from 'body-parser';
const app = express();

if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// set security HTTP headers
// app.use(helmet());
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// Stripe webhook: must see the raw body (signature check), so it is mounted before the JSON parsers.
app.post('/v1/subscription/webhook', express.raw({ type: 'application/json', limit: '1mb' }), SubscriptionController.stripeWebhook);

// Parse JSON request body.
// 100MB was needed while answer sheets were base64'd through JSON. They are
// multipart now and handled by their own middleware, so this only has to cover
// real JSON payloads — question paper content is the largest of them.
app.use(express.json({ limit: "25mb" }));

// parse urlencoded request body
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use(cookieParser());

// sanitize request data
app.use(xss());

// gzip compression
app.use(compression());

// enable cors
// Auth also accepts cookies, so a credentialed request may only come from the
// app's own front ends (CORS_ORIGIN, comma separated; "*.example.com" allows
// subdomains). Requests without an Origin (same-origin, curl, servers) pass.
const allowedOrigins = String(config.corsOrigin || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const isAllowedOrigin = (origin: string) =>
  allowedOrigins.some((allowed) => {
    if (allowed === '*') return true;
    if (allowed.startsWith('*.')) {
      try {
        const host = new URL(origin).hostname;
        return host.endsWith(allowed.slice(1)) || host === allowed.slice(2);
      } catch {
        return false;
      }
    }
    return allowed === origin;
  });

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin.replace(/\/+$/, ''))) return callback(null, true);
    logger.warn(`CORS: blocked origin ${origin}`);
    return callback(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// app.use(session({
//   secret: config.sessionSecret,
//   resave: false,
//   saveUninitialized: false,
// })); // Commented out: session only used for CAPTCHA which is disabled
app.use(bodyParser.json({ limit: "25mb" }));
// limit repeated failed requests to auth endpoints
if (config.env === 'production') {
  app.use('/v1/auth', authLimiter);
}

const allowCrossOriginUploads = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

const uploadsPath = path.resolve(process.cwd(), 'uploads');

// Uploaded files are data, never pages: only image/PDF extensions (and the
// extension-less files older uploads left behind) are served, the browser may
// not sniff them into another type, and the sandbox CSP stops anything that
// slips through from running script on this origin.
const SERVABLE_UPLOAD = /(^[^.]*$)|\.(png|jpe?g|webp|pdf)$/i;
const uploadsStatic = [
  allowCrossOriginUploads,
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let name = '';
    try {
      name = path.basename(decodeURIComponent(req.path || ''));
    } catch {
      return res.status(httpStatus.BAD_REQUEST).end();
    }
    if (!name || !SERVABLE_UPLOAD.test(name)) return res.status(httpStatus.NOT_FOUND).end();
    return next();
  },
  express.static(uploadsPath, {
    dotfiles: 'deny',
    index: false,
    redirect: false,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    },
  }),
];

app.use('/uploads', ...uploadsStatic);
app.use('/v1/uploads', ...uploadsStatic);


// v1 api routes
app.use('/v1', routes);


app.use(express.static(path.join(__dirname, '../public')));

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  next(new ApiError(httpStatus.NOT_FOUND, `Route ${req.method} ${req.originalUrl} Not Found`));
});

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

export default app;
