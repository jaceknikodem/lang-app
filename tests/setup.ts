/**
 * Jest test setup file
 */

// Mock axios for testing - tests can override this with jest.mock('axios')
// This provides a default mock that can be customized in individual test files

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
    }),
  };
});

// Global test setup
beforeEach(() => {
  // Reset any global state before each test
});

afterEach(() => {
  // Cleanup after each test
});
