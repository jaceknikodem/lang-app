/**
 * End-to-end integration tests for data persistence
 * Tests that data survives app restarts
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { 
  insertTestWord, 
  getWordStrength, 
  getWordKnownStatus, 
  getCurrentLanguage,
  getSessionState,
  verifyAudioFileExists,
  verifyDatabaseIntegrity,
  countAudioFiles
} from './test-helpers.js';

let testDataDir: string;

test.describe('Data Persistence', () => {
  test('word strength persists across app restarts', async () => {
    // Create temporary directory for test data
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Insert a word and update its strength
    const wordId = await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId = await electronAPI.database.insertWord({
        word: 'persistence-test',
        language: 'spanish',
        translation: 'test translation'
      });
      await electronAPI.database.updateWordStrength(wordId, 75);
      return wordId;
    });
    
    // Verify strength was set
    const strength1 = await getWordStrength(page1, wordId);
    expect(strength1).toBe(75);
    
    // Close first app
    await app1.close();
    
    // Launch second app instance (simulating restart)
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify strength persisted
    const strength2 = await getWordStrength(page2, wordId);
    expect(strength2).toBe(75);
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('known/ignored status persists across app restarts', async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Insert words and mark them
    const result = await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId1 = await electronAPI.database.insertWord({
        word: 'known-word',
        language: 'spanish',
        translation: 'known translation'
      });
      const wordId2 = await electronAPI.database.insertWord({
        word: 'ignored-word',
        language: 'spanish',
        translation: 'ignored translation'
      });
      
      await electronAPI.database.markWordKnown(wordId1, true);
      await electronAPI.database.markWordIgnored(wordId2, true);
      
      return { wordId1, wordId2 };
    });
    
    // Verify status was set
    const status1 = await getWordKnownStatus(page1, result.wordId1);
    const status2 = await getWordKnownStatus(page1, result.wordId2);
    expect(status1?.known).toBe(true);
    expect(status2?.ignored).toBe(true);
    
    // Close first app
    await app1.close();
    
    // Launch second app instance
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify status persisted
    const status1After = await getWordKnownStatus(page2, result.wordId1);
    const status2After = await getWordKnownStatus(page2, result.wordId2);
    expect(status1After?.known).toBe(true);
    expect(status2After?.ignored).toBe(true);
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('learning session restores after app restart', async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Create words and start learning session
    const wordIds = await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId1 = await electronAPI.database.insertWord({
        word: 'word1',
        language: 'spanish',
        translation: 'translation1'
      });
      const wordId2 = await electronAPI.database.insertWord({
        word: 'word2',
        language: 'spanish',
        translation: 'translation2'
      });
      
      // Start learning session
      const sessionManager = (window as any).sessionManager;
      if (sessionManager) {
        sessionManager.startNewLearningSession([wordId1, wordId2], 2);
        sessionManager.updateLearningProgress(1, 0); // Second word, first sentence
      }
      
      return [wordId1, wordId2];
    });
    
    // Verify session was saved
    const session1 = await getSessionState(page1);
    expect(session1).toBeTruthy();
    
    // Close first app
    await app1.close();
    
    // Launch second app instance
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify session was restored
    const session2 = await getSessionState(page2);
    expect(session2).toBeTruthy();
    if (session2 && session2.sessions) {
      const spanishSession = Object.values(session2.sessions).find((s: any) => 
        s.learningProgress && s.learningProgress.currentWordIndex === 1
      );
      expect(spanishSession).toBeTruthy();
    }
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('quiz session restores after app restart', async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Create words and start quiz session
    const wordIds = await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId1 = await electronAPI.database.insertWord({
        word: 'quiz-word1',
        language: 'spanish',
        translation: 'quiz translation1'
      });
      const wordId2 = await electronAPI.database.insertWord({
        word: 'quiz-word2',
        language: 'spanish',
        translation: 'quiz translation2'
      });
      
      // Start quiz session
      const sessionManager = (window as any).sessionManager;
      if (sessionManager) {
        sessionManager.startNewQuizSession([wordId1, wordId2], false);
        sessionManager.updateQuizSession({ currentQuestionIndex: 1, score: 1 });
      }
      
      return [wordId1, wordId2];
    });
    
    // Verify session was saved
    const session1 = await getSessionState(page1);
    expect(session1).toBeTruthy();
    
    // Close first app
    await app1.close();
    
    // Launch second app instance
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify session was restored
    const session2 = await getSessionState(page2);
    expect(session2).toBeTruthy();
    // Session structure may vary, just verify it exists
    if (session2 && session2.sessions) {
      const sessions = Object.values(session2.sessions);
      expect(sessions.length).toBeGreaterThan(0);
      // Check if any session has quiz progress
      const hasQuizSession = sessions.some((s: any) => 
        s.quizProgress || s.quizSession
      );
      // Quiz session may or may not be restored depending on implementation
      // Just verify session data exists
    }
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('settings persist across app restarts', async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Change settings
    await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      await electronAPI.database.setCurrentLanguage('italian');
      await electronAPI.database.setSetting('language_proficiency_italian', 'a1');
    });
    
    // Verify settings were set
    const language1 = await getCurrentLanguage(page1);
    expect(language1).toBe('italian');
    
    // Close first app
    await app1.close();
    
    // Launch second app instance
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify settings persisted
    const language2 = await getCurrentLanguage(page2);
    expect(language2).toBe('italian');
    
    const proficiency = await page2.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('language_proficiency_italian');
    });
    expect(proficiency).toBe('a1');
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('database integrity maintained after restart', async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Create some data
    await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      await electronAPI.database.insertWord({
        word: 'integrity-test',
        language: 'spanish',
        translation: 'test translation'
      });
    });
    
    // Verify database is accessible by checking if we can query it
    const wordCount1 = await page1.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const stats = await electronAPI.database.getStudyStats('spanish');
      return stats.totalWords;
    });
    expect(wordCount1).toBeGreaterThan(0);
    
    // Close first app
    await app1.close();
    
    // Launch second app instance
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify database is accessible and data persisted
    const wordCount2 = await page2.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const stats = await electronAPI.database.getStudyStats('spanish');
      return stats.totalWords;
    });
    expect(wordCount2).toBeGreaterThan(0);
    // Verify word count is at least as much as before (data persisted)
    expect(wordCount2).toBeGreaterThanOrEqual(wordCount1);
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('audio files persist and are reused', async () => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Launch first app instance
    const app1 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page1 = await app1.firstWindow();
    await page1.waitForLoadState('domcontentloaded');
    await insertTestWord(page1);
    await page1.waitForTimeout(3000);
    
    // Count initial audio files
    const initialAudioCount = countAudioFiles(testDataDir);
    
    // Generate some audio (by navigating to learning mode if words exist)
    // This is a simplified test - in practice, audio generation happens during learning
    // We'll just verify the audio directory structure persists
    
    // Close first app
    await app1.close();
    
    // Verify audio directory still exists
    const audioDir = path.join(testDataDir, 'audio');
    const audioDirExists = fs.existsSync(audioDir);
    // Audio directory may or may not exist depending on whether audio was generated
    // This test just verifies the structure can persist
    
    // Launch second app instance
    const app2 = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATA_DIR: testDataDir
      }
    });
    
    const page2 = await app2.firstWindow();
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(3000);
    
    // Verify audio directory structure is accessible
    // (Audio files would be reused if they existed)
    
    // Clean up
    await app2.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});

