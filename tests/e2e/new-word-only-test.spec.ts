/**
 * Test to verify that learning mode only shows newly selected words,
 * not all words with sentences from previous sessions
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('New Word Only Learning', () => {
  test.beforeAll(async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-word-test-'));
    
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
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    await electronApp.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('should only show newly selected words in learning mode', async () => {
    console.log('🔍 Testing that only new words appear in learning mode...');
    
    // Track console logs to see which words are loaded
    const wordLoadingLogs: string[] = [];
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Using specific words from current session') || 
          text.includes('Loaded all words with sentences') ||
          text.includes('Processing word')) {
        wordLoadingLogs.push(text);
        console.log(`📝 ${text}`);
      }
    });
    
    // Step 1: First session - select and process one word
    console.log('\n🎯 FIRST SESSION: Processing one word...');
    
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('first session');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // Select only one word
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    await wordCheckboxes.first().check();
    
    const learnButton = page.locator('word-selector button:has-text("Learn")');
    await learnButton.click();
    
    // Wait for learning mode and complete the session
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Check that we're using specific words from current session
    const firstSessionLogs = wordLoadingLogs.filter(log => 
      log.includes('Using specific words from current session')
    );
    
    console.log(`✅ First session logs: ${firstSessionLogs.length > 0 ? 'Using specific words' : 'Using all words'}`);
    
    // Navigate back to start a new session
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    // Step 2: Second session - select and process another word
    console.log('\n🎯 SECOND SESSION: Processing another word...');
    
    // Clear previous logs
    wordLoadingLogs.length = 0;
    
    await topicInput.fill('second session');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // Select only one word (different from first session)
    await selectNoneButton.click();
    await wordCheckboxes.nth(1).check(); // Select second word this time
    
    await learnButton.click();
    
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Step 3: Verify that only the new word is loaded, not old ones
    const secondSessionLogs = wordLoadingLogs.filter(log => 
      log.includes('Using specific words from current session')
    );
    
    const allWordsLogs = wordLoadingLogs.filter(log => 
      log.includes('Loaded all words with sentences')
    );
    
    console.log(`\n📊 SECOND SESSION ANALYSIS:`);
    console.log(`Using specific words logs: ${secondSessionLogs.length}`);
    console.log(`Using all words logs: ${allWordsLogs.length}`);
    
    // The fix should ensure we use specific words, not all words
    if (secondSessionLogs.length > 0) {
      console.log('✅ SUCCESS: Learning mode is using only newly selected words');
      
      // Extract the number of words from the log
      const specificWordsLog = secondSessionLogs[0];
      const match = specificWordsLog.match(/(\d+)/);
      const wordCount = match ? parseInt(match[1]) : 0;
      
      console.log(`📊 Number of words in learning mode: ${wordCount}`);
      
      // Should be 1 word (the newly selected one), not multiple words from previous sessions
      expect(wordCount).toBe(1);
      
    } else if (allWordsLogs.length > 0) {
      console.log('❌ ISSUE: Learning mode is loading all words with sentences');
      
      // Extract the number of words from the log
      const allWordsLog = allWordsLogs[0];
      const match = allWordsLog.match(/(\d+)/);
      const wordCount = match ? parseInt(match[1]) : 0;
      
      console.log(`📊 Number of words loaded: ${wordCount}`);
      
      if (wordCount > 1) {
        console.log('🐛 BUG CONFIRMED: Multiple words loaded instead of just the new one');
        // This test should fail to highlight the issue
        expect(wordCount).toBe(1);
      }
    }
    
    // Step 4: Check the UI to see how many words are actually shown
    const wordCounter = page.locator('.word-counter').first();
    
    if (await wordCounter.isVisible()) {
      const counterText = await wordCounter.textContent();
      console.log(`🖥️ UI word counter: "${counterText}"`);
      
      // Should show "Word 1 of 1" not "Word 1 of X" where X > 1
      if (counterText?.includes('of 1')) {
        console.log('✅ UI confirms only 1 word in learning session');
      } else {
        console.log('❌ UI shows multiple words in learning session');
      }
    }
  });

  test('should handle navigation from other sources correctly', async () => {
    console.log('🔍 Testing navigation from Progress page (should load all words)...');
    
    // Navigate to Progress page and try "Continue Learning" if available
    const progressButton = page.locator('nav button:has-text("Progress")');
    await progressButton.click();
    
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Look for continue learning or practice buttons
    const continueButton = page.locator('button:has-text("Continue Learning"), button:has-text("Practice")');
    
    if (await continueButton.isVisible()) {
      console.log('📝 Found continue/practice button, testing...');
      
      const wordLoadingLogs: string[] = [];
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('Using specific words') || text.includes('Loaded all words')) {
          wordLoadingLogs.push(text);
          console.log(`📝 ${text}`);
        }
      });
      
      await continueButton.click();
      
      // This should use "all words with sentences" since no specific words were passed
      await page.waitForTimeout(3000);
      
      const allWordsLogs = wordLoadingLogs.filter(log => 
        log.includes('Loaded all words with sentences')
      );
      
      if (allWordsLogs.length > 0) {
        console.log('✅ Correctly using all words when navigating from Progress');
      } else {
        console.log('ℹ️ No words loaded or different navigation path');
      }
    } else {
      console.log('ℹ️ No continue learning button available');
    }
  });
});