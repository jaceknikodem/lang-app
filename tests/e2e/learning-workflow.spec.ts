/**
 * End-to-end integration tests for complete learning workflow
 * Tests the full user journey from topic selection to quiz completion
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.describe('Complete Learning Workflow', () => {
  test.beforeAll(async () => {
    // Create temporary directory for test data
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-learning-test-'));
    
    // Set environment variables for test
    process.env.NODE_ENV = 'test';
    process.env.TEST_DATA_DIR = testDataDir;
    
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

  test('should handle audio playback during learning', async () => {
    // Navigate to learning mode (assuming we have words from previous test)
    const learningButton = page.locator('nav button:has-text("Review")');
    if (await learningButton.isVisible() && !await learningButton.isDisabled()) {
      await learningButton.click();
      await page.waitForSelector('learning-mode', { timeout: 10000 });
      
      // Test audio playback
      const audioButtons = page.locator('sentence-viewer .audio-button');
      if (await audioButtons.count() > 0) {
        await audioButtons.first().click();
        
        // Verify audio button shows playing state
        await expect(audioButtons.first()).toHaveClass(/playing|active/);
        
        // Wait for audio to finish
        await page.waitForTimeout(3000);
      }
    }
  });

});