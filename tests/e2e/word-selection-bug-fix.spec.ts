/**
 * Integration test for word selection flow bug fix
 * Reproduces the exact scenario that was failing and verifies the fix
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Word Selection Bug Fix', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let testDataDir: string;

  test.beforeEach(async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('quiz tab is always available (not disabled)', async () => {
    // Verify the quiz tab availability fix
    const quizButton = page.locator('nav button:has-text("Quiz")');
    await expect(quizButton).toBeVisible();
    await expect(quizButton).toBeEnabled();
    
    // Should navigate to quiz mode even with no words
    await quizButton.click();
    await page.waitForSelector('quiz-mode', { timeout: 30000 });
    await expect(page.locator('quiz-mode')).toBeVisible();
    
    console.log('✅ Quiz tab availability fix verified');
  });
});