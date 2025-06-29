export const LogLevels = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
} as const;

export type LogLevel = keyof typeof LogLevels;

// This state is internal to the logger module.
let currentLevel: LogLevel = 'info';

const logFunctions: Record<Exclude<LogLevel, 'silent'>, (...args: any[]) => void> = {
  error: console.error,
  warn: console.warn,
  info: console.log, // Use console.log for info for cleaner output
  debug: console.debug,
};

const log = (level: LogLevel, ...args: any[]): void => {
  if (level === 'silent' || LogLevels[level] > LogLevels[currentLevel]) {
    return;
  }

  logFunctions[level](...args);
};

export type Logger = {
  readonly error: (...args: any[]) => void;
  readonly warn: (...args: any[]) => void;
  readonly info: (...args: any[]) => void;
  readonly debug: (...args: any[]) => void;
  readonly setLevel: (level: LogLevel) => void;
  readonly getLevel: () => LogLevel;
};

const createLogger = (): Logger => {
  return Object.freeze({
    error: (...args: any[]) => log('error', ...args),
    warn: (...args: any[]) => log('warn', ...args),
    info: (...args: any[]) => log('info', ...args),
    debug: (...args: any[]) => log('debug', ...args),
    setLevel: (level: LogLevel) => {
      if (level in LogLevels) {
        currentLevel = level;
      }
    },
    getLevel: () => currentLevel,
  });
};

export const logger = createLogger();