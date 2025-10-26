# Testing Guide

This project uses comprehensive testing to ensure code quality and prevent regressions.

## Test Types

### Unit Tests
- **Framework**: Jest with TypeScript support
- **Location**: `tests/unit/`
- **Command**: `npm run test:unit`
- **Purpose**: Test individual functions and components in isolation

### End-to-End Tests
- **Framework**: Playwright for Electron
- **Location**: `tests/e2e/`
- **Command**: `npm run test:e2e`
- **Purpose**: Test complete user workflows and integration

## Pre-commit Hooks

The project uses Husky to run automated checks before commits:

### What runs on commit:
1. **Type checking** - Ensures TypeScript compilation
2. **Build check** - Verifies the project builds successfully
3. **Unit tests** - Fast tests for core functionality
4. **E2E tests** - Full integration tests (with retry logic)

### Skipping E2E tests
If E2E tests are failing due to environment issues, you can skip them:
```bash
SKIP_E2E=true git commit -m "your message"
```

**⚠️ Warning**: Always run E2E tests manually before pushing if you skip them.

## Pre-push Hooks

Additional checks run before pushing:
1. **Full build** - Complete project build
2. **All tests** - Both unit and E2E tests
3. **Clean working directory** - Ensures no uncommitted build artifacts

## Quick Commands

```bash
# Run only fast checks (type + unit tests)
npm run test:quick

# Run all tests (unit + E2E)
npm run test:all

# Run tests suitable for CI
npm run test:ci

# Type check only
npm run lint

# Build only
npm run build
```

## CI/CD

The project includes GitHub Actions workflows that run on:
- **Push** to main/develop branches
- **Pull requests** to main/develop branches

The CI runs tests on multiple platforms (Ubuntu, macOS, Windows) and Node.js versions.

## Troubleshooting

### E2E Tests Failing
1. Ensure Ollama is running locally (if tests require LLM)
2. Check if ports are available
3. Run tests with `--headed` flag to see what's happening:
   ```bash
   npx playwright test --headed
   ```

### Pre-commit Hook Issues
1. **Type errors**: Fix TypeScript issues in your code
2. **Build failures**: Check for syntax errors or missing dependencies
3. **Test failures**: Fix failing tests or update them if behavior changed

### Bypassing Hooks (Emergency Only)
```bash
# Skip pre-commit hooks (NOT RECOMMENDED)
git commit --no-verify -m "emergency fix"

# Skip pre-push hooks (NOT RECOMMENDED)
git push --no-verify
```

## Best Practices

1. **Write tests first** - TDD approach when possible
2. **Keep tests fast** - Unit tests should run in seconds
3. **Test real scenarios** - E2E tests should cover actual user workflows
4. **Fix failing tests immediately** - Don't let the test suite degrade
5. **Update tests with code changes** - Keep tests in sync with functionality