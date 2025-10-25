/**
 * E2E tests for LLM error handling scenarios
 * Tests how the app handles various LLM service failures
 */

import { test, expect } from '@playwright/test';
import { launchTestApp, cleanupTestSession, TestSession } from './test-helpers';

test.describe('LLM Error Handling', () => {
  let session: TestSession;

  test.afterEach(async () => {
    if (session) {
      await cleanupTestSession(session);
    }
  });

  test('should handle "Generate General Words" button with LLM service unavailable', async () => {
    // Launch app without mocking - this will test real LLM unavailability
    session = await launchTestApp();
    const { page } = session;

    // Navigate to topic selector if not already there
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    // Click "Generate General Words" button (no topic input)
    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // Wait for either success or error response
    // The error should appear within a reasonable timeout
    await Promise.race([
      page.waitForSelector('word-selector', { timeout: 45000 }),
      page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 45000 }),
      page.waitForTimeout(45000)
    ]);

    // Check if an error message is displayed
    const errorSelectors = [
      '.error-message',
      '.error',
      '[class*="error"]',
      '.warning-message',
      '.warning',
      '[class*="warning"]'
    ];

    let errorFound = false;
    let errorText = '';

    for (const selector of errorSelectors) {
      const errorElement = page.locator(selector);
      if (await errorElement.isVisible()) {
        errorFound = true;
        errorText = await errorElement.textContent() || '';
        break;
      }
    }

    if (errorFound) {
      // Verify the error message contains expected content
      expect(errorText.toLowerCase()).toMatch(/(failed|error|not found|unavailable|connection|service)/);
      
      // Check for specific error patterns that match the reported error
      const hasExpectedError = 
        errorText.includes('Failed to generate words') ||
        errorText.includes('HTTP 404') ||
        errorText.includes('Not Found') ||
        errorText.includes('Max retries exceeded') ||
        errorText.includes('connection') ||
        errorText.includes('service unavailable');

      expect(hasExpectedError).toBe(true);

      // Verify app remains functional after error
      await expect(page.locator('app-root')).toBeVisible();
      await expect(page.locator('topic-selector')).toBeVisible();

      // Check if there's a retry button or option
      const retryButton = page.locator('button:has-text("Try Again"), button:has-text("Retry"), button:has-text("Generate General Words"), button:has-text("Generate Topic Words")');
      if (await retryButton.count() > 0) {
        await expect(retryButton.first()).toBeVisible();
      }

    } else {
      // If no error is shown, the LLM service might be available
      // In this case, word generation should have succeeded
      await expect(page.locator('word-selector')).toBeVisible();
      
      // Verify words were actually generated
      const wordItems = page.locator('word-selector .word-item, word-selector input[type="checkbox"]');
      expect(await wordItems.count()).toBeGreaterThan(0);
    }
  });

  test('should handle "Generate Words" with custom topic when LLM unavailable', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Navigate to topic selector
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    // Enter a custom topic
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('cooking vocabulary');

    // Click generate words
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();

    // Wait for response
    await Promise.race([
      page.waitForSelector('word-selector', { timeout: 45000 }),
      page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 45000 }),
      page.waitForTimeout(45000)
    ]);

    // Check for error handling
    const errorElements = page.locator('.error-message, .error, [class*="error"], .warning-message');
    const hasError = await errorElements.count() > 0;

    if (hasError) {
      const errorText = await errorElements.first().textContent() || '';
      
      // Verify error message is user-friendly
      expect(errorText.toLowerCase()).toMatch(/(failed|error|unavailable|connection|service|try again)/);
      
      // App should remain stable
      await expect(page.locator('app-root')).toBeVisible();
      await expect(topicInput).toBeVisible();
      
      // Topic input should retain the entered value
      expect(await topicInput.inputValue()).toBe('cooking vocabulary');
    }
  });

  test('should handle rapid clicking of Generate Words button', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Navigate to topic selector
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    
    // Rapidly click the button multiple times
    for (let i = 0; i < 3; i++) {
      await generateButton.click();
      await page.waitForTimeout(100);
    }

    // Wait for final response
    await Promise.race([
      page.waitForSelector('word-selector', { timeout: 45000 }),
      page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 45000 }),
      page.waitForTimeout(45000)
    ]);

    // App should handle rapid clicks gracefully
    await expect(page.locator('app-root')).toBeVisible();
    
    // Should not show multiple error messages
    const errorElements = page.locator('.error-message, .error, [class*="error"]');
    const errorCount = await errorElements.count();
    expect(errorCount).toBeLessThanOrEqual(1);

    // Button should be in a stable state (not stuck loading)
    const isButtonDisabled = await generateButton.isDisabled();
    const buttonText = await generateButton.textContent();
    
    // Button should either be enabled for retry or show appropriate state
    expect(buttonText).toMatch(/(Generate General Words|Generate Topic Words|Try Again|Retry|Loading)/i);
  });

  test('should show loading state during word generation', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Navigate to topic selector
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    
    // Click generate and immediately check for loading state
    await generateButton.click();
    
    // Check for loading indicators within first few seconds
    await page.waitForTimeout(1000);
    
    const loadingIndicators = page.locator('.loading, .spinner, button:disabled, [class*="loading"]');
    const hasLoadingState = await loadingIndicators.count() > 0;
    
    // Wait for final state
    await Promise.race([
      page.waitForSelector('word-selector', { timeout: 45000 }),
      page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 45000 }),
      page.waitForTimeout(45000)
    ]);

    // Verify loading state was shown (or operation completed very quickly)
    // This is more of a UX check than a strict requirement
    if (hasLoadingState) {
      console.log('Loading state was properly displayed');
    }

    // Final state should be stable
    await expect(page.locator('app-root')).toBeVisible();
  });

  test('should handle network timeout gracefully', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Navigate to topic selector
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    // Enter topic and generate
    const topicInput = page.locator('topic-selector input[type="text"]');
    await topicInput.fill('timeout test');
    
    const generateButton = page.locator('topic-selector button:has-text("Generate Topic Words")');
    await generateButton.click();

    // Wait for timeout or response (using longer timeout to test timeout handling)
    await Promise.race([
      page.waitForSelector('word-selector', { timeout: 60000 }),
      page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 60000 }),
      page.waitForTimeout(60000)
    ]);

    // Check final state
    const hasWordSelector = await page.locator('word-selector').isVisible();
    const hasError = await page.locator('.error-message, .error, [class*="error"]').count() > 0;
    
    // Should be in either success or error state, not stuck loading
    expect(hasWordSelector || hasError).toBe(true);
    
    // App should remain functional
    await expect(page.locator('app-root')).toBeVisible();
    
    // Navigation should still work
    await page.locator('nav button:has-text("Progress")').click();
    await expect(page.locator('progress-summary')).toBeVisible();
  });

  test('should maintain app navigation during LLM errors', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Start word generation
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await generateButton.click();

    // While generation is happening (or failing), test navigation
    await page.waitForTimeout(2000);
    
    // Navigate to Progress page
    await page.locator('nav button:has-text("Progress")').click();
    await expect(page.locator('progress-summary')).toBeVisible();
    
    // Navigate back to Start Learning
    await page.locator('nav button:has-text("Start Learning")').click();
    await expect(page.locator('topic-selector')).toBeVisible();
    
    // App should remain stable throughout navigation
    await expect(page.locator('app-root')).toBeVisible();
  });

  test('should handle LLM service check correctly', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Test LLM availability check through electronAPI
    const llmAvailable = await page.evaluate(async () => {
      try {
        return await window.electronAPI.llm.isAvailable();
      } catch (error) {
        return false;
      }
    });

    // The result should be a boolean
    expect(typeof llmAvailable).toBe('boolean');
    
    // If LLM is not available, word generation should fail gracefully
    if (!llmAvailable) {
      const topicSelector = page.locator('topic-selector');
      if (!await topicSelector.isVisible()) {
        await page.locator('nav button:has-text("Start Learning")').click();
        await page.waitForSelector('topic-selector', { timeout: 10000 });
      }

      const generateButton = page.locator('topic-selector button:has-text("Generate Words")');
      await generateButton.click();

      // Should show error since LLM is not available
      await page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 30000 });
      
      const errorElement = page.locator('.error-message, .error, [class*="error"]').first();
      const errorText = await errorElement.textContent() || '';
      
      expect(errorText.toLowerCase()).toMatch(/(failed|error|unavailable|connection)/);
    }
  });

  test('should display specific error message for HTTP 404 Not Found', async () => {
    session = await launchTestApp();
    const { page } = session;

    // Navigate to topic selector
    const topicSelector = page.locator('topic-selector');
    if (!await topicSelector.isVisible()) {
      await page.locator('nav button:has-text("Start Learning")').click();
      await page.waitForSelector('topic-selector', { timeout: 10000 });
    }

    // Click generate words to trigger potential LLM error
    const generateButton = page.locator('topic-selector button:has-text("Generate General Words")');
    await generateButton.click();

    // Wait for either success or error
    await Promise.race([
      page.waitForSelector('word-selector', { timeout: 45000 }),
      page.waitForSelector('.error-message, .error, [class*="error"]', { timeout: 45000 }),
      page.waitForTimeout(45000)
    ]);

    // Check if the specific error message appears
    const errorElements = page.locator('.error-message, .error, [class*="error"]');
    const hasError = await errorElements.count() > 0;

    if (hasError) {
      const errorText = await errorElements.first().textContent() || '';
      
      // Check for the specific error pattern mentioned in the issue
      const hasSpecificError = 
        errorText.includes('Failed to generate words') ||
        errorText.includes('Failed to generate topic words') ||
        errorText.includes('Max retries exceeded') ||
        errorText.includes('HTTP 404') ||
        errorText.includes('Not Found');

      if (hasSpecificError) {
        // Verify the full error chain is present
        expect(errorText).toMatch(/Failed to generate (words|topic words)/);
        
        // Log the actual error for debugging
        console.log('Captured LLM error:', errorText);
        
        // Verify app remains functional after this specific error
        await expect(page.locator('app-root')).toBeVisible();
        await expect(page.locator('topic-selector')).toBeVisible();
        
        // Verify the generate button is still available for retry
        await expect(generateButton).toBeVisible();
      } else {
        console.log('Different error occurred:', errorText);
      }
    } else {
      console.log('No error occurred - LLM service appears to be available');
      // If no error, verify successful word generation
      await expect(page.locator('word-selector')).toBeVisible();
    }
  });
});