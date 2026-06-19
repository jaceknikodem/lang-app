/**
 * Main process logger initialization
 *
 * Sets up pino logger with file rotation and console output.
 * Logs are written to both console (with pretty formatting in dev) and rotated log files.
 */

import pino from 'pino';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../../shared/utils/logger.js';
import { env } from '../../shared/config/index.js';

let loggerInstance: Logger | null = null;

const LOG_METHODS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * Wrap a pino logger so that log calls can never throw.
 *
 * The production logger writes through worker-thread transports (pino-roll,
 * pino-pretty) backed by thread-stream. During shutdown the worker thread can
 * exit before the final log lines are written — a subsequent write then throws
 * "the worker has exited". Because services log while tearing down (e.g.
 * ServiceManager.stop awaits child processes for up to 5s, then logs), this
 * surfaced as an uncaught exception when quitting the app. A logging call must
 * never crash the app, so we swallow transport errors here.
 */
function makeSafeLogger(pinoLogger: pino.Logger<string>): Logger {
  const safe: Record<string, unknown> = {};
  for (const method of LOG_METHODS) {
    safe[method] = (...args: unknown[]) => {
      try {
        (pinoLogger as unknown as Record<string, (...a: unknown[]) => void>)[method](...args);
      } catch {
        // Transport worker is gone (e.g. during shutdown); drop the line.
      }
    };
  }
  safe.child = (bindings: Record<string, unknown>) => makeSafeLogger(pinoLogger.child(bindings));
  return safe as unknown as Logger;
}

/**
 * Initialize the main process logger
 * Must be called before any other services that might log
 */
export async function initializeLogger(): Promise<Logger> {
  if (loggerInstance) {
    return loggerInstance;
  }

  // In test environments, use a simple console logger
  // Check for test environment by looking for jest or if electron is not available
  const isTestEnv =
    env === 'test' ||
    process.env.JEST_WORKER_ID !== undefined ||
    (typeof process.env.npm_lifecycle_event === 'string' &&
      process.env.npm_lifecycle_event.includes('test'));

  if (isTestEnv) {
    const testLogger = pino(
      {
        level: 'debug',
        base: {
          pid: process.pid,
          process: 'main',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination(1)
    ); // stdout

    loggerInstance = testLogger as unknown as Logger;
    return loggerInstance;
  }

  // For Electron app, use full logger with file rotation
  // Lazy import electron to avoid issues in test environments
  const { app } = await import('electron');

  // Ensure logs directory exists
  const userDataPath = app.getPath('userData');
  const logsDir = path.join(userDataPath, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Log file path
  const logFilePath = path.join(logsDir, 'app.log');

  // Configure transports
  const targets: pino.TransportTargetOptions[] = [
    // File transport with rotation using pino-roll
    {
      target: 'pino-roll',
      options: {
        file: logFilePath,
        size: '10m', // Rotate when log file reaches 10MB
        frequency: 'daily', // Also rotate daily
        limit: { count: 5 }, // Keep the last 5 log files
        mkdir: true,
        dateFormat: 'yyyy-MM-dd',
      },
    },
  ];

  // Add console transport with pretty formatting in development
  if (env !== 'production' || process.env.DEBUG === '1') {
    targets.push({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    });
  } else {
    // In production, use raw console output (JSON)
    targets.push({
      target: 'pino/file',
      options: {
        destination: 1, // stdout
      },
    });
  }

  // Create logger with transports
  const pinoLogger = pino(
    {
      level: 'debug', // Same level for dev and production
      base: {
        pid: process.pid,
        process: 'main',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.transport({
      targets,
    })
  );

  loggerInstance = makeSafeLogger(pinoLogger);
  return loggerInstance;
}

/**
 * Get the logger instance
 * Returns a no-op logger if not initialized (for safety)
 * In test environments, automatically initializes a simple logger
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    // In test environments, auto-initialize a simple logger
    const isTestEnv =
      env === 'test' ||
      process.env.JEST_WORKER_ID !== undefined ||
      (typeof process.env.npm_lifecycle_event === 'string' &&
        process.env.npm_lifecycle_event.includes('test'));

    if (isTestEnv) {
      const testLogger = pino(
        {
          level: 'debug',
          base: {
            pid: process.pid,
            process: 'main',
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        pino.destination(1)
      ); // stdout

      loggerInstance = testLogger as unknown as Logger;
      return loggerInstance;
    }

    // Return a no-op logger that won't crash if used before initialization
    return {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => getLogger(),
    } as Logger;
  }
  return loggerInstance;
}
