# Local Language Learning App

A privacy-first desktop language learning application that operates entirely offline. Learn vocabulary through contextual sentences with full audio support, spaced repetition, and conversational practice.

## Features

- **Contextual Learning**: Every word presented in natural sentences with audio
- **Spaced Repetition**: FSRS and Classic algorithms for adaptive learning
- **Speech Practice**: Practice pronunciation with Whisper models for speech recognition
- **Micro Dialogues**: Interactive conversational practice with variant generation and follow-ups
- **Multiple LLM Providers**: Local Ollama or Google Gemini API
- **TTS Options**: System TTS, ElevenLabs, or custom audio
- **Lemmatization**: Automatic word form recognition via Stanza service
- **Privacy-First**: Complete offline operation, no accounts, no data collection
- **Adaptive Intelligence**: Automatically focuses on your weakest vocabulary
- **Bidirectional Quizzing**: Test both directions (foreign→English and English→foreign)

## Tech Stack

- **Runtime**: Electron (TypeScript)
- **Frontend**: Lit web components
- **Database**: SQLite (better-sqlite3)
- **LLM**: Ollama (local) or Google Gemini API (cloud)
- **Audio**: macOS TTS, ElevenLabs API, or Whisper.cpp
- **Lemmatization**: Stanza (Python/FastAPI)
- **SRS**: FSRS and Classic algorithms

## Dependencies

### Node.js Dependencies
- `better-sqlite3` - SQLite database
- `lit` - Web components framework
- `zod` - Runtime type validation
- `whisper-node` - Speech recognition
- `node-record-lpcm16` - Audio recording

### System Dependencies
```bash
# Install Ollama for local LLM inference
brew install ollama

# Install Whisper.cpp for speech recognition
brew install whisper-cpp
```

### Python Dependencies (Lemmatization)
Requires Python 3.10 and `uv` package manager:
```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Setup lemmatization service
cd src/main/lemmatization
uv python install 3.10
uv sync
```

### Models

**Ollama Models** (for local inference):
```bash
# Fast word generation
ollama pull granite4:tiny-h

# Quality sentence generation
ollama pull llama3.2:3b
```

**Whisper Model** (for speech recognition):
```bash
mkdir -p models
cd models
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

**Stanza Models** (loaded automatically when needed):
- Spanish, Italian, Portuguese, Polish, Indonesian

### Services

**Ollama** (default LLM):
```bash
ollama serve
# Runs on http://localhost:11434
```

**Whisper Server** (speech practice/recognition):
```bash
whisper-server --model models/ggml-small.bin --threads 8 --port 8080
```

**Stanza Service** (lemmatization):
```bash
cd src/main/lemmatization
uv run python stanza-service.py
# Runs on http://127.0.0.1:8888
```

## Setup

1. Install Node.js 18+
2. Install dependencies: `npm install`
3. Install system dependencies (Ollama, Whisper)
4. Download required models
5. Start services (Ollama, Whisper, Stanza)
6. Run the app: `npm run dev`

## Development

```bash
# Development mode
npm run dev

# Build
npm run build

# Run tests
npm run test:all

# Package for distribution
npm run dist
```

## Project Structure

```
src/
├── main/          # Electron main process
│   ├── database/  # SQLite operations
│   ├── llm/       # Ollama/Gemini clients
│   ├── audio/     # TTS and audio management
│   ├── dialog/    # Conversational practice
│   ├── srs/       # Spaced repetition algorithms
│   └── lemmatization/  # Stanza service integration
├── renderer/      # UI components (Lit)
└── shared/        # Shared types and utilities
```

## License

MIT
