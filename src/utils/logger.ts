export const logger = {
  info: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'test') console.info('[quadrant-care]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'test') console.warn('[quadrant-care]', ...args);
  },
  error: (...args: unknown[]) => {
    console.error('[quadrant-care]', ...args);
  },
};
