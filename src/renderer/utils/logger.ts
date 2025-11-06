/**
 * Renderer process logger
 * 
 * Sends logs to the main process via IPC for centralized logging.
 */

import { Logger } from '../../shared/utils/logger.js';

// Check if electronAPI is available (will be undefined in tests)
const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

/**
 * Create a logger that sends logs to main process via IPC
 */
function createIPCLogger(): Logger {
  const log = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string, data?: any) => {
    if (electronAPI?.log) {
      // Send to main process via IPC
      electronAPI.log.log(level, message, data).catch(() => {
        // Silently fail if IPC is not available (e.g., during tests)
      });
    } else {
      // Fallback to console if IPC is not available (e.g., during tests or before preload)
      const consoleMethod = level === 'fatal' ? 'error' : level;
      if (data) {
        console[consoleMethod](`[${level.toUpperCase()}] ${message}`, data);
      } else {
        console[consoleMethod](`[${level.toUpperCase()}] ${message}`);
      }
    }
  };

  return {
    trace: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
      if (typeof msgOrObj === 'string') {
        log('trace', msgOrObj, args.length > 0 ? args : undefined);
      } else {
        log('trace', msg || '', msgOrObj);
      }
    },
    debug: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
      if (typeof msgOrObj === 'string') {
        log('debug', msgOrObj, args.length > 0 ? args : undefined);
      } else {
        log('debug', msg || '', msgOrObj);
      }
    },
    info: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
      if (typeof msgOrObj === 'string') {
        log('info', msgOrObj, args.length > 0 ? args : undefined);
      } else {
        log('info', msg || '', msgOrObj);
      }
    },
    warn: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
      if (typeof msgOrObj === 'string') {
        log('warn', msgOrObj, args.length > 0 ? args : undefined);
      } else {
        log('warn', msg || '', msgOrObj);
      }
    },
    error: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
      if (typeof msgOrObj === 'string') {
        log('error', msgOrObj, args.length > 0 ? args : undefined);
      } else {
        log('error', msg || '', msgOrObj);
      }
    },
    fatal: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
      if (typeof msgOrObj === 'string') {
        log('fatal', msgOrObj, args.length > 0 ? args : undefined);
      } else {
        log('fatal', msg || '', msgOrObj);
      }
    },
    child: (bindings: Record<string, any>) => {
      // Create a child logger with bindings
      const childLogger = createIPCLogger();
      // Apply bindings to all log calls
      const originalLog = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string, data?: any) => {
        const dataWithBindings = { ...bindings, ...(data || {}) };
        log(level, message, dataWithBindings);
      };
      return {
        trace: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
          if (typeof msgOrObj === 'string') {
            originalLog('trace', msgOrObj, args.length > 0 ? args : undefined);
          } else {
            originalLog('trace', msg || '', msgOrObj);
          }
        },
        debug: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
          if (typeof msgOrObj === 'string') {
            originalLog('debug', msgOrObj, args.length > 0 ? args : undefined);
          } else {
            originalLog('debug', msg || '', msgOrObj);
          }
        },
        info: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
          if (typeof msgOrObj === 'string') {
            originalLog('info', msgOrObj, args.length > 0 ? args : undefined);
          } else {
            originalLog('info', msg || '', msgOrObj);
          }
        },
        warn: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
          if (typeof msgOrObj === 'string') {
            originalLog('warn', msgOrObj, args.length > 0 ? args : undefined);
          } else {
            originalLog('warn', msg || '', msgOrObj);
          }
        },
        error: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
          if (typeof msgOrObj === 'string') {
            originalLog('error', msgOrObj, args.length > 0 ? args : undefined);
          } else {
            originalLog('error', msg || '', msgOrObj);
          }
        },
        fatal: (msgOrObj: string | object, msg?: string, ...args: any[]) => {
          if (typeof msgOrObj === 'string') {
            originalLog('fatal', msgOrObj, args.length > 0 ? args : undefined);
          } else {
            originalLog('fatal', msg || '', msgOrObj);
          }
        },
        child: (newBindings: Record<string, any>) => childLogger.child({ ...bindings, ...newBindings })
      } as Logger;
    }
  } as Logger;
}

// Export singleton logger instance
export const logger = createIPCLogger();

