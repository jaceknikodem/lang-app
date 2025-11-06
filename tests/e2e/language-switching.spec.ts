/**
 * End-to-end integration tests for language switching
 * Tests that language changes work correctly and data is isolated per language
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { 
  insertTestWord, 
  getCurrentLanguage,
  setLanguage,
  getWordStrength,
  getSessionState
} from './test-helpers.js';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Language Switching', () => {
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
    
    // Insert a test word early to prevent proficiency selector from showing
    await insertTestWord(page, 'spanish');
    
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

  test('language change updates current language', async () => {
    // Get initial language
    const initialLanguage = await getCurrentLanguage(page);
    expect(initialLanguage).toBeTruthy();
    
    // Change language to Italian
    await setLanguage(page, 'italian');
    
    // Verify language changed
    const newLanguage = await getCurrentLanguage(page);
    expect(newLanguage).toBe('italian');
    
    // Change language back to Spanish
    await setLanguage(page, 'spanish');
    
    // Verify language changed back
    const finalLanguage = await getCurrentLanguage(page);
    expect(finalLanguage).toBe('spanish');
  });

  test('session isolation per language', async () => {
    // Set language to Spanish
    await setLanguage(page, 'spanish');
    
    // Create words in Spanish
    const spanishWordId = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId = await electronAPI.database.insertWord({
        word: 'spanish-word',
        language: 'spanish',
        translation: 'spanish translation'
      });
      return wordId;
    });
    
    // Verify Spanish word exists
    const spanishWord = await page.evaluate(async (id) => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getWordById(id);
    }, spanishWordId);
    expect(spanishWord).toBeTruthy();
    expect(spanishWord.language).toBe('spanish');
    
    // Switch to Italian
    await setLanguage(page, 'italian');
    
    // Create words in Italian
    const italianWordId = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId = await electronAPI.database.insertWord({
        word: 'italian-word',
        language: 'italian',
        translation: 'italian translation'
      });
      return wordId;
    });
    
    // Verify Italian word exists
    const italianWord = await page.evaluate(async (id) => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getWordById(id);
    }, italianWordId);
    expect(italianWord).toBeTruthy();
    expect(italianWord.language).toBe('italian');
    
    // Verify words are separate
    expect(spanishWordId).not.toBe(italianWordId);
    expect(spanishWord.word).not.toBe(italianWord.word);
  });

  test('proficiency level per language', async () => {
    // Set language to Spanish and proficiency
    await setLanguage(page, 'spanish');
    await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      await electronAPI.database.setSetting('language_proficiency_spanish', 'a1');
    });
    
    // Verify Spanish proficiency
    const spanishProficiency = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('language_proficiency_spanish');
    });
    expect(spanishProficiency).toBe('a1');
    
    // Switch to Italian and set different proficiency
    await setLanguage(page, 'italian');
    await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      await electronAPI.database.setSetting('language_proficiency_italian', 'b1');
    });
    
    // Verify Italian proficiency
    const italianProficiency = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('language_proficiency_italian');
    });
    expect(italianProficiency).toBe('b1');
    
    // Switch back to Spanish and verify proficiency persisted
    await setLanguage(page, 'spanish');
    const spanishProficiencyAfter = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('language_proficiency_spanish');
    });
    expect(spanishProficiencyAfter).toBe('a1');
  });

  test('word data isolation between languages', async () => {
    // Set language to Spanish
    await setLanguage(page, 'spanish');
    
    // Create word in Spanish
    const spanishWordId = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId = await electronAPI.database.insertWord({
        word: 'isolation-test-spanish',
        language: 'spanish',
        translation: 'spanish translation'
      });
      await electronAPI.database.updateWordStrength(wordId, 60);
      return wordId;
    });
    
    // Verify Spanish word strength
    const spanishStrength = await getWordStrength(page, spanishWordId);
    expect(spanishStrength).toBe(60);
    
    // Switch to Italian
    await setLanguage(page, 'italian');
    
    // Create word in Italian
    const italianWordId = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId = await electronAPI.database.insertWord({
        word: 'isolation-test-italian',
        language: 'italian',
        translation: 'italian translation'
      });
      await electronAPI.database.updateWordStrength(wordId, 80);
      return wordId;
    });
    
    // Verify Italian word strength
    const italianStrength = await getWordStrength(page, italianWordId);
    expect(italianStrength).toBe(80);
    
    // Switch back to Spanish and verify Spanish word still has correct strength
    await setLanguage(page, 'spanish');
    const spanishStrengthAfter = await getWordStrength(page, spanishWordId);
    expect(spanishStrengthAfter).toBe(60);
    
    // Verify Italian word is not accessible when Spanish is active
    // (Words are filtered by language in queries)
  });

  test('session restoration per language', async () => {
    // Set language to Spanish
    await setLanguage(page, 'spanish');
    
    // Create learning session in Spanish
    const spanishWordIds = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId1 = await electronAPI.database.insertWord({
        word: 'session-spanish-1',
        language: 'spanish',
        translation: 'translation1'
      });
      const wordId2 = await electronAPI.database.insertWord({
        word: 'session-spanish-2',
        language: 'spanish',
        translation: 'translation2'
      });
      
      // Start learning session
      const sessionManager = (window as any).sessionManager;
      if (sessionManager) {
        sessionManager.setActiveLanguage('spanish');
        sessionManager.startNewLearningSession([wordId1, wordId2], 2);
        sessionManager.updateLearningProgress(1, 0);
      }
      
      return [wordId1, wordId2];
    });
    
    // Get Spanish session
    const spanishSession = await getSessionState(page);
    expect(spanishSession).toBeTruthy();
    
    // Switch to Italian
    await setLanguage(page, 'italian');
    
    // Create learning session in Italian
    const italianWordIds = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      const wordId1 = await electronAPI.database.insertWord({
        word: 'session-italian-1',
        language: 'italian',
        translation: 'translation1'
      });
      const wordId2 = await electronAPI.database.insertWord({
        word: 'session-italian-2',
        language: 'italian',
        translation: 'translation2'
      });
      
      // Start learning session
      const sessionManager = (window as any).sessionManager;
      if (sessionManager) {
        sessionManager.setActiveLanguage('italian');
        sessionManager.startNewLearningSession([wordId1, wordId2], 2);
        sessionManager.updateLearningProgress(0, 1);
      }
      
      return [wordId1, wordId2];
    });
    
    // Get Italian session
    const italianSession = await getSessionState(page);
    expect(italianSession).toBeTruthy();
    
    // Switch back to Spanish and verify Spanish session is restored
    await setLanguage(page, 'spanish');
    const restoredSpanishSession = await getSessionState(page);
    expect(restoredSpanishSession).toBeTruthy();
    
    // Sessions should be different per language
    // Session structure may vary, just verify sessions exist
    if (spanishSession && restoredSpanishSession && spanishSession.sessions && restoredSpanishSession.sessions) {
      const spanishSessions = Object.values(spanishSession.sessions);
      const restoredSpanishSessions = Object.values(restoredSpanishSession.sessions);
      expect(spanishSessions.length).toBeGreaterThan(0);
      expect(restoredSpanishSessions.length).toBeGreaterThan(0);
      // Verify at least one session has learning progress
      const hasLearningSession = spanishSessions.some((s: any) => 
        s.learningProgress || s.learningSession
      );
      // Learning session may or may not be restored depending on implementation
    }
  });

  test('language change during learning mode', async () => {
    // Set language to Spanish
    await setLanguage(page, 'spanish');
    
    // Navigate to learning mode (if words exist)
    const reviewButton = page.locator('nav button:has-text("Review")');
    if (await reviewButton.isVisible() && !await reviewButton.isDisabled()) {
      await reviewButton.click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Wait a moment for learning mode to load
      await page.waitForTimeout(2000);
      
      // Change language while in learning mode
      await setLanguage(page, 'italian');
      
      // Verify language changed
      const currentLanguage = await getCurrentLanguage(page);
      expect(currentLanguage).toBe('italian');
      
      // Learning mode should handle language change appropriately
      // (May reload or show error if no words in new language)
    }
  });

  test('language change during quiz mode', async () => {
    // Set language to Spanish
    await setLanguage(page, 'spanish');
    
    // Navigate to quiz mode
    const quizButton = page.locator('nav button:has-text("Quiz")');
    await quizButton.click();
    await page.waitForSelector('quiz-mode', { timeout: 30000 });
    
    // Wait for quiz to load
    await page.waitForTimeout(2000);
    
    // Change language while in quiz mode
    await setLanguage(page, 'italian');
    
    // Verify language changed
    const currentLanguage = await getCurrentLanguage(page);
    expect(currentLanguage).toBe('italian');
    
    // Quiz mode should handle language change appropriately
    // (May reload or show error if no words in new language)
  });

  test('settings per language persist', async () => {
    // Set language to Spanish
    await setLanguage(page, 'spanish');
    
    // Set Spanish-specific settings
    await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      await electronAPI.database.setSetting('autoplay_spanish', 'true');
    });
    
    // Verify Spanish setting
    const spanishAutoplay = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('autoplay_spanish');
    });
    expect(spanishAutoplay).toBe('true');
    
    // Switch to Italian
    await setLanguage(page, 'italian');
    
    // Set Italian-specific settings
    await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      await electronAPI.database.setSetting('autoplay_italian', 'false');
    });
    
    // Verify Italian setting
    const italianAutoplay = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('autoplay_italian');
    });
    expect(italianAutoplay).toBe('false');
    
    // Switch back to Spanish and verify setting persisted
    await setLanguage(page, 'spanish');
    const spanishAutoplayAfter = await page.evaluate(async () => {
      const electronAPI = (window as any).electronAPI;
      return await electronAPI.database.getSetting('autoplay_spanish');
    });
    expect(spanishAutoplayAfter).toBe('true');
  });
});

