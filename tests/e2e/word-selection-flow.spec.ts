/**
 * End-to-end integration tests for word selection flow
 * Tests the specific scenario: generate words → select none → select first → learn
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Word Selection Flow', () => {
  test.beforeAll(async () => {
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

  test.afterAll(async () => {
    // Clean up
    await electronApp.close();
    
    // Remove test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('should handle quiz tab availability correctly', async () => {
    // Verify quiz tab is always available (not disabled)
    const quizButton = page.locator('nav button:has-text("Quiz")');
    await expect(quizButton).toBeVisible();
    await expect(quizButton).toBeEnabled();
    
    // Click quiz tab when no words exist
    await quizButton.click();
    
    // Should navigate to quiz mode
    await page.waitForSelector('quiz-mode', { timeout: 30000 });
    
    // Should show appropriate message for no words
    const quizContent = page.locator('quiz-mode');
    await expect(quizContent).toBeVisible();
    
    // The quiz should either show setup screen or error about no words
    const hasSetupScreen = await page.locator('quiz-mode .setup-container').isVisible();
    const hasErrorMessage = await page.locator('quiz-mode .error-message').isVisible();
    
    expect(hasSetupScreen || hasErrorMessage).toBe(true);
  });

});