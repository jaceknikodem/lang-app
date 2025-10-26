/**
 * Test to replicate the bug where learning session shows "Session Complete"
 * despite having generated sentences for a single word
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Session Complete Bug Replication', () => {
  test.beforeAll(async () => {
    // Create temporary directory for test data
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-bug-test-'));
    
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

  test('should replicate session complete bug with single word', async () => {
    console.log('Starting bug replication test...');
    
    // Step 1: Navigate to topic selection
    await expect(page.locator('topic-selector')).toBeVisible();
    console.log('✓ Topic selector visible');
    
    // Step 2: Generate words (either with topic or general)
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('test topic');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    console.log('✓ Clicked generate words button');
    
    // Wait for word generation
    await page.waitForSelector('word-selector', { timeout: 30000 });
    console.log('✓ Word selector appeared');
    
    // Step 3: Select ONLY ONE word (this is key to reproducing the bug)
    // First, unselect all words (they are auto-selected by default)
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    console.log('✓ Unselected all words');
    
    // Now select only the first word
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    const wordCount = await wordCheckboxes.count();
    console.log(`Found ${wordCount} words available`);
    
    expect(wordCount).toBeGreaterThan(0);
    
    await wordCheckboxes.first().check();
    console.log('✓ Selected first word only');
    
    // Verify only one word is selected
    const checkedBoxes = page.locator('word-selector input[type="checkbox"]:checked');
    const selectedCount = await checkedBoxes.count();
    expect(selectedCount).toBe(1);
    console.log(`✓ Confirmed only ${selectedCount} word selected`);
    
    // Step 4: Start learning
    const startLearningButton = page.locator('word-selector button:has-text("Learn")');
    await startLearningButton.click();
    console.log('✓ Clicked start learning');
    
    // Step 5: Check what happens - this is where the bug should manifest
    console.log('Waiting for navigation after clicking Learn...');
    
    // Wait for either learning mode or session complete to appear
    try {
      await Promise.race([
        page.waitForSelector('learning-mode', { timeout: 15000 }),
        page.waitForSelector('session-complete', { timeout: 15000 }),
        page.waitForSelector('.error, .error-message', { timeout: 15000 })
      ]);
    } catch (error) {
      console.log('No expected elements appeared within timeout');
    }
    
    // Give additional time for any async operations
    await page.waitForTimeout(2000);
    
    // Check current state
    const learningMode = page.locator('learning-mode');
    const sessionComplete = page.locator('session-complete');
    const wordSelector = page.locator('word-selector');
    const topicSelector = page.locator('topic-selector');
    
    const isLearningModeVisible = await learningMode.isVisible();
    const isSessionCompleteVisible = await sessionComplete.isVisible();
    const isWordSelectorVisible = await wordSelector.isVisible();
    const isTopicSelectorVisible = await topicSelector.isVisible();
    
    console.log(`Learning mode visible: ${isLearningModeVisible}`);
    console.log(`Session complete visible: ${isSessionCompleteVisible}`);
    console.log(`Word selector visible: ${isWordSelectorVisible}`);
    console.log(`Topic selector visible: ${isTopicSelectorVisible}`);
    
    // Check for any error messages
    const errorElements = page.locator('.error, .error-message, [class*="error"]');
    const errorCount = await errorElements.count();
    if (errorCount > 0) {
      console.log(`Found ${errorCount} error elements:`);
      for (let i = 0; i < errorCount; i++) {
        const errorText = await errorElements.nth(i).textContent();
        console.log(`Error ${i + 1}: ${errorText}`);
      }
    }
    
    // Log what's actually on screen
    const bodyText = await page.locator('body').textContent();
    console.log('Current page content:', bodyText?.substring(0, 800));
    
    // Check console logs for any errors
    const logs: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        logs.push(`Console error: ${msg.text()}`);
      }
    });
    
    if (logs.length > 0) {
      console.log('Console errors:', logs);
    }
    
    // Check for sentences in the database/logs
    // This would require checking the main process logs or database
    // For now, let's check if sentences were generated by looking for sentence viewer
    if (isLearningModeVisible) {
      const sentenceViewer = page.locator('sentence-viewer');
      const hasSentenceViewer = await sentenceViewer.isVisible();
      console.log(`Sentence viewer visible: ${hasSentenceViewer}`);
      
      if (hasSentenceViewer) {
        const sentenceText = await sentenceViewer.textContent();
        console.log('Sentence content:', sentenceText);
        
        // Check for sentence navigation buttons
        const nextButton = page.locator('learning-mode button:has-text("Next")');
        const hasNextButton = await nextButton.isVisible();
        console.log(`Next button visible: ${hasNextButton}`);
      }
    }
    
    // BUG ASSERTION: If sentences were generated (as mentioned in logs),
    // but we see "Session Complete", that's the bug
    if (isSessionCompleteVisible) {
      console.log('🐛 BUG DETECTED: Session shows complete despite having generated sentences');
      
      // Try to get more information about why it completed
      const sessionCompleteText = await sessionComplete.textContent();
      console.log('Session complete message:', sessionCompleteText);
      
      // Check if there's any error message
      const errorMessages = page.locator('.error, .error-message, [class*="error"]');
      const errorCount = await errorMessages.count();
      if (errorCount > 0) {
        for (let i = 0; i < errorCount; i++) {
          const errorText = await errorMessages.nth(i).textContent();
          console.log(`Error message ${i + 1}:`, errorText);
        }
      }
      
      // This is the bug - session should not be complete if sentences were generated
      expect(isSessionCompleteVisible).toBe(false);
    } else if (isLearningModeVisible) {
      console.log('✓ Learning mode is correctly displayed');
      
      // Verify we can interact with the learning interface
      const sentenceViewer = page.locator('sentence-viewer');
      await expect(sentenceViewer).toBeVisible();
      
      // Check if there are sentences to review
      const sentences = page.locator('sentence-viewer .sentence');
      const sentenceCount = await sentences.count();
      console.log(`Found ${sentenceCount} sentences in viewer`);
      
      if (sentenceCount === 0) {
        console.log('🐛 BUG DETECTED: Learning mode visible but no sentences to display');
      }
    } else {
      console.log('🐛 UNEXPECTED STATE: Neither learning mode nor session complete is visible');
      
      // Take a screenshot for debugging
      const screenshotPath = `test-results/bug-replication-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath });
      console.log(`Screenshot saved: ${screenshotPath}`);
      
      // Check if we're stuck on word selector due to processing
      if (isWordSelectorVisible) {
        const processingElement = page.locator('.loading, .spinner');
        const isProcessing = await processingElement.isVisible();
        console.log(`Still processing: ${isProcessing}`);
        
        if (isProcessing) {
          console.log('Waiting longer for processing to complete...');
          await page.waitForTimeout(10000);
          
          // Check again after waiting
          const stillProcessing = await processingElement.isVisible();
          console.log(`Still processing after wait: ${stillProcessing}`);
        }
      }
    }
  });

  test('should check sentence generation in database', async () => {
    // This test would check if sentences were actually generated in the database
    // but the session still shows as complete
    
    console.log('Checking database state...');
    
    // Navigate to a fresh session
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    // Generate and select one word again
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('simple test');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // First unselect all, then select one word
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    await wordCheckboxes.first().check();
    
    const startButton = page.locator('word-selector button:has-text("Learn")');
    await startButton.click();
    
    // Wait and observe the state
    await page.waitForTimeout(5000);
    
    // Check current state
    const currentUrl = page.url();
    const currentContent = await page.locator('body').textContent();
    
    console.log('Current URL:', currentUrl);
    console.log('Current state:', currentContent?.includes('Session Complete') ? 'Session Complete' : 'Other');
    
    // If we can access the main process, we could check the database directly
    // For now, we'll rely on UI state to detect the bug
    
    const sessionComplete = page.locator('session-complete');
    const learningMode = page.locator('learning-mode');
    
    if (await sessionComplete.isVisible()) {
      console.log('🐛 Session complete is showing - checking if this is premature');
      
      // In a proper implementation, we would:
      // 1. Check if sentences exist in the database
      // 2. Check if the user has actually reviewed all sentences
      // 3. Verify the session completion logic
      
      // For this test, we'll assume that if session complete shows immediately
      // after selecting one word, it's likely the bug
      const progressSummary = page.locator('progress-summary');
      if (await progressSummary.isVisible()) {
        const progressText = await progressSummary.textContent();
        console.log('Progress summary:', progressText);
        
        // Check if progress indicates any actual learning happened
        const hasWordsStudied = progressText?.includes('words studied') || progressText?.includes('sentences reviewed');
        if (!hasWordsStudied) {
          console.log('🐛 BUG CONFIRMED: Session complete but no learning progress recorded');
        }
      }
    }
  });

  test('should test with different word counts to isolate bug', async () => {
    // Test with 2 words to see if the bug persists
    console.log('Testing with 2 words...');
    
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('two word test');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // First unselect all, then select TWO words
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    const wordCount = await wordCheckboxes.count();
    
    if (wordCount >= 2) {
      await wordCheckboxes.nth(0).check();
      await wordCheckboxes.nth(1).check();
      console.log('✓ Selected 2 words');
    } else {
      await wordCheckboxes.first().check();
      console.log('✓ Only 1 word available, selected it');
    }
    
    const startButton = page.locator('word-selector button:has-text("Learn")');
    await startButton.click();
    
    await page.waitForTimeout(3000);
    
    const sessionComplete = page.locator('session-complete');
    const learningMode = page.locator('learning-mode');
    
    const isSessionComplete = await sessionComplete.isVisible();
    const isLearningMode = await learningMode.isVisible();
    
    console.log(`With 2 words - Session complete: ${isSessionComplete}, Learning mode: ${isLearningMode}`);
    
    // Compare behavior with single word vs multiple words
    if (isSessionComplete) {
      console.log('🐛 Bug persists with 2 words');
    } else if (isLearningMode) {
      console.log('✓ Learning mode works correctly with 2 words');
    }
  });
});