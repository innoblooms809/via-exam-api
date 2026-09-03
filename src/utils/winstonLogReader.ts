import fs from "fs";
import path from "path";
import readline from "readline";

export interface LogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  userId?: string;
  role?: string;
  instituteId?: string | null;
  eventType?: string;
  action?: string;
  ip?: string;
  [key: string]: any;
}

/**
 * High-performance log reader that streams the latest N lines from logs/combined.log
 * Executed in memory without touching the database.
 */
export const readLatestWinstonLogs = async (
  limit: number = 100,
  filterRole?: string,
  filterStatus?: string
): Promise<any[]> => {
  const logFilePath = path.resolve(process.cwd(), "logs", "combined.log");

  if (!fs.existsSync(logFilePath)) {
    return [];
  }

  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(logFilePath, { encoding: "utf-8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const lines: string[] = [];

    rl.on("line", (line) => {
      if (line.trim()) {
        lines.push(line);
      }
    });

    rl.on("close", () => {
      const parsedLogs: any[] = [];
      const total = lines.length;

      // Iterate in reverse (latest logs first)
      for (let i = total - 1; i >= 0 && parsedLogs.length < limit; i--) {
        try {
          const raw = lines[i];
          const entry: LogEntry = JSON.parse(raw);

          const msg = entry.message || "";
          if (filterRole && filterRole !== "ALL") {
            const cleanFilterRole = filterRole.toUpperCase().replace(/[\s_-]+/g, "");
            const entryRole = String(entry.role || msg).toUpperCase().replace(/[\s_-]+/g, "");
            if (!entryRole.includes(cleanFilterRole)) {
              continue;
            }
          }

          // Format into clean ActivityLog presentation object
          parsedLogs.push({
            eventId: `LOG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            userId: entry.userId || extractUserIdFromMsg(msg) || "SYSTEM",
            role: entry.role || extractRoleFromMsg(msg) || "SYSTEM",
            eventType: entry.eventType || extractEventTypeFromMsg(msg) || "API_REQUEST",
            currentActivity: msg.slice(0, 150),
            ipAddress: entry.ip || extractIpFromMsg(msg) || "127.0.0.1",
            createdAt: entry.timestamp || new Date().toISOString(),
            status: entry.level === "error" ? "FAILED" : "SUCCESS",
            source: "WINSTON_LOG_STREAM",
          });
        } catch (e) {
          // Ignore unparseable raw log lines
        }
      }

      resolve(parsedLogs);
    });

    rl.on("error", () => {
      resolve([]);
    });
  });
};

const extractUserIdFromMsg = (msg: string): string | null => {
  const match = msg.match(/User:\s*([^\s|]+)/i);
  return match ? match[1] : null;
};

const extractRoleFromMsg = (msg: string): string | null => {
  const match = msg.match(/\(([^)]+)\)/);
  return match ? match[1] : null;
};

const extractEventTypeFromMsg = (msg: string): string => {
  if (msg.includes("LOGIN_SUCCESS")) return "LOGIN_SUCCESS";
  if (msg.includes("LOGOUT")) return "LOGOUT";
  if (msg.includes("401") || msg.includes("403")) return "UNAUTHORIZED_ACCESS";
  if (msg.includes("500") || msg.includes("error")) return "SYSTEM_ERROR";
  return "ACTIVE_API_REQUEST";
};

const extractIpFromMsg = (msg: string): string | null => {
  const match = msg.match(/IP:\s*([^\s|]+)/i);
  return match ? match[1] : null;
};

/**
 * Reads Winston logs specifically filtered for a target userId
 */
export const readUserWinstonLogsByUserId = async (
  targetUserId: string,
  limit: number = 50
): Promise<any[]> => {
  const logFilePath = path.resolve(process.cwd(), "logs", "combined.log");
  if (!fs.existsSync(logFilePath)) return [];

  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(logFilePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const matchingLogs: any[] = [];

    rl.on("line", (line) => {
      if (line.trim() && line.includes(targetUserId)) {
        try {
          const entry: LogEntry = JSON.parse(line);
          const msg = entry.message || "";
          const evtType = entry.eventType || extractEventTypeFromMsg(msg);
          matchingLogs.push({
            eventId: entry.eventId || `WINSTON-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            userId: targetUserId,
            role: entry.role || extractRoleFromMsg(msg) || "USER",
            eventType: evtType,
            status: entry.level === "error" ? "FAILED" : "SUCCESS",
            currentActivity: msg.slice(0, 150),
            ipAddress: entry.ip || extractIpFromMsg(msg) || "127.0.0.1",
            createdAt: entry.timestamp || new Date().toISOString(),
            metadata: {
              rawMessage: msg,
              logLevel: entry.level || "info",
              source: "WINSTON_COMBINED_LOG",
              ...(entry.metadata || {}),
            },
          });
        } catch (e) {}
      }
    });

    rl.on("close", () => {
      resolve(matchingLogs.reverse().slice(0, limit));
    });

    rl.on("error", () => resolve([]));
  });
};
