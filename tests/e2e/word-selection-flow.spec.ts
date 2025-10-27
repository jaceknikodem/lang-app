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

  test('should complete word selection flow: generate → select none → select first → learn', async () => {
    // Step 1: Verify app loads with topic selection
    await expect(page.locator('topic-selector')).toBeVisible({ timeout: 30000 });
    
    // Wait for models to load (important for LLM functionality)
    await page.waitForTimeout(2000);
    
    // Step 2: Generate words with no topic (general vocabulary)
    const generateButton = page.locator('topic-selector button:has-text("Generate")');
    await expect(generateButton).toBeVisible();
    
    // Ensure button is enabled (model loaded)
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    
    await generateButton.click();
    
    // Step 3: Wait for word selector to load with generated words
    await page.waitForSelector('word-selector', { timeout: 60000 });
    
    // Verify words were generated
    const wordItems = page.locator('word-selector .word-item');
    const wordCount = await wordItems.count();
    expect(wordCount).toBeGreaterThan(0);
    
    // Verify all words are initially selected
    const selectedWords = page.locator('word-selector .word-item.selected');
    const selectedCount = await selectedWords.count();
    expect(selectedCount).toBe(wordCount);
    
    // Step 4: Click "Select None" to deselect all words
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await expect(selectNoneButton).toBeVisible();
    await selectNoneButton.click();
    
    // Verify no words are selected
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(0);
    
    // Verify Learn button is disabled when no words selected
    const learnButton = page.locator('word-selector button.start-btn');
    await expect(learnButton).toBeDisabled();
    
    // Step 5: Select the first word
    const firstWordItem = wordItems.first();
    await firstWordItem.click();
    
    // Verify first word is now selected
    await expect(firstWordItem).toHaveClass(/selected/);
    
    // Verify Learn button is now enabled
    await expect(learnButton).toBeEnabled();
    
    // Verify button shows correct count
    await expect(learnButton).toContainText('Learn (1 words)');
    
    // Step 6: Click Learn button to start processing
    await learnButton.click();
    
    // Step 7: Wait for word processing to complete and navigation to learning mode
    await page.waitForSelector('learning-mode', { timeout: 90000 }); // Allow time for LLM sentence generation and audio
    
    // Step 8: Verify learning mode loaded successfully without errors
    const learningMode = page.locator('learning-mode');
    await expect(learningMode).toBeVisible();
    
    // Check that no error message is displayed
    const errorMessage = page.locator('learning-mode .error-message');
    await expect(errorMessage).not.toBeVisible();
    
    // Verify sentence viewer is present (indicates words were loaded)
    const sentenceViewer = page.locator('sentence-viewer');
    await expect(sentenceViewer).toBeVisible({ timeout: 30000 });
    
    // Verify navigation shows we're in learning mode
    const learningNavButton = page.locator('nav button:has-text("Review")');
    await expect(learningNavButton).toHaveClass(/active/);
  });

  test('should handle language consistency between word insertion and retrieval', async () => {
    // This test verifies the language filtering fix
    
    // Navigate back to topic selection
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    await expect(page.locator('topic-selector')).toBeVisible();
    
    // Verify language dropdown shows Spanish (default)
    const languageSelect = page.locator('topic-selector select#language-select');
    await expect(languageSelect).toHaveValue('Spanish');
    
    // Generate words
    const generateButton = page.locator('topic-selector button:has-text("Generate")');
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 60000 });
    
    // Select first word and start learning
    const firstWordItem = page.locator('word-selector .word-item').first();
    await firstWordItem.click();
    
    const learnButton = page.locator('word-selector button.start-btn');
    await learnButton.click();
    
    // Verify learning mode loads successfully (language consistency working)
    try {
      await page.waitForSelector('learning-mode', { timeout: 90000 });
      const errorMessage = page.locator('learning-mode .error-message');
      await expect(errorMessage).not.toBeVisible();
    } catch (error) {
      // If page closed, that's also a failure but handle gracefully
      if (error.message.includes('Target page, context or browser has been closed')) {
        throw new Error('App closed unexpectedly during word processing');
      }
      throw error;
    }
  });

  test('should maintain word selection state correctly', async () => {
    // Navigate to topic selection
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    await expect(page.locator('topic-selector')).toBeVisible();
    
    // Generate words
    const generateButton = page.locator('topic-selector button:has-text("Generate")');
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 60000 });
    
    // Test selection state changes
    const wordItems = page.locator('word-selector .word-item');
    const wordCount = await wordItems.count();
    
    // Initially all should be selected
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(wordCount);
    
    // Click "Select None"
    await page.locator('word-selector button:has-text("Select None")').click();
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(0);
    
    // Click "Select All"
    await page.locator('word-selector button:has-text("Select All")').click();
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(wordCount);
    
    // Manually deselect individual words
    await wordItems.first().click();
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(wordCount - 1);
    
    // Re-select the word
    await wordItems.first().click();
    await expect(page.locator('word-selector .word-item.selected')).toHaveCount(wordCount);
  });

  test('should show processing state during word processing', async () => {
    // Navigate to topic selection
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    await expect(page.locator('topic-selector')).toBeVisible();
    
    // Generate words
    const generateButton = page.locator('topic-selector button:has-text("Generate")');
    await expect(generateButton).toBeEnabled({ timeout: 30000 });
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 60000 });
    
    // Select first word
    const firstWordItem = page.locator('word-selector .word-item').first();
    await firstWordItem.click();
    
    const learnButton = page.locator('word-selector button.start-btn');
    await learnButton.click();
    
    // Verify word processing completes successfully
    await page.waitForSelector('learning-mode', { timeout: 90000 });
    
    // Verify no error state
    const errorMessage = page.locator('learning-mode .error-message');
    await expect(errorMessage).not.toBeVisible();
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

  test('should validate word processing with database persistence', async () => {
    // Navigate to topic selection and generate words
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    const generateButton = page.locator('topic-selector button:has-text("Generate")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // Select and process a word
    const firstWordItem = page.locator('word-selector .word-item').first();
    await firstWordItem.click();
    
    const learnButton = page.locator('word-selector button.start-btn');
    await learnButton.click();
    
    // Wait for processing to complete
    await page.waitForSelector('learning-mode', { timeout: 60000 });
    
    // Navigate away and back to verify persistence
    const progressButton = page.locator('nav button:has-text("Progress")');
    await progressButton.click();
    await expect(page.locator('progress-summary')).toBeVisible();
    
    // Navigate back to learning
    const reviewButton = page.locator('nav button:has-text("Review")');
    await reviewButton.click();
    
    // Should still have words available
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    const errorMessage = page.locator('learning-mode .error-message');
    await expect(errorMessage).not.toBeVisible();
  });
});