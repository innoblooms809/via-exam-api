import config from '../config/config';

const name = 'via-exam-api';
const version = '1.0.0';
const repository = 'https://github.com/innoblooms809/via-exam-api.git';

const swaggerDef = {
  openapi: '3.0.0',
  info: {
    title: `${name} API documentation`,
    version,
    license: {
      name: 'MIT',
      url: repository
    }
  },
  servers: [
    {
      url: `http://localhost:${config.port}/v1`
    }
  ]
};

export default swaggerDef;
