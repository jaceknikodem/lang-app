# Local Language Learning App

A privacy-first desktop language learning application that operates entirely offline. The app helps users learn vocabulary through contextual sentences rather than isolated words, focusing on spoken-style comprehension and natural language patterns.

## Features

- **Local-first architecture**: No external dependencies, all data stays on device
- **Contextual learning**: Vocabulary presented in natural sentences with translations
- **Audio-based learning**: System TTS for every sentence to improve listening skills
- **Adaptive difficulty**: Automatic prioritization of weakest vocabulary based on user performance
- **Click-only interaction**: No typing required, all interactions via buttons and clicks
- **Persistent progress**: SQLite-based storage maintains learning state across sessions

## Technology Stack

- **Runtime**: Electron (Node.js desktop app framework)
- **Language**: TypeScript for type safety and better developer experience
- **Frontend**: Lit web components for reactive UI without heavy framework overhead
- **Database**: SQLite for local data persistence
- **LLM Integration**: Ollama HTTP client for local language model access
- **Audio**: macOS system TTS (`say` command) for speech generation

## Project Structure

```
├── src/
│   ├── main/                 # Electron main process
│   │   ├── database/         # SQLite operations and schema
│   │   ├── llm/             # Ollama client and prompt templates
│   │   ├── audio/           # TTS generation and audio management
│   │   ├── ipc/             # IPC bridge and API surface
│   │   └── main.ts          # Main process entry point
│   ├── renderer/            # Electron renderer process (UI)
│   │   ├── components/      # Lit web components
│   │   ├── styles/          # CSS and styling
│   │   ├── utils/           # Frontend utilities
│   │   └── index.html       # Main HTML entry
│   ├── shared/              # Shared types and interfaces
│   │   ├── types/           # TypeScript interfaces
│   │   └── constants/       # Shared constants
│   └── preload/             # Electron preload scripts
├── audio/                   # Generated TTS audio files
├── data/                    # SQLite database files
├── tests/                   # Test files
│   ├── unit/               # Unit tests
│   └── e2e/                # End-to-end tests
└── build/                   # Build configuration and assets
```

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

## Prerequisites

- **Node.js**: Version 18+ for Electron compatibility
- **macOS**: Required for system TTS integration (`say` command)
- **Homebrew**: Package manager for installing dependencies

### Required Dependencies

Install the following dependencies using Homebrew:

```bash
# Install Ollama for local LLM inference
brew install ollama

# Install whisper-cpp for speech recognition
brew install whisper-cpp
```

### Model Downloads

After installing the dependencies, download the required models:

```bash
# Download and run a language model (e.g., Llama 3.2)
ollama pull llama3.2

# Download Whisper model for speech recognition
# Create models directory and download from Hugging Face
mkdir -p models
cd models

# Download the small model (39MB) - good balance of speed and accuracy
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

cd ..
```

### Service Setup

Ensure Ollama is running before starting the application:

```bash
# Start Ollama service (runs on port 11434 by default)
ollama serve
```

You can verify Ollama is running by visiting `http://localhost:11434` in your browser.

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Ensure Ollama is running locally
4. Start development: `npm run dev`

## Architecture

The application follows a secure Electron architecture with:

- **Main Process**: Handles all system interactions (database, LLM, TTS)
- **Renderer Process**: Sandboxed UI layer with Lit components
- **IPC Bridge**: Secure communication between main and renderer processes
- **Local-first**: No external network dependencies except local Ollama instance

## Security

- Renderer process runs in sandbox mode
- All cross-process data validated with Zod schemas
- No external network access except localhost Ollama
- Audio files limited to designated directory
- All user data remains on local device