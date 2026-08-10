"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHealth = void 0;
const sequelize_1 = require("../config/sequelize");
/**
 * GET /v1/health
 * Returns server health status, uptime, memory, database connection status, and system info.
 */
const getHealth = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let dbStatus = "UNKNOWN";
    try {
        yield sequelize_1.sequelize.authenticate();
        dbStatus = "CONNECTED";
    }
    catch (dbError) {
        dbStatus = `DISCONNECTED: ${dbError.message}`;
    }
    try {
        const uptimeSeconds = process.uptime();
        const memUsage = process.memoryUsage();
        const isHealthy = dbStatus === "CONNECTED";
        return res.status(isHealthy ? 200 : 503).json({
            error: !isHealthy,
            status: isHealthy ? "OK" : "DEGRADED",
            message: isHealthy ? "Server is healthy" : "Database connection is unhealthy",
            database: dbStatus,
            uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${Math.floor(uptimeSeconds % 60)}s`,
            uptimeSeconds: Math.floor(uptimeSeconds),
            timestamp: new Date().toISOString(),
            memory: {
                rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
                heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            },
            system: {
                nodeVersion: process.version,
            },
        });
    }
    catch (error) {
        return res.status(503).json({
            error: true,
            status: "ERROR",
            message: error.message,
        });
    }
});
exports.getHealth = getHealth;
