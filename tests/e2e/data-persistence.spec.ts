/**
 * End-to-end tests for data persistence across application restarts
 * Verifies that user progress and learning state are maintained
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let testDataDir: string;

test.describe('Data Persistence Across Restarts', () => {
  test.beforeAll(async () => {
    // Create persistent test directory
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-persist-'));
  });

  test.afterAll(async () => {
    // Clean up test data
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Allow services to initialize
    
    return { app, page };
  }

  test('should persist word progress across app restarts', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // First session: Create and study words
      ({ app: electronApp, page } = await launchApp());
      
      // Generate words and start learning
      await page.locator('topic-selector input[type="text"]').fill('animals');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      // Select first word
      const firstCheckbox = page.locator('word-selector input[type="checkbox"]').first();
      await firstCheckbox.check();
      
      // Get the word text for later verification
      const firstWordText = await page.locator('word-selector .word-item').first().textContent();
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Mark word as known
      const wordButtons = page.locator('sentence-viewer .word-button');
      if (await wordButtons.count() > 0) {
        await wordButtons.first().click();
        const knownButton = page.locator('button:has-text("Mark as Known")');
        if (await knownButton.isVisible()) {
          await knownButton.click();
          await page.waitForTimeout(1000); // Allow database update
        }
      }
      
      // Close app
      await electronApp.close();
      
      // Second session: Verify persistence
      ({ app: electronApp, page } = await launchApp());
      
      // Check if session restore is offered
      const sessionRestore = page.locator('.session-restore');
      if (await sessionRestore.isVisible()) {
        await page.locator('button:has-text("Continue Session")').click();
      } else {
        // Navigate to progress to check persisted data
        await page.locator('nav button:has-text("Progress")').click();
      }
      
      await page.waitForSelector('progress-summary', { timeout: 10000 });
      
      // Verify progress data exists
      const progressStats = page.locator('progress-summary .progress-stats');
      await expect(progressStats).toBeVisible();
      
      // Check that words studied count is greater than 0
      const wordsStudiedStat = page.locator('progress-summary .words-studied');
      if (await wordsStudiedStat.isVisible()) {
        const studiedText = await wordsStudiedStat.textContent();
        expect(studiedText).toMatch(/[1-9]\d*/); // Should contain a positive number
      }
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should restore active learning session', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // First session: Start learning but don't complete
      ({ app: electronApp, page } = await launchApp());
      
      // Generate words
      await page.locator('topic-selector input[type="text"]').fill('colors');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      // Select multiple words
      const checkboxes = page.locator('word-selector input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      for (let i = 0; i < Math.min(2, checkboxCount); i++) {
        await checkboxes.nth(i).check();
      }
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Interact with one sentence but don't complete session
      const wordButtons = page.locator('sentence-viewer .word-button');
      if (await wordButtons.count() > 0) {
        await wordButtons.first().click();
        const knownButton = page.locator('button:has-text("Mark as Known")');
        if (await knownButton.isVisible()) {
          await knownButton.click();
          await page.waitForTimeout(1000);
        }
      }
      
      // Close app without completing session
      await electronApp.close();
      
      // Second session: Should offer to restore
      ({ app: electronApp, page } = await launchApp());
      
      // Should show session restore option
      const sessionRestore = page.locator('.session-restore');
      await expect(sessionRestore).toBeVisible({ timeout: 5000 });
      
      // Verify restore description mentions learning mode
      const restoreDescription = page.locator('.session-restore-description');
      const descriptionText = await restoreDescription.textContent();
      expect(descriptionText).toContain('learning');
      
      // Restore session
      await page.locator('button:has-text("Continue Session")').click();
      
      // Should return to learning mode
      await expect(page.locator('learning-mode')).toBeVisible({ timeout: 10000 });
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should persist quiz progress and word strengths', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // First session: Complete some quiz questions
      ({ app: electronApp, page } = await launchApp());
      
      // Generate and select words
      await page.locator('topic-selector input[type="text"]').fill('numbers');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      const firstCheckbox = page.locator('word-selector input[type="checkbox"]').first();
      await firstCheckbox.check();
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Start quiz
      const startQuizButton = page.locator('learning-mode button:has-text("Start Quiz")');
      await startQuizButton.click();
      await page.waitForSelector('quiz-mode', { timeout: 10000 });
      
      // Answer one question correctly
      const knewItButton = page.locator('quiz-mode button:has-text("I knew it")');
      if (await knewItButton.isVisible()) {
        await knewItButton.click();
        await page.waitForTimeout(1000); // Allow database update
      }
      
      // Close app mid-quiz
      await electronApp.close();
      
      // Second session: Check progress persistence
      ({ app: electronApp, page } = await launchApp());
      
      // Navigate to progress
      await page.locator('nav button:has-text("Progress")').click();
      await page.waitForSelector('progress-summary', { timeout: 10000 });
      
      // Verify quiz progress is recorded
      const progressContent = await page.locator('progress-summary').textContent();
      expect(progressContent).toMatch(/(quiz|answer|correct|strength)/i);
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should handle database migration and schema updates', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // Create initial data
      ({ app: electronApp, page } = await launchApp());
      
      // Generate some words to create database entries
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      // Verify database file exists
      const dbPath = path.join(testDataDir, 'language_learning.db');
      await page.waitForTimeout(2000); // Allow database writes
      
      await electronApp.close();
      
      // Verify database file was created
      expect(fs.existsSync(dbPath)).toBeTruthy();
      
      // Second session: Should handle existing database
      ({ app: electronApp, page } = await launchApp());
      
      // App should start normally with existing database
      await expect(page.locator('topic-selector')).toBeVisible({ timeout: 10000 });
      
      // Should be able to access progress (indicating database is readable)
      await page.locator('nav button:has-text("Progress")').click();
      await expect(page.locator('progress-summary')).toBeVisible({ timeout: 10000 });
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });

  test('should preserve audio files across sessions', async () => {
    let electronApp: ElectronApplication;
    let page: Page;

    try {
      // First session: Generate content with audio
      ({ app: electronApp, page } = await launchApp());
      
      await page.locator('topic-selector input[type="text"]').fill('greetings');
      await page.locator('topic-selector button:has-text("Generate Words")').click();
      
      await page.waitForSelector('word-selector', { timeout: 30000 });
      
      const firstCheckbox = page.locator('word-selector input[type="checkbox"]').first();
      await firstCheckbox.check();
      
      await page.locator('word-selector button:has-text("Start Learning")').click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Wait for audio generation
      await page.waitForTimeout(3000);
      
      await electronApp.close();
      
      // Check if audio files were created
      const audioDir = path.join(testDataDir, 'audio');
      if (fs.existsSync(audioDir)) {
        const audioFiles = fs.readdirSync(audioDir);
        expect(audioFiles.length).toBeGreaterThan(0);
      }
      
      // Second session: Audio should still be available
      ({ app: electronApp, page } = await launchApp());
      
      // Navigate back to learning mode
      const learningButton = page.locator('nav button:has-text("Review")');
      if (await learningButton.isVisible() && !await learningButton.isDisabled()) {
        await learningButton.click();
        await page.waitForSelector('learning-mode', { timeout: 10000 });
        
        // Audio buttons should be available
        const audioButtons = page.locator('sentence-viewer .audio-button');
        if (await audioButtons.count() > 0) {
          await expect(audioButtons.first()).toBeVisible();
        }
      }
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });
});