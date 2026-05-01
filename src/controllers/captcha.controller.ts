import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync';
import { healthCheckServices } from '../services';
import svgCaptcha from 'svg-captcha'
import session from 'express-session';

const getCaptcha = async (req:any, res:any) => {
    const captcha = svgCaptcha.create();
    req.session.captcha = captcha.text; // Save the CAPTCHA text in session
    res.set('Content-Type', 'image/svg+xml');
    res.send(captcha.data);
};

export default {
    getCaptcha
};
