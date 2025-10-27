# Local Language Learning App

A privacy-first desktop language learning application that operates entirely offline. The app helps users learn vocabulary through contextual sentences rather than isolated words, focusing on spoken-style comprehension and natural language patterns.

**Core Philosophy**: Learn vocabulary in context, not isolation. Every word is presented within natural sentences with full audio support, creating an immersive learning experience that stays completely on your device.

## Target Users

Language learners who prioritize privacy, prefer audio-based learning, and want focused vocabulary building through contextual understanding rather than rote memorization. Perfect for learners who want to:

- Study completely offline without accounts or data sharing
- Focus on listening comprehension and natural speech patterns
- Learn vocabulary through meaningful context rather than flashcards
- Have an adaptive system that focuses on their weakest areas

## Core Learning Flow

1. **Optional Topic Selection**: Choose specific topics for targeted vocabulary building
2. **LLM-Generated Content**: AI creates word lists with contextual sentences in your target language
3. **Interactive Review**: Listen to sentences, mark word familiarity, and build understanding
4. **Adaptive Quizzing**: System prioritizes your weakest vocabulary for focused practice
5. **Bidirectional Testing**: Quiz modes work both ways (foreign→English and English→foreign)

## Key Features

- **Privacy-First**: Complete offline operation, no accounts, no data collection
- **Contextual Learning**: Every word presented in natural, meaningful sentences
- **Audio-Centric**: System TTS for pronunciation and listening comprehension
- **Adaptive Intelligence**: Automatic difficulty adjustment based on your performance
- **Zero Typing**: Pure click-based interaction for distraction-free learning
- **Persistent Progress**: SQLite database maintains all learning state locally

## Technology Stack

### Core Technologies
- **Runtime**: Electron (Node.js desktop app framework)
- **Language**: TypeScript for type safety and better developer experience
- **Frontend**: Lit web components for reactive UI without heavy framework overhead
- **Database**: SQLite for local data persistence
- **LLM Integration**: Ollama HTTP client for local language model access
- **Audio**: macOS system TTS (`say` command) for speech generation

### Key Dependencies
- **Database**: `sqlite3` or `better-sqlite3` for SQLite operations
- **Validation**: `zod` for runtime type checking of LLM responses
- **Build**: `electron-builder` for cross-platform packaging
- **Testing**: `playwright` for E2E testing of Electron app

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

## Prerequisites

- **Node.js**: Version 18+ for Electron compatibility
- **macOS**: Required for system TTS integration (`say` command)
- **Homebrew**: Package manager for installing dependencies
- **Ollama**: Local language model for inference
- **Whisper**: Speech recognition model for audio input
- ElevenLabs API keys: optional for generating high-quality TTS audio (Free account gives you 600-700 audio sentences)

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

## Architecture

### Process Architecture
- **Main Process**: Handles all system interactions (database, LLM, TTS)
- **Renderer Process**: Sandboxed UI layer with Lit components  
- **IPC Bridge**: Secure communication between main and renderer processes
- **Local-first**: No external network dependencies except local Ollama instance

### Component Architecture

#### Main Process Components
- **DatabaseLayer**: SQLite CRUD operations, schema management
- **LLMClient**: Ollama HTTP client, prompt generation
- **AudioGenerator**: TTS integration, file caching
- **IPCBridge**: Secure API exposure to renderer

#### Renderer Components
- **app-root**: Main application shell and routing
- **learning-mode**: Sentence review and word interaction
- **quiz-mode**: Assessment interface with bidirectional quizzing
- **topic-selector**: Optional topic input for vocabulary generation
- **progress-summary**: Study statistics and progress tracking

### Data Flow Patterns
1. **UI → IPC → Main Process**: All user actions flow through secure IPC
2. **Database-first**: All state changes immediately persisted to SQLite
3. **Component isolation**: Each Lit component manages its own reactive state
4. **Error boundaries**: Each major component handles its own error states

### Security Boundaries
- **Renderer sandbox**: No direct filesystem or system access
- **IPC validation**: All cross-process data validated with Zod schemas
- **Local-only**: No external network access except localhost Ollama
- **File restrictions**: Audio files limited to designated directory
