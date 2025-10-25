/**
 * Simple E2E test to validate basic app functionality
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Basic App Functionality', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let testDataDir: string;

  test.beforeAll(async () => {
    // Create temporary directory for test data
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-simple-'));
    
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
    if (electronApp) {
      await electronApp.close();
    }
    
    // Remove test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  test('should launch app and show main interface', async () => {
    // Verify app loads
    await expect(page.locator('app-root')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Local Language Learning');
    
    // Verify navigation is present
    await expect(page.locator('nav')).toBeVisible();
    
    // Verify topic selector is shown by default
    await expect(page.locator('topic-selector')).toBeVisible();
  });

  test('should navigate between different modes', async () => {
    // Navigate to progress
    await page.locator('nav button:has-text("Progress")').click();
    await expect(page.locator('progress-summary')).toBeVisible();
    
    // Navigate back to start learning
    await page.locator('nav button:has-text("Start Learning")').click();
    await expect(page.locator('topic-selector')).toBeVisible();
  });

  test('should handle topic input', async () => {
    // Enter a topic
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('test topic');
    
    // Verify input was accepted
    await expect(topicInput).toHaveValue('test topic');
    
    // Generate words button should be visible
    const generateButton = page.locator('topic-selector button:has-text("Generate Words")');
    await expect(generateButton).toBeVisible();
  });
});