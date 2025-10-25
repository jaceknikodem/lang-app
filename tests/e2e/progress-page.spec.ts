/**
 * E2E tests for progress page functionality
 */

import { test, expect } from '@playwright/test';
import { launchTestApp, cleanupTestSession, setupWordsForTesting, completeLearningSession, completeQuizSession, TestSession } from './test-helpers';

test.describe('Progress Page', () => {
  let session: TestSession;

  test.beforeEach(async () => {
    session = await launchTestApp();
  });

  test.afterEach(async () => {
    await cleanupTestSession(session);
  });

  test('should load progress page without errors', async () => {
    const { page } = session;

    // Navigate to progress page by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    
    // Wait for progress page to load
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Check that the page loaded without showing error message
    const errorMessage = page.locator('.error-message');
    const isErrorVisible = await errorMessage.isVisible();
    
    if (isErrorVisible) {
      const errorText = await errorMessage.textContent();
      console.log('Error message found:', errorText);
    }
    
    expect(isErrorVisible).toBe(false);
  });

  test('should show empty state when no data exists', async () => {
    const { page } = session;

    // Navigate to progress page by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Should show empty state or zero stats
    const emptyState = page.locator('.empty-state');
    const statsCards = page.locator('.stat-card');
    
    const hasEmptyState = await emptyState.isVisible();
    const hasStatsCards = await statsCards.count() > 0;
    
    // Either should show empty state or stats with zero values
    expect(hasEmptyState || hasStatsCards).toBe(true);
    
    if (hasStatsCards) {
      // Check that stats show zero or appropriate initial values
      const totalWordsCard = page.locator('.stat-card').first();
      const totalWordsText = await totalWordsCard.textContent();
      expect(totalWordsText).toContain('0');
    }
  });

  test('should display progress data after learning session', async () => {
    const { page } = session;

    // First, complete a learning session to generate data
    await setupWordsForTesting(page, 'test-progress', 2);
    await completeLearningSession(page);
    await completeQuizSession(page, 1);
    
    // Navigate to progress page by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Check that progress data is displayed
    const statsCards = page.locator('.stat-card');
    expect(await statsCards.count()).toBeGreaterThan(0);
    
    // Check for specific stats
    const totalWordsCard = statsCards.first();
    const totalWordsText = await totalWordsCard.textContent();
    expect(totalWordsText).toMatch(/\d+/); // Should contain numbers
    
    // Check for recent words section if any words were studied
    const recentWordsSection = page.locator('h3:has-text("Recent Words")');
    const sessionSection = page.locator('h3:has-text("Recent Sessions")');
    
    // At least one of these sections should be visible
    const hasRecentWords = await recentWordsSection.isVisible();
    const hasSessions = await sessionSection.isVisible();
    expect(hasRecentWords || hasSessions).toBe(true);
  });

  test('should handle navigation from progress page', async () => {
    const { page } = session;

    // Navigate to progress page by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Test navigation to other pages
    await page.locator('nav button:has-text("Start Learning")').click();
    await page.waitForSelector('topic-selector', { timeout: 5000 });
    
    // Navigate back to progress by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Should load without errors
    const errorMessage = page.locator('.error-message');
    expect(await errorMessage.isVisible()).toBe(false);
  });

  test('should show action buttons on progress page', async () => {
    const { page } = session;

    // Navigate to progress page by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    await page.waitForSelector('progress-summary', { timeout: 10000 });
    
    // Check for action buttons
    const actionButtons = page.locator('.action-buttons button, .btn');
    const buttonCount = await actionButtons.count();
    expect(buttonCount).toBeGreaterThan(0);
    
    // Should have at least a "Start Learning" or "New Learning Session" button
    const startLearningButton = page.locator('button:has-text("Start Learning"), button:has-text("New Learning Session")');
    expect(await startLearningButton.count()).toBeGreaterThan(0);
  });

  test('should check electronAPI availability', async () => {
    const { page } = session;

    // Check if electronAPI is available in the renderer process
    const electronAPIAvailable = await page.evaluate(() => {
      return typeof window.electronAPI !== 'undefined';
    });
    
    expect(electronAPIAvailable).toBe(true);
    
    // Check if database methods are available
    const databaseAPIAvailable = await page.evaluate(() => {
      return typeof window.electronAPI?.database !== 'undefined';
    });
    
    expect(databaseAPIAvailable).toBe(true);
    
    // Check specific methods
    const methodsAvailable = await page.evaluate(() => {
      const db = window.electronAPI?.database;
      return {
        getStudyStats: typeof db?.getStudyStats === 'function',
        getAllWords: typeof db?.getAllWords === 'function',
        getRecentStudySessions: typeof db?.getRecentStudySessions === 'function'
      };
    });
    
    expect(methodsAvailable.getStudyStats).toBe(true);
    expect(methodsAvailable.getAllWords).toBe(true);
    expect(methodsAvailable.getRecentStudySessions).toBe(true);
  });

  test('should handle database errors gracefully', async () => {
    const { page } = session;

    // Navigate to progress page by clicking the Progress button
    await page.locator('button:has-text("Progress")').click();
    
    // Wait for either success or error state
    await Promise.race([
      page.waitForSelector('progress-summary .stats-grid', { timeout: 10000 }),
      page.waitForSelector('progress-summary .error-message', { timeout: 10000 }),
      page.waitForSelector('progress-summary .empty-state', { timeout: 10000 })
    ]);
    
    // Check that the page is in a valid state (not stuck loading)
    const isLoading = await page.locator('.loading').isVisible();
    expect(isLoading).toBe(false);
    
    // Should show either content, error, or empty state
    const hasContent = await page.locator('.stats-grid').isVisible();
    const hasError = await page.locator('.error-message').isVisible();
    const hasEmptyState = await page.locator('.empty-state').isVisible();
    
    expect(hasContent || hasError || hasEmptyState).toBe(true);
  });

  test('should test database methods directly', async () => {
    const { page } = session;

    // Test database methods directly through electronAPI
    const testResults = await page.evaluate(async () => {
      try {
        // Test getStudyStats
        const stats = await window.electronAPI.database.getStudyStats();
        
        // Test getAllWords
        const words = await window.electronAPI.database.getAllWords(true, false);
        
        // Test getRecentStudySessions
        const sessions = await window.electronAPI.database.getRecentStudySessions(5);
        
        return {
          success: true,
          stats: stats,
          wordsCount: words.length,
          sessionsCount: sessions.length
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
    
    expect(testResults.success).toBe(true);
    expect(testResults.stats).toBeDefined();
    expect(typeof testResults.wordsCount).toBe('number');
    expect(typeof testResults.sessionsCount).toBe('number');
  });
});