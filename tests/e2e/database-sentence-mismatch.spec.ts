/**
 * Test to check for database sentence storage vs retrieval mismatch
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Database Sentence Mismatch Bug', () => {
  test.beforeAll(async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-mismatch-test-'));
    
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

  test('should track sentence generation vs retrieval', async () => {
    console.log('🔍 Tracking sentence generation and retrieval...');
    
    // Track all console messages related to sentences and words
    const sentenceGenerationLogs: string[] = [];
    const sentenceRetrievalLogs: string[] = [];
    const wordProcessingLogs: string[] = [];
    
    page.on('console', msg => {
      const text = msg.text();
      
      if (text.includes('Generated') && text.includes('sentences')) {
        sentenceGenerationLogs.push(text);
        console.log(`📝 GENERATION: ${text}`);
      }
      
      if (text.includes('No sentences found')) {
        sentenceRetrievalLogs.push(text);
        console.log(`❌ RETRIEVAL: ${text}`);
      }
      
      if (text.includes('Processing word') || text.includes('Word inserted')) {
        wordProcessingLogs.push(text);
        console.log(`🔤 WORD: ${text}`);
      }
    });
    
    // Step 1: Generate and process words
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('database test');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    // Select only one word to make tracking easier
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    await wordCheckboxes.first().check();
    
    const learnButton = page.locator('word-selector button:has-text("Learn")');
    await learnButton.click();
    
    // Wait for processing to complete
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    await page.waitForTimeout(5000); // Give time for all processing
    
    // Step 2: Analyze the logs
    console.log('\n📊 ANALYSIS:');
    console.log(`Sentence generation events: ${sentenceGenerationLogs.length}`);
    console.log(`Sentence retrieval failures: ${sentenceRetrievalLogs.length}`);
    console.log(`Word processing events: ${wordProcessingLogs.length}`);
    
    // Extract word names from generation logs
    const generatedWords = sentenceGenerationLogs.map(log => {
      const match = log.match(/Generated \d+ sentences for (.+)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    
    // Extract word names from retrieval failure logs
    const failedWords = sentenceRetrievalLogs.map(log => {
      const match = log.match(/No sentences found for word: (.+)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    
    console.log(`\n🎯 Words with generated sentences: ${generatedWords.join(', ')}`);
    console.log(`❌ Words with retrieval failures: ${failedWords.join(', ')}`);
    
    // Step 3: Check if there's a mismatch
    const hasGeneratedSentences = generatedWords.length > 0;
    const hasRetrievalFailures = failedWords.length > 0;
    
    if (hasGeneratedSentences && hasRetrievalFailures) {
      console.log('\n🐛 BUG DETECTED: Sentences generated but not retrieved');
      
      // Check if the words are different
      const generatedSet = new Set(generatedWords);
      const failedSet = new Set(failedWords);
      
      const onlyGenerated = generatedWords.filter(w => !failedSet.has(w));
      const onlyFailed = failedWords.filter(w => !generatedSet.has(w));
      
      if (onlyGenerated.length > 0) {
        console.log(`✅ Words with successful generation: ${onlyGenerated.join(', ')}`);
      }
      
      if (onlyFailed.length > 0) {
        console.log(`❌ Words with failed retrieval: ${onlyFailed.join(', ')}`);
      }
      
      // This suggests the bug: sentences are generated for some words but retrieval fails for others
      if (onlyFailed.length > 0) {
        console.log('\n🔍 HYPOTHESIS: Sentences are being stored for one word but retrieval is attempted for different words');
        console.log('This could be due to:');
        console.log('1. Word ID mismatch between storage and retrieval');
        console.log('2. Database transaction issues');
        console.log('3. Word selection vs processing mismatch');
      }
    }
    
    // Step 4: Check the actual UI state
    const sentenceViewer = page.locator('sentence-viewer');
    const isVisible = await sentenceViewer.isVisible();
    const content = await sentenceViewer.textContent();
    
    console.log(`\n🖥️ UI STATE:`);
    console.log(`Sentence viewer visible: ${isVisible}`);
    console.log(`Sentence viewer content: "${content?.trim()}"`);
    
    // Step 5: Check if Start Quiz button is immediately available
    const startQuizButton = page.locator('learning-mode button:has-text("Start Quiz")');
    const quizButtonVisible = await startQuizButton.isVisible();
    
    if (quizButtonVisible) {
      console.log('🎯 Start Quiz button is immediately visible - confirms no sentences to review');
    }
    
    // The bug is confirmed if:
    // 1. Sentences were generated (sentenceGenerationLogs.length > 0)
    // 2. But retrieval failed for some/all words (sentenceRetrievalLogs.length > 0)
    // 3. And the UI shows empty content or immediate quiz availability
    
    if (hasGeneratedSentences && (hasRetrievalFailures || quizButtonVisible || !content?.trim())) {
      console.log('\n🐛 BUG CONFIRMED: Sentence generation/retrieval mismatch');
      
      // This test should fail to highlight the bug
      expect(hasRetrievalFailures).toBe(false);
    }
  });

  test('should verify word ID consistency', async () => {
    console.log('🔍 Testing word ID consistency between storage and retrieval...');
    
    // Track word IDs during processing
    const wordIdLogs: string[] = [];
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Word inserted with ID:') || text.includes('wordId')) {
        wordIdLogs.push(text);
        console.log(`🆔 ID: ${text}`);
      }
    });
    
    // Quick word processing
    const startLearningButton = page.locator('nav button:has-text("Start Learning")');
    await startLearningButton.click();
    
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('id test');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();
    
    await page.waitForSelector('word-selector', { timeout: 30000 });
    
    const selectNoneButton = page.locator('word-selector button:has-text("Select None")');
    await selectNoneButton.click();
    
    const wordCheckboxes = page.locator('word-selector input[type="checkbox"]');
    await wordCheckboxes.first().check();
    
    const learnButton = page.locator('word-selector button:has-text("Learn")');
    await learnButton.click();
    
    await page.waitForSelector('learning-mode', { timeout: 30000 });
    await page.waitForTimeout(3000);
    
    console.log('\n🆔 Word ID tracking logs:');
    wordIdLogs.forEach(log => console.log(`   ${log}`));
    
    if (wordIdLogs.length === 0) {
      console.log('⚠️ No word ID logs captured - may indicate logging issue');
    }
  });
});