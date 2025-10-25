# Technology Stack

## Core Technologies

- **Runtime**: Electron (Node.js desktop app framework)
- **Language**: TypeScript for type safety and better developer experience
- **Frontend**: Lit web components for reactive UI without heavy framework overhead
- **Database**: SQLite for local data persistence
- **LLM Integration**: Ollama HTTP client for local language model access
- **Audio**: macOS system TTS (`say` command) for speech generation

## Architecture Pattern

- **Main Process**: Handles all system interactions (database, LLM, TTS)
- **Renderer Process**: Sandboxed UI layer with Lit components
- **IPC Bridge**: Secure communication between main and renderer processes
- **Local-first**: No external network dependencies except local Ollama instance

## Key Dependencies

- **Database**: `sqlite3` or `better-sqlite3` for SQLite operations
- **Validation**: `zod` for runtime type checking of LLM responses
- **Build**: `electron-builder` for cross-platform packaging
- **Testing**: `playwright` for E2E testing of Electron app

## Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Package for distribution
npm run dist

# Run tests
npm test

# Run E2E tests
npm run test:e2e
```

## Local Setup Requirements

- **Ollama**: Must be installed and running locally on port 11434
- **macOS**: Required for system TTS integration (`say` command)
- **Node.js**: Version 18+ for Electron compatibility

## Build Configuration

- **Target**: Desktop application (macOS primary, cross-platform secondary)
- **Security**: Renderer process runs in sandbox mode
- **Distribution**: Code signing and notarization for macOS App Store compliance