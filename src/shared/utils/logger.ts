/**
 * Shared logger interface and types
 *
 * Provides a common logger interface that can be used in both main and renderer processes.
 * The actual implementation differs between processes (main uses pino directly, renderer uses IPC).
 */

/**
 * Log levels matching pino's log levels
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Logger interface compatible with pino
 * This interface allows both main and renderer processes to use the same logger API
 */
export interface Logger {
  trace(msg: string, ...args: any[]): void;
  trace(obj: object, msg?: string, ...args: any[]): void;

  debug(msg: string, ...args: any[]): void;
  debug(obj: object, msg?: string, ...args: any[]): void;

  info(msg: string, ...args: any[]): void;
  info(obj: object, msg?: string, ...args: any[]): void;

  warn(msg: string, ...args: any[]): void;
  warn(obj: object, msg?: string, ...args: any[]): void;

  error(msg: string, ...args: any[]): void;
  error(obj: object, msg?: string, ...args: any[]): void;

  fatal(msg: string, ...args: any[]): void;
  fatal(obj: object, msg?: string, ...args: any[]): void;

  child(bindings: Record<string, any>): Logger;
}
