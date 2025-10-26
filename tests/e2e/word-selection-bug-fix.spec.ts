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

  test('word selection flow: generate → select none → select first → learn (bug fix verification)', async () => {
    // This test reproduces the exact failing scenario and verifies the fix
    
    // 1. App loads with topic selector
    await expect(page.locator('topic-selector')).toBeVisible({ timeout: 30000 });
    
    // 2. Generate words with no topic
    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    await generateButton.click();
    
    // 3. Word selector loads with generated words
    await page.waitForSelector('word-selector', { timeout: 60000 });
    const wordItems = page.locator('word-selector .word-item');
    expect(await wordItems.count()).toBeGreaterThan(0);
    
    // 4. Select none (deselect all words)
    await page.locator('word-selector button:has-text("Select None")').click();
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(0);
    
    // 5. Select first word
    await wordItems.first().click();
    await expect(wordItems.first()).toHaveClass(/selected/);
    
    // 6. Click Learn button
    const learnButton = page.locator('word-selector button.start-btn');
    await expect(learnButton).toBeEnabled();
    await learnButton.click();
    
    // 7. Learning mode should load successfully WITHOUT the error
    // This was the bug: "No words available for learning. Please start a new learning session."
    await page.waitForSelector('learning-mode', { timeout: 90000 });
    
    // Key assertion: No error message should be shown
    const errorMessage = page.locator('learning-mode .error-message');
    await expect(errorMessage).not.toBeVisible();
    
    // Additional verification: sentence viewer should be present
    const sentenceViewer = page.locator('sentence-viewer');
    await expect(sentenceViewer).toBeVisible({ timeout: 30000 });
    
    console.log('✅ Bug fix verified: Word selection flow works correctly');
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