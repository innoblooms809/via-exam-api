import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export const sequelize = new Sequelize({
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USER || 'your_db_user',
    password: process.env.DB_PASSWORD || 'your_db_password',
    database: process.env.DB_NAME || 'your_db_name',
    logging: false, // You can enable logging for SQL queries if needed.
    pool: { max: Number(process.env.DB_POOL_MAX) || 5, min: 0, acquire: 30000, idle: 10000 },
  });