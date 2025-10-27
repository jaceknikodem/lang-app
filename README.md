# Local Language Learning App

A vocabulary coach that teaches *words in context*, *incorporating the words you already know*, incl. listening/speaking practice, *fully offline* (on your device, no accounts).

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

The application follows a Electron architecture with:

- **Main Process**: Handles all system interactions (database, LLM, TTS)
- **Renderer Process**: Sandboxed UI layer with Lit components
- **IPC Bridge**: Secure communication between main and renderer processes
- **Local-first**: No external network dependencies except local Ollama instance
