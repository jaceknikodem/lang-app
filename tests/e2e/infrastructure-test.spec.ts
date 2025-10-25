/**
 * Test to validate E2E infrastructure is working
 */

import { test, expect } from '@playwright/test';

test.describe('E2E Infrastructure', () => {
  test('should run basic test', async () => {
    // Simple test to verify Playwright is working
    expect(1 + 1).toBe(2);
  });
});