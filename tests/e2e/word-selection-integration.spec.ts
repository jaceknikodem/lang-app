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

  test('reproduces and verifies fix for word selection flow bug', async () => {
    // This test reproduces the exact scenario that was failing:
    // 1. Generate words with no topic
    // 2. Select none 
    // 3. Select first word
    // 4. Click Learn
    // 5. Should NOT show "No words available for learning" error

    // Step 1: Verify app loads
    await expect(page.locator('topic-selector')).toBeVisible({ timeout: 30000 });
    
    // Step 2: Generate words with no topic
    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    await generateButton.click();
    
    // Step 3: Wait for word selector with generated words
    await page.waitForSelector('word-selector', { timeout: 60000 });
    const wordItems = page.locator('word-selector .word-item');
    expect(await wordItems.count()).toBeGreaterThan(0);
    
    // Step 4: Select none
    await page.locator('word-selector button:has-text("Select None")').click();
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(0);
    
    // Step 5: Select first word
    await wordItems.first().click();
    await expect(wordItems.first()).toHaveClass(/selected/);
    
    // Step 6: Click Learn button
    const learnButton = page.locator('word-selector button.start-btn');
    await expect(learnButton).toBeEnabled();
    await learnButton.click();
    
    // Step 7: Verify learning mode loads WITHOUT the error
    await page.waitForSelector('learning-mode', { timeout: 90000 });
    
    // This is the key assertion - the bug was showing this error message
    const errorMessage = page.locator('learning-mode .error-message');
    await expect(errorMessage).not.toBeVisible();
    
    // Additional verification: sentence viewer should be present
    const sentenceViewer = page.locator('sentence-viewer');
    await expect(sentenceViewer).toBeVisible({ timeout: 30000 });
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

  test('verifies language consistency fix', async () => {
    // This test verifies that words are stored and retrieved with consistent language
    
    // Generate and process a word
    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 60000 });
    
    // Select first word
    const firstWordItem = page.locator('word-selector .word-item').first();
    await firstWordItem.click();
    
    // Start learning
    const learnButton = page.locator('word-selector button.start-btn');
    await learnButton.click();
    
    // Should load successfully (language consistency working)
    await page.waitForSelector('learning-mode', { timeout: 90000 });
    const errorMessage = page.locator('learning-mode .error-message');
    await expect(errorMessage).not.toBeVisible();
    
    // Navigate away and back to verify persistence
    await page.locator('nav button:has-text("Progress")').click();
    await expect(page.locator('progress-summary')).toBeVisible();
    
    await page.locator('nav button:has-text("Review")').click();
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    
    // Should still work (words persisted with correct language)
    await expect(page.locator('learning-mode .error-message')).not.toBeVisible();
  });
});