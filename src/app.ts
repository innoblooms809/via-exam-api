import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import httpStatus from 'http-status';
import config from './config/config';
import morgan from './config/morgan';
import xss from './middlewares/xss';
import cookieParser from 'cookie-parser';
import { authLimiter } from './middlewares/rateLimiter';
import routes from './routes/v1';
import { errorConverter, errorHandler } from './middlewares/error';
import ApiError from './utils/ApiError';
import path from 'path';
import session from 'express-session';
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

// parse json request body
app.use(express.json({limit: "60MB"}));

// parse urlencoded request body
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// sanitize request data
app.use(xss());

// gzip compression
app.use(compression());

// enable cors
const corsOptions = {
  origin: config.corsOrigin.includes(',') 
    ? config.corsOrigin.split(',').map((o: string) => o.trim()) 
    : config.corsOrigin,
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
}));
app.use(bodyParser.json());
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

app.use(
  '/uploads',
  allowCrossOriginUploads,
  express.static(uploadsPath, {
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);


app.use(
  '/v1/uploads',
  allowCrossOriginUploads,
  express.static(uploadsPath, {
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);


// v1 api routes
app.use('/v1', routes);


app.use(express.static(path.join(__dirname, '../public')));

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

export default app;
