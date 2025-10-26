/**
 * Focused test to replicate the sentence display bug
 * where sentences are generated but not displayed in the sentence viewer
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Sentence Display Bug', () => {
  test.beforeAll(async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-bug-test-'));
    
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

  test('should display sentences after word selection and processing', async () => {
    console.log('🔍 Testing sentence display after word processing...');
    
    // Step 1: Generate words
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('test sentences');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    console.log('✓ Words generated');
    
    // Step 2: Select one word
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    await wordCheckboxes.first().check();
    console.log('✓ Selected one word');
    
    // Step 3: Start learning and monitor the process
    const startLearningButton = page.locator('word-selector button:has-text("Learn")');
    
    // Listen for console logs to track sentence generation
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`${msg.type()}: ${text}`);
      if (text.includes('sentence') || text.includes('Generated') || text.includes('Processing')) {
        console.log(`📝 Console: ${text}`);
      }
    });
    
    await startLearningButton.click();
    console.log('✓ Clicked Learn button');
    
    // Step 4: Wait for learning mode to appear
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    console.log('✓ Learning mode appeared');
    
    // Step 5: Check sentence viewer state
    const sentenceViewer = page.locator('sentence-viewer');
    await expect(sentenceViewer).toBeVisible();
    console.log('✓ Sentence viewer is visible');
    
    // Wait a bit more for sentences to load
    await page.waitForTimeout(3000);
    
    // Step 6: Check for actual sentence content
    const sentences = page.locator('sentence-viewer .sentence, sentence-viewer .sentence-text, sentence-viewer p, sentence-viewer div');
    const sentenceCount = await sentences.count();
    console.log(`📊 Found ${sentenceCount} sentence elements`);
    
    // Check for any text content in the sentence viewer
    const sentenceViewerText = await sentenceViewer.textContent();
    console.log(`📄 Sentence viewer content: "${sentenceViewerText?.trim()}"`);
    
    // Check for specific sentence display elements
    const foreignSentence = page.locator('sentence-viewer .foreign-sentence, sentence-viewer .sentence-foreign');
    const englishSentence = page.locator('sentence-viewer .english-sentence, sentence-viewer .sentence-english');
    const translationSentence = page.locator('sentence-viewer .translation, sentence-viewer .sentence-translation');
    
    const hasForeignSentence = await foreignSentence.isVisible();
    const hasEnglishSentence = await englishSentence.isVisible();
    const hasTranslationSentence = await translationSentence.isVisible();
    
    console.log(`🌍 Foreign sentence visible: ${hasForeignSentence}`);
    console.log(`🇺🇸 English sentence visible: ${hasEnglishSentence}`);
    console.log(`📖 Translation visible: ${hasTranslationSentence}`);
    
    // Step 7: Check navigation buttons
    const nextButton = page.locator('learning-mode button:has-text("Next")');
    const startQuizButton = page.locator('learning-mode button:has-text("Start Quiz")');
    
    const hasNextButton = await nextButton.isVisible();
    const hasStartQuizButton = await startQuizButton.isVisible();
    
    console.log(`⏭️ Next button visible: ${hasNextButton}`);
    console.log(`🎯 Start Quiz button visible: ${hasStartQuizButton}`);
    
    // Step 8: Check if we can interact with words in sentences
    const wordButtons = page.locator('sentence-viewer .word-button, sentence-viewer button');
    const wordButtonCount = await wordButtons.count();
    console.log(`🔤 Found ${wordButtonCount} word buttons`);
    
    // Step 9: Analyze the bug
    if (sentenceCount === 0 && (!sentenceViewerText || sentenceViewerText.trim().length === 0)) {
      console.log('🐛 BUG CONFIRMED: Sentences were generated but are not displayed');
      console.log('📋 Console logs during processing:');
      consoleLogs.forEach(log => {
        if (log.includes('sentence') || log.includes('Generated') || log.includes('Processing')) {
          console.log(`   ${log}`);
        }
      });
      
      // Take screenshot for debugging
      await page.screenshot({ path: `test-results/sentence-display-bug-${Date.now()}.png` });
      
      // This is the bug - sentences should be visible
      expect(sentenceCount).toBeGreaterThan(0);
    } else {
      console.log('✅ Sentences are properly displayed');
    }
    
    // Step 10: Try to navigate and see what happens
    if (hasNextButton) {
      console.log('🔄 Testing Next button...');
      await nextButton.click();
      await page.waitForTimeout(1000);
      
      const newSentenceViewerText = await sentenceViewer.textContent();
      console.log(`📄 After Next click: "${newSentenceViewerText?.trim()}"`);
    }
    
    if (hasStartQuizButton) {
      console.log('🎯 Start Quiz button is available - this suggests no sentences to review');
      console.log('🐛 This confirms the bug: session appears complete due to no displayable sentences');
    }
  });

  test('should check database state vs UI state', async () => {
    console.log('🔍 Checking database vs UI consistency...');
    
    // This test would ideally check the database directly to see if sentences exist
    // but aren't being displayed. For now, we'll use UI indicators.
    
    // Navigate to a fresh session
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    // Quick word selection
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('database test');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    await wordCheckboxes.first().check();
    
    const learnButton = page.locator('word-selector button:has-text("Learn")');
    await learnButton.click();
    
    // Wait for processing
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    await page.waitForTimeout(5000);
    
    // Check if we immediately see "Start Quiz" which would indicate no sentences to review
    const startQuizButton = page.locator('learning-mode button:has-text("Start Quiz")');
    const isQuizButtonVisible = await startQuizButton.isVisible();
    
    if (isQuizButtonVisible) {
      console.log('🐛 BUG INDICATOR: Start Quiz button is immediately visible');
      console.log('   This suggests the session thinks there are no sentences to review');
      console.log('   But sentences should have been generated during word processing');
    }
    
    // Check sentence viewer state
    const sentenceViewer = page.locator('sentence-viewer');
    const sentenceViewerText = await sentenceViewer.textContent();
    
    console.log(`📄 Sentence viewer state: "${sentenceViewerText?.trim()}"`);
    
    if (!sentenceViewerText || sentenceViewerText.trim().length === 0) {
      console.log('🐛 CONFIRMED: Sentence viewer is empty despite word processing');
    }
  });
});