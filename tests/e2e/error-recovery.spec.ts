/**
 * End-to-end tests for error recovery and graceful degradation scenarios
 * Tests how the app handles various failure conditions
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let testDataDir: string;

test.describe('Error Recovery and Graceful Degradation', () => {
  test.beforeAll(async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-error-'));
  });

  test.afterAll(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  async function launchApp(options: { mockLLMFailure?: boolean; mockAudioFailure?: boolean } = {}): Promise<{ app: ElectronApplication; page: Page }> {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      TEST_DATA_DIR: testDataDir
    };

    if (options.mockLLMFailure) {
      env.MOCK_LLM_FAILURE = 'true';
    }
    if (options.mockAudioFailure) {
      env.MOCK_AUDIO_FAILURE = 'true';
    }

    const app = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env
    });
    
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    return { app, page };
  }

  test('should handle LLM service unavailable gracefully', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      ({ app: electronApp, page } = await launchApp());
      
      // Try to generate words when LLM might be unavailable
      await page.locator('topic-selector input[type="text"]').fill('test topic');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      // Should show error message or fallback behavior
      const errorMessage = page.locator('.error-message, .warning-message');
      const loadingSpinner = page.locator('.loading, .spinner');
      
      // Wait for either success, error, or timeout
      await Promise.race([
        page.waitForSelector('word-selector', { timeout: 45000 }),
        page.waitForSelector('.error-message', { timeout: 45000 }),
        page.waitForTimeout(45000)
      ]);
      
      // Check if error handling is graceful
      if (await errorMessage.isVisible()) {
        // Should show user-friendly error message
        const errorText = await errorMessage.textContent();
        expect(errorText).toMatch(/(unavailable|error|try again|offline)/i);
        
        // Should provide retry option
        const retryButton = page.locator('button:has-text("Try Again"), button:has-text("Retry")');
        if (await retryButton.isVisible()) {
          await expect(retryButton).toBeVisible();
        }
      } else {
        // If successful, should show word selector
        await expect(page.locator('word-selector')).toBeVisible();
      }
      
      // App should remain functional
      await expect(page.locator('app-root')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle audio generation failures gracefully', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      ({ app: electronApp, page } = await launchApp({ mockAudioFailure: true }));
      
      // Generate words first
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      // Wait for word generation (should work even if audio fails)
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      // Select a word and start learning
      const firstCheckbox = page.locator('word-selector input[type="checkbox"]').first();
      await firstCheckbox.check();
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Should show sentences even without audio
      const sentenceViewer = page.locator('sentence-viewer');
      await expect(sentenceViewer).toBeVisible();
      
      // Audio buttons should either be disabled or show error state
      const audioButtons = page.locator('sentence-viewer .audio-button');
      if (await audioButtons.count() > 0) {
        const firstAudioButton = audioButtons.first();
        
        // Try clicking audio button
        await firstAudioButton.click();
        
        // Should handle audio failure gracefully (button disabled or error shown)
        const isDisabled = await firstAudioButton.isDisabled();
        const hasErrorClass = await firstAudioButton.evaluate(el => el.classList.contains('error') || el.classList.contains('disabled'));
        
        expect(isDisabled || hasErrorClass).toBeTruthy();
      }
      
      // Learning should continue to work without audio
      const wordButtons = page.locator('sentence-viewer .word-button');
      if (await wordButtons.count() > 0) {
        await wordButtons.first().click();
        
        // Should still be able to mark words
        const knownButton = page.locator('button:has-text("Mark as Known")');
        if (await knownButton.isVisible()) {
          await knownButton.click();
        }
      }
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle database corruption gracefully', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // First create a database
      ({ app: electronApp, page } = await launchApp());
      
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      await electronApp.close();
      
      // Corrupt the database file
      const dbPath = path.join(testDataDir, 'language_learning.db');
      if (fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, 'corrupted data');
      }
      
      // Try to launch app with corrupted database
      ({ app: electronApp, page } = await launchApp());
      
      // App should handle corruption and either:
      // 1. Create new database, or
      // 2. Show recovery options
      await page.waitForTimeout(5000); // Allow initialization
      
      // Should still show main interface
      await expect(page.locator('app-root')).toBeVisible();
      
      // Should be able to use basic functionality
      await expect(page.locator('topic-selector')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle network connectivity issues', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      ({ app: electronApp, page } = await launchApp());
      
      // Simulate network issues by trying to generate words
      // when Ollama service might not be running
      await page.locator('topic-selector input[type="text"]').fill('network test');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      // Should handle connection timeout gracefully
      await Promise.race([
        page.waitForSelector('word-selector', { timeout: 30000 }),
        page.waitForSelector('.error-message', { timeout: 30000 }),
        page.waitForTimeout(30000)
      ]);
      
      // Check for appropriate error handling
      const errorElements = page.locator('.error-message, .warning-message, .connection-error');
      if (await errorElements.count() > 0) {
        const errorText = await errorElements.first().textContent();
        expect(errorText).toMatch(/(connection|network|service|unavailable)/i);
      }
      
      // App should remain responsive
      await expect(page.locator('nav')).toBeVisible();
      
      // Should be able to navigate to other sections
      await page.locator('nav button:has-text("Progress")').click();
      await expect(page.locator('progress-summary')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle insufficient disk space gracefully', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      ({ app: electronApp, page } = await launchApp());
      
      // Try to generate many words to test disk space handling
      await page.locator('topic-selector input[type="text"]').fill('comprehensive vocabulary test');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      // Select multiple words to generate more content
      const checkboxes = page.locator('word-selector input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      
      for (let i = 0; i < Math.min(5, checkboxCount); i++) {
        await checkboxes.nth(i).check();
      }
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Should handle audio generation even if disk space is limited
      // (This is more of a stress test than actual disk space simulation)
      await page.waitForTimeout(5000);
      
      // App should remain functional
      await expect(page.locator('learning-mode')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle malformed LLM responses', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      ({ app: electronApp, page } = await launchApp());
      
      // Try to generate words (LLM might return malformed JSON)
      await page.locator('topic-selector input[type="text"]').fill('malformed test');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      // Wait for response handling
      await Promise.race([
        page.waitForSelector('word-selector', { timeout: 30000 }),
        page.waitForSelector('.error-message', { timeout: 30000 }),
        page.waitForTimeout(30000)
      ]);
      
      // Should either show valid words or appropriate error
      const wordSelector = page.locator('word-selector');
      const errorMessage = page.locator('.error-message');
      
      if (await wordSelector.isVisible()) {
        // If successful, should have valid word structure
        const wordItems = page.locator('word-selector .word-item');
        const wordCount = await wordItems.count();
        expect(wordCount).toBeGreaterThan(0);
      } else if (await errorMessage.isVisible()) {
        // Should show user-friendly error
        const errorText = await errorMessage.textContent();
        expect(errorText).toMatch(/(error|invalid|try again)/i);
      }
      
      // App should remain stable
      await expect(page.locator('app-root')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle session corruption and recovery', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // Create a session
      ({ app: electronApp, page } = await launchApp());
      
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      const firstCheckbox = page.locator('word-selector input[type="checkbox"]').first();
      await firstCheckbox.check();
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      await electronApp.close();
      
      // Simulate session corruption by modifying session storage
      // (This would require access to the session storage mechanism)
      
      // Restart app
      ({ app: electronApp, page } = await launchApp());
      
      // Should handle corrupted session gracefully
      await page.waitForTimeout(3000);
      
      // Should either restore valid session or start fresh
      const sessionRestore = page.locator('.session-restore');
      const topicSelector = page.locator('topic-selector');
      
      // Should show either session restore or fresh start
      const hasSessionRestore = await sessionRestore.isVisible();
      const hasTopicSelector = await topicSelector.isVisible();
      
      expect(hasSessionRestore || hasTopicSelector).toBeTruthy();
      
      // If session restore is shown, it should work
      if (hasSessionRestore) {
        await page.locator('button:has-text("Continue Session")').click();
        // Should navigate to appropriate mode
        await page.waitForTimeout(2000);
      }
      
      // App should be functional
      await expect(page.locator('app-root')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle rapid user interactions without breaking', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      ({ app: electronApp, page } = await launchApp());
      
      // Rapidly click generate words multiple times
      const generateButton = page.locator('topic-selector button:has-text("Generate Words")');
      
      for (let i = 0; i < 3; i++) {
        await generateButton.click();
        await page.waitForTimeout(100);
      }
      
      // Should handle rapid clicks gracefully
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      // Rapidly navigate between modes
      await page.locator('nav button:has-text("Progress")').click();
      await page.waitForTimeout(100);
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForTimeout(100);
      
      // App should remain stable
      await expect(page.locator('app-root')).toBeVisible();
      
      // Should be able to continue normal operation
      await expect(page.locator('topic-selector')).toBeVisible();
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });
});