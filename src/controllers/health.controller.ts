import { Request, Response } from "express";
import os from "os";
import { sequelize } from "../config/sequelize";

/**
 * GET /v1/health
 * Returns server health status, uptime, memory, database connection status, and system info.
 */
export const getHealth = async (_req: Request, res: Response): Promise<any> => {
  let dbStatus = "UNKNOWN";
  try {
    await sequelize.authenticate();
    dbStatus = "CONNECTED";
  } catch (dbError: any) {
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
        platform: os.platform(),
        nodeVersion: process.version,
        hostname: os.hostname(),
      },
    });
  } catch (error: any) {
    return res.status(503).json({
      error: true,
      status: "ERROR",
      message: error.message,
    });
  }
};
