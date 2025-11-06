/**
 * Jest test setup file
 */

// Mock promise utility packages (ES modules)
jest.mock('p-retry', () => {
  return {
    __esModule: true,
    default: jest.fn((fn, options) => {
      const retries = options?.retries || 3;
      let attempt = 0;
      
      const attemptFn = async (): Promise<any> => {
        attempt++;
        try {
          return await fn();
        } catch (error) {
          // If we've exceeded retries, throw the error
          if (attempt > retries) {
            throw error;
          }
          
          // Call onFailedAttempt if provided
          if (options?.onFailedAttempt) {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            try {
              await options.onFailedAttempt({
                ...errorObj,
                attemptNumber: attempt,
                retriesLeft: retries - attempt
              } as any);
              // If onFailedAttempt didn't throw, retry
              return attemptFn();
            } catch (e) {
              // If onFailedAttempt throws, abort retries immediately
              // This happens when error is not retryable
              // Re-throw the error to stop retrying - don't retry
              // The throw will propagate up and stop the retry loop
              throw e;
            }
          } else {
            // No onFailedAttempt, retry normally
            return attemptFn();
          }
        }
      };
      
      return attemptFn();
    })
  };
});

jest.mock('p-timeout', () => {
  return {
    __esModule: true,
    default: jest.fn(async (promise, options) => {
      const timeout = options?.milliseconds || 60000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Timeout');
          error.name = 'TimeoutError';
          reject(error);
        }, timeout);
      });
      
      return Promise.race([promise, timeoutPromise]);
    })
  };
});

jest.mock('p-limit', () => {
  return {
    __esModule: true,
    default: jest.fn((concurrency) => {
      let running = 0;
      const queue: Array<() => void> = [];
      
      const limit = async (fn: () => Promise<any>) => {
        if (running < concurrency) {
          running++;
          try {
            return await fn();
          } finally {
            running--;
            if (queue.length > 0) {
              const next = queue.shift()!;
              next();
            }
          }
        } else {
          return new Promise((resolve) => {
            queue.push(async () => {
              running++;
              try {
                const result = await fn();
                resolve(result);
              } catch (error) {
                resolve(Promise.reject(error));
              } finally {
                running--;
                if (queue.length > 0) {
                  const next = queue.shift()!;
                  next();
                }
              }
            });
          });
        }
      };
      
      return limit;
    })
  };
});

// Global test setup
beforeEach(() => {
  // Reset any global state before each test
});

afterEach(() => {
  // Cleanup after each test
});