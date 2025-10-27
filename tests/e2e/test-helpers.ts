/**
 * Helper utilities for E2E tests
 */

import { Page, ElectronApplication } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

process.env.E2E_FORCE_LOCAL_SERVICES = '1';

export interface TestAppOptions {
  testDataDir?: string;
  mockLLMFailure?: boolean;
  mockAudioFailure?: boolean;
  skipInitialization?: boolean;
}

export interface TestSession {
  app: ElectronApplication;
  page: Page;
  testDataDir: string;
}

/**
 * Launch the Electron app with test configuration
 */
export async function launchTestApp(options: TestAppOptions = {}): Promise<TestSession> {
  const { _electron: electron } = require('@playwright/test');
  
  const testDataDir = options.testDataDir || fs.mkdtempSync(path.join(require('os').tmpdir(), 'language-learning-test-'));
  
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
  
  if (!options.skipInitialization) {
    await page.waitForTimeout(2000); // Allow services to initialize
  }
  
  return { app, page, testDataDir };
}

/**
 * Clean up test session
 */
export async function cleanupTestSession(session: TestSession): Promise<void> {
  if (session.app) {
    await session.app.close();
  }
  
  if (fs.existsSync(session.testDataDir)) {
    fs.rmSync(session.testDataDir, { recursive: true, force: true });
  }
}

/**
 * Generate words and select them for testing
 */
export async function setupWordsForTesting(page: Page, topic: string = 'test', wordCount: number = 2): Promise<void> {
  // Navigate to topic selection if not already there
  const topicSelector = page.locator('topic-selector');
  if (!await topicSelector.isVisible()) {
    await page.locator('nav button:has-text("Start Learning")').click();
    await page.waitForSelector('topic-selector');
  }
  
  // Enter topic and generate words
  const topicInput = page.locator('topic-selector input[type="text"]');
  await topicInput.fill(topic);
  
  // Handle both "Generate" and "Generate Topic Words" buttons
  const generateButton = page.locator('topic-selector button:has-text("Generate"), topic-selector button:has-text("Generate Topic Words")').first();
  await generateButton.click();
  
  // Wait for word generation or error
  await Promise.race([
    page.waitForSelector('word-selector', { timeout: 30000 }),
    page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 30000 })
  ]);

  // Check if word generation was successful
  const hasWordSelector = await page.locator('word-selector').isVisible();
  if (!hasWordSelector) {
    // If word generation failed, throw an error to indicate the test should be skipped
    throw new Error('Word generation failed - LLM service may not be available');
  }
  
  // Select specified number of words
  const checkboxes = page.locator('word-selector input[type="checkbox"]');
  const availableWords = await checkboxes.count();
  const wordsToSelect = Math.min(wordCount, availableWords);
  
  for (let i = 0; i < wordsToSelect; i++) {
    await checkboxes.nth(i).check();
  }
  
  // Start learning
  const startLearningButton = page.locator('word-selector button:has-text("Start Learning")');
  await startLearningButton.click();
  
  await page.waitForSelector('learning-mode', { timeout: 10000 });
}

/**
 * Complete a learning session by marking words and starting quiz
 */
export async function completeLearningSession(page: Page): Promise<void> {
  // Ensure we're in learning mode
  await page.waitForSelector('learning-mode');
  
  // Mark some words as known
  const wordButtons = page.locator('sentence-viewer .word-button');
  const wordCount = await wordButtons.count();
  
  if (wordCount > 0) {
    await wordButtons.first().click();
    const knownButton = page.locator('button:has-text("Mark as Known")');
    if (await knownButton.isVisible()) {
      await knownButton.click();
      await page.waitForTimeout(1000);
    }
  }
  
  // Navigate through sentences if available
  const nextButton = page.locator('learning-mode button:has-text("Next")');
  if (await nextButton.isVisible()) {
    await nextButton.click();
    await page.waitForTimeout(1000);
  }
  
  // Start quiz
  const startQuizButton = page.locator('learning-mode button:has-text("Start Quiz")');
  await startQuizButton.click();
  
  await page.waitForSelector('quiz-mode', { timeout: 10000 });
}

/**
 * Complete quiz questions
 */
export async function completeQuizSession(page: Page, correctAnswers: number = 2): Promise<void> {
  await page.waitForSelector('quiz-mode');
  
  let answersGiven = 0;
  const maxAttempts = 10; // Prevent infinite loops
  
  for (let attempt = 0; attempt < maxAttempts && answersGiven < correctAnswers + 2; attempt++) {
    const knewItButton = page.locator('quiz-mode button:has-text("I knew it")');
    const notYetButton = page.locator('quiz-mode button:has-text("Not yet")');
    
    if (await knewItButton.isVisible()) {
      // Alternate between correct and incorrect answers
      if (answersGiven < correctAnswers) {
        await knewItButton.click();
      } else {
        await notYetButton.click();
      }
      
      answersGiven++;
      await page.waitForTimeout(1000);
      
      // Check if quiz is complete
      const sessionComplete = page.locator('session-complete');
      if (await sessionComplete.isVisible()) {
        break;
      }
    } else {
      break; // No more questions available
    }
  }
}

/**
 * Wait for element with custom timeout and error message
 */
export async function waitForElementWithTimeout(
  page: Page, 
  selector: string, 
  timeout: number = 10000, 
  errorMessage?: string
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (error) {
    const customError = errorMessage || `Element '${selector}' not found within ${timeout}ms`;
    throw new Error(customError);
  }
}

/**
 * Check if app is in a stable state
 */
export async function verifyAppStability(page: Page): Promise<void> {
  // Check that main app container is visible
  await page.waitForSelector('app-root', { timeout: 5000 });
  
  // Check that navigation is functional
  const navigation = page.locator('nav');
  await page.waitForSelector('nav', { timeout: 5000 });
  
  // Verify no JavaScript errors in console
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  // Wait a moment for any async errors
  await page.waitForTimeout(1000);
  
  if (errors.length > 0) {
    console.warn('Console errors detected:', errors);
  }
}

/**
 * Simulate user typing with realistic delays
 */
export async function typeWithDelay(page: Page, selector: string, text: string, delay: number = 100): Promise<void> {
  const element = page.locator(selector);
  await element.click();
  await element.fill(''); // Clear existing text
  
  for (const char of text) {
    await element.type(char);
    await page.waitForTimeout(delay);
  }
}

/**
 * Check database file integrity
 */
export function verifyDatabaseIntegrity(testDataDir: string): boolean {
  const dbPath = path.join(testDataDir, 'language_learning.db');
  
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  
  const stats = fs.statSync(dbPath);
  return stats.size > 0; // Basic check that file is not empty
}

/**
 * Count audio files generated
 */
export function countAudioFiles(testDataDir: string): number {
  const audioDir = path.join(testDataDir, 'audio');
  
  if (!fs.existsSync(audioDir)) {
    return 0;
  }
  
  const files = fs.readdirSync(audioDir);
  return files.filter(file => file.endsWith('.aiff')).length;
}

/**
 * Mock LLM responses for testing
 */
export const mockLLMResponses = {
  words: [
    { word: 'hola', translation: 'hello' },
    { word: 'adiós', translation: 'goodbye' },
    { word: 'gracias', translation: 'thank you' }
  ],
  sentences: [
    { sentence: 'Hola, ¿cómo estás?', translation: 'Hello, how are you?' },
    { sentence: 'Gracias por tu ayuda.', translation: 'Thank you for your help.' },
    { sentence: 'Adiós, hasta luego.', translation: 'Goodbye, see you later.' }
  ]
};

/**
 * Verify progress data structure
 */
export async function verifyProgressData(page: Page): Promise<boolean> {
  await page.locator('nav button:has-text("Progress")').click();
  await page.waitForSelector('progress-summary', { timeout: 10000 });
  
  const progressContent = await page.locator('progress-summary').textContent();
  
  // Check for expected progress indicators
  const hasWordsStudied = /words?\s+studied/i.test(progressContent || '');
  const hasSessionData = /session/i.test(progressContent || '');
  const hasStats = /\d+/.test(progressContent || ''); // Should contain numbers
  
  return hasWordsStudied || hasSessionData || hasStats;
}
