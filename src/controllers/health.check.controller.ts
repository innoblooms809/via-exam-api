import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync';
import { healthCheckServices } from '../services';

const healthCheck = catchAsync(async (req, res) => {
  let TestBody = ''
  const logResponse = await healthCheckServices.HealthCheck(TestBody);
  res.status(httpStatus.OK).send(logResponse);
});

export default {
    healthCheck
};
