/**
 * End-to-end integration tests for complete learning workflow
 * Tests the full user journey from topic selection to quiz completion
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Complete Learning Workflow', () => {
  test.beforeAll(async () => {
    // Create temporary directory for test data
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Set environment variables for test
    process.env.NODE_ENV = 'test';
    process.env.TEST_DATA_DIR = testDataDir;
    
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
    await page.waitForTimeout(2000); // Allow services to initialize
  });

  test.afterAll(async () => {
    // Clean up
    await electronApp.close();
    
    // Remove test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('should complete full learning workflow from topic to quiz', async () => {
    // Step 1: Verify app loads with topic selection
    await expect(page.locator('topic-selector')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Local Language Learning');
    
    // Step 2: Enter topic and generate words
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('food and cooking');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    // Wait for word generation (may take time with LLM)
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // Step 3: Select words for study
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    const wordCount = await wordCheckboxes.count();
    expect(wordCount).toBeGreaterThan(0);
    
    // Select first 3 words
    for (let i = 0; i < Math.min(3, wordCount); i++) {
      await wordCheckboxes.nth(i).check();
    }
    
    const startLearningButton = page.locator('word-selector button:has-text("Start Learning")');
    await startLearningButton.click();
    
    // Step 4: Learning mode - review sentences
    await page.waitForSelector('learning-mode', { timeout: 10000 });
    
    // Verify sentences are displayed
    const sentenceDisplay = page.locator('sentence-viewer');
    await expect(sentenceDisplay).toBeVisible();
    
    // Interact with words in sentences
    const wordButtons = page.locator('sentence-viewer .word-button');
    if (await wordButtons.count() > 0) {
      // Mark first word as known
      await wordButtons.first().click();
      const knownButton = page.locator('button:has-text("Mark as Known")');
      if (await knownButton.isVisible()) {
        await knownButton.click();
      }
    }
    
    // Navigate through sentences
    const nextButton = page.locator('learning-mode button:has-text("Next")');
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(1000);
    }
    
    // Step 5: Start quiz mode
    const startQuizButton = page.locator('learning-mode button:has-text("Start Quiz")');
    await startQuizButton.click();
    
    await page.waitForSelector('quiz-mode', { timeout: 10000 });
    
    // Step 6: Complete quiz questions
    const quizQuestion = page.locator('quiz-mode .quiz-question');
    await expect(quizQuestion).toBeVisible();
    
    // Answer quiz questions
    for (let i = 0; i < 3; i++) {
      const knewItButton = page.locator('quiz-mode button:has-text("I knew it")');
      const notYetButton = page.locator('quiz-mode button:has-text("Not yet")');
      
      if (await knewItButton.isVisible()) {
        // Alternate between correct and incorrect answers
        if (i % 2 === 0) {
          await knewItButton.click();
        } else {
          await notYetButton.click();
        }
        
        await page.waitForTimeout(1000);
        
        // Check if quiz is complete
        const sessionComplete = page.locator('session-complete');
        if (await sessionComplete.isVisible()) {
          break;
        }
      } else {
        break; // No more questions
      }
    }
    
    // Step 7: Verify quiz completion
    const sessionComplete = page.locator('session-complete');
    await expect(sessionComplete).toBeVisible({ timeout: 5000 });
    
    // Verify progress summary is shown
    const progressSummary = page.locator('progress-summary');
    await expect(progressSummary).toBeVisible();
  });

  test('should handle audio playback during learning', async () => {
    // Navigate to learning mode (assuming we have words from previous test)
    const learningButton = page.locator('nav button:has-text("Review")');
    if (await learningButton.isVisible() && !await learningButton.isDisabled()) {
      await learningButton.click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Test audio playback
      const audioButtons = page.locator('sentence-viewer .audio-button');
      if (await audioButtons.count() > 0) {
        await audioButtons.first().click();
        
        // Verify audio button shows playing state
        await expect(audioButtons.first()).toHaveClass(/playing|active/);
        
        // Wait for audio to finish
        await page.waitForTimeout(3000);
      }
    }
  });

  test('should navigate between different app modes', async () => {
    // Test navigation between modes
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    await expect(page.locator('topic-selector')).toBeVisible();
    
    // Navigate to progress
    const progressButton = page.locator('nav button:has-text("Progress")');
    await progressButton.click();
    await expect(page.locator('progress-summary')).toBeVisible();
    
    // Verify progress data is displayed
    const progressStats = page.locator('progress-summary .progress-stats');
    await expect(progressStats).toBeVisible();
  });

  test('should handle empty topic generation gracefully', async () => {
    // Navigate to topic selection
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    // Try generating words without topic
    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await generateButton.click();
    
    // Should still generate words (high-frequency words)
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    const wordCount = await wordCheckboxes.count();
    expect(wordCount).toBeGreaterThan(0);
  });

  test('should handle quiz direction selection', async () => {
    // Assuming we have words selected, navigate to quiz
    const quizButton = page.locator('nav button:has-text("Quiz")');
    if (await quizButton.isVisible() && !await quizButton.isDisabled()) {
      await quizButton.click();
      
      // Check for quiz direction selection
      const directionSelector = page.locator('quiz-mode .direction-selector');
      if (await directionSelector.isVisible()) {
        const englishToForeignButton = page.locator('button:has-text("English to Foreign")');
        if (await englishToForeignButton.isVisible()) {
          await englishToForeignButton.click();
        }
      }
      
      // Verify quiz starts with selected direction
      const quizQuestion = page.locator('quiz-mode .quiz-question');
      await expect(quizQuestion).toBeVisible();
    }
  });
});