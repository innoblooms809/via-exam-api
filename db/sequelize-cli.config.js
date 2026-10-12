// Connection for sequelize-cli (migrations). Reads the same .env as the API,
// so check which database DB_HOST / DB_NAME point at before running anything.
require("dotenv").config({ path: require("path").join(process.cwd(), ".env") });

const connection = {
  dialect: "postgres",
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: false,
};

module.exports = {
  development: connection,
  test: connection,
  production: connection,
};
