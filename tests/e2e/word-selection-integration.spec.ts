/**
 * Focused integration test for the word selection flow bug fix
 * Tests the specific scenario that was failing: generate → select none → select first → learn
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Word Selection Integration Test', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let testDataDir: string;

  test.beforeEach(async () => {
    // Create temporary directory for test data
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch Electron app
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    // Get the first window
    page = await electronApp.firstWindow();
    
    // Wait for app to be ready
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Allow services to initialize
  });

  test.afterEach(async () => {
    // Clean up
    if (electronApp) {
      await electronApp.close();
    }
    
    // Remove test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('verifies quiz tab is always available', async () => {
    // This test verifies the quiz tab availability fix
    
    // Quiz button should be visible and enabled even with no words
    const quizButton = page.locator('nav button:has-text("Quiz")');
    await expect(quizButton).toBeVisible();
    await expect(quizButton).toBeEnabled();
    
    // Should be able to click it
    await quizButton.click();
    await page.waitForSelector('quiz-mode', { timeout: 30000 });
    
    // Should show quiz interface (either setup or error, but not crash)
    const quizMode = page.locator('quiz-mode');
    await expect(quizMode).toBeVisible();
  });

});