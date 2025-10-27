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
- **Dual Model Support**: Choose separate small/big models for optimal performance (word generation vs sentence generation)

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
- **Ollama**: Local language model for inference (default)
- **Whisper**: Speech recognition model for audio input
- **ElevenLabs API Key** (optional): For high-quality TTS audio (free account provides 600-700 audio sentences)
- **Google Gemini API Key** (optional): For cloud-based LLM as alternative to local Ollama

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

### LLM Provider Options

The app supports two LLM providers:

#### 1. Ollama (Local, Default)
- **Pros**: Complete privacy, no internet required, no API costs
- **Cons**: Requires local setup and model downloads
- **Setup**: Install Ollama and download models locally

```bash
# For word generation (fast, lightweight)
ollama pull granite4:tiny-h

# For sentence generation (better quality)
ollama pull llama3.2:3b
```

#### 2. Google Gemini (Cloud)
- **Pros**: No local setup, high-quality generation, fast responses
- **Cons**: Requires internet connection, API costs, data sent to Google
- **Setup**: Get API key from [Google AI Studio](https://aistudio.google.com/api-keys)

**Available Models:**
- **gemini-2.0-flash-exp**: Latest experimental model, fastest response times
- **gemini-1.5-pro**: High quality, best for complex sentence generation
- **gemini-1.5-flash**: Fast, good balance of speed and quality
- **gemini-1.5-flash-8b**: Fastest and most cost-effective option
- **gemini-1.0-pro**: Legacy model, stable and reliable

**Recommended Setup:**
- **Word Generation**: `gemini-1.5-flash-8b` (fastest, most cost-effective)
- **Sentence Generation**: `gemini-1.5-pro` (highest quality for complex sentences)

Configure your preferred provider in the app's Settings panel under "Language Model (LLM)" section.

### Switching Between Providers

1. **Open Settings**: Click the settings icon in the app
2. **Navigate to LLM Section**: Find "Language Model (LLM)" section
3. **Select Provider**: Choose between "Ollama (Local)" or "Google Gemini (Cloud)"
4. **Configure API Key** (Gemini only): Enter your Gemini API key when switching to cloud provider
5. **Select Models**: Choose appropriate models for word and sentence generation

The app will automatically switch providers and reload available models. You can switch back and forth at any time without losing your learning progress.

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
