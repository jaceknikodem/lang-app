# End-to-End Integration Tests

This directory contains comprehensive E2E tests for the Local Language Learning App that cover the complete learning workflow, data persistence, and error recovery scenarios as required by task 8.3.

## Test Files

### 1. `learning-workflow.spec.ts`
Tests the complete user journey from topic selection to quiz completion:
- **Complete Learning Workflow**: Topic selection → word generation → word selection → learning mode → quiz mode → completion
- **Audio Playback Integration**: Tests TTS audio generation and playback during learning
- **Navigation Between Modes**: Verifies smooth transitions between all app modes
- **Empty Topic Handling**: Tests graceful handling when no topic is provided
- **Quiz Direction Selection**: Tests bidirectional quiz functionality (foreign↔English)

### 2. `data-persistence.spec.ts`
Verifies data persistence across application restarts:
- **Word Progress Persistence**: Ensures word strength and knowledge status survive app restarts
- **Active Session Restoration**: Tests session restore functionality for interrupted learning
- **Quiz Progress Persistence**: Verifies quiz results and word strength updates are saved
- **Database Migration Handling**: Tests database schema updates and backward compatibility
- **Audio File Persistence**: Ensures generated TTS files are preserved and reused

### 3. `error-recovery.spec.ts`
Tests graceful degradation and error recovery:
- **LLM Service Unavailable**: Handles Ollama connection failures gracefully
- **Audio Generation Failures**: Continues learning when TTS fails
- **Database Corruption**: Recovers from corrupted database files
- **Network Connectivity Issues**: Handles offline scenarios
- **Malformed LLM Responses**: Validates and handles invalid JSON responses
- **Session Corruption Recovery**: Restores from corrupted session data
- **Rapid User Interactions**: Prevents race conditions from fast clicking

### 4. `test-helpers.ts`
Utility functions for E2E testing:
- **App Launch Helpers**: Standardized Electron app launching with test configuration
- **Test Data Setup**: Functions to generate words and set up learning sessions
- **Session Management**: Helpers for completing learning and quiz workflows
- **Stability Verification**: Functions to check app health and error states
- **Mock Data**: Predefined test data for consistent testing

## Test Configuration

### Playwright Configuration (`playwright.config.ts`)
- **Sequential Execution**: Tests run one at a time to prevent Electron conflicts
- **Extended Timeouts**: 60-second timeout for app initialization
- **Single Worker**: Prevents multiple Electron instances
- **Trace on Retry**: Captures debugging information on test failures

### Test Environment
- **Isolated Data**: Each test uses temporary directories for data isolation
- **Mock Services**: Environment variables to simulate service failures
- **Clean Shutdown**: Proper cleanup of Electron processes and test data

## Requirements Coverage

This test suite addresses all requirements from task 8.3:

### ✅ Complete Learning Workflow Testing
- End-to-end user journey from topic selection to quiz completion
- All major user interactions and state transitions
- Integration between UI components, IPC, and backend services

### ✅ Data Persistence Verification
- Word progress and strength tracking across sessions
- Session state restoration after app restart
- Database integrity and migration handling
- Audio file caching and reuse

### ✅ Error Recovery and Graceful Degradation
- LLM service failures and network issues
- Audio generation and playback errors
- Database corruption and recovery scenarios
- Malformed data handling and validation
- User interaction edge cases

### ✅ Requirements Mapping
- **Requirement 2.1**: Local-first operation and data privacy
- **Requirement 7.4**: Progress persistence between sessions
- **Requirement 7.5**: Data integrity and immediate commits

## Running the Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/learning-workflow.spec.ts

# Run with debugging
npx playwright test --headed --debug

# Generate test report
npx playwright show-report
```

## Test Data Management

Each test creates isolated temporary directories for:
- SQLite database files
- Generated audio files
- Session storage
- Application logs

All test data is automatically cleaned up after test completion.

## Debugging Failed Tests

1. **Check Console Output**: Tests capture console errors and warnings
2. **Review Screenshots**: Playwright captures screenshots on failure
3. **Examine Traces**: Use `--trace on` for detailed execution traces
4. **Verify Services**: Ensure Ollama is running for LLM-dependent tests
5. **Check Permissions**: Verify file system access for database and audio operations

## Continuous Integration

Tests are configured for CI environments with:
- Increased retry attempts (2 retries)
- Single worker execution
- HTML report generation
- Artifact collection for debugging