/**
 * End-to-end integration tests for word selection flow
 * Tests the specific scenario: generate words → select none → select first → learn
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { insertTestWord } from './test-helpers.js';

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
    
    // Insert a test word early to prevent proficiency selector from showing
    // This ensures the word is in the database before the app checks for existing words
    await insertTestWord(page);
    
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
    
    // Click quiz tab (may have words or not)
    await quizButton.click();
    
    // Should navigate to quiz mode
    await page.waitForSelector('quiz-mode', { timeout: 30000 });
    
    // Should show quiz interface
    const quizContent = page.locator('quiz-mode');
    await expect(quizContent).toBeVisible();
    
    // Wait for quiz to finish loading (either error message or quiz question)
    // The quiz-mode will show a loading state first, then either:
    // 1. An error message if no words/sentences available
    // 2. A quiz question if words with sentences are available
    // Wait for loading to finish (either error or question appears)
    try {
      // Try waiting for error message first
      await page.waitForSelector('quiz-mode .error-message', { timeout: 10000 });
    } catch {
      // If no error message, wait for quiz question
      try {
        await page.waitForSelector('quiz-mode .question-container', { timeout: 20000 });
      } catch {
        // If neither appears, check what's actually visible
        const hasLoading = await page.locator('quiz-mode .loading-container').isVisible();
        if (hasLoading) {
          // Still loading, wait a bit more
          await page.waitForTimeout(5000);
        }
      }
    }
    
    // Verify either error message or quiz question is visible
    const hasErrorMessage = await page.locator('quiz-mode .error-message').isVisible();
    const hasQuizQuestion = await page.locator('quiz-mode .question-container').isVisible();
    
    expect(hasErrorMessage || hasQuizQuestion).toBe(true);
  });

});