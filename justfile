# Run the bootstrap script to set up dependencies, models, and services
bootstrap:
    ./bootstrap.sh

# Start the application in development mode
dev:
    npm run dev

# Build the main and renderer processes
build:
    npm run build

# Run unit tests
test:
    npm test

# Run all tests (unit and E2E)
test-all:
    npm run test:all


# Build the distribution packages
dist:
    npm run dist

# Clean build artifacts
clean:
    rm -rf dist release

# Deep clean including node_modules
deep-clean: clean
    rm -rf node_modules

# Pre-generate 20 random topics × 5 words and run the full generation pipeline
seed-words:
    npm run build:main && node -r ./src/main/scripts/electron-mock.cjs dist/main/scripts/seed-words.js
