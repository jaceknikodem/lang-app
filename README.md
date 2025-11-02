# Local Language Learning App

A privacy-first desktop language learning application that operates entirely offline. Learn vocabulary through contextual sentences with full audio support, spaced repetition, and conversational practice.

## Features

- **Immersive Context**: Every word appears in natural sentences with audio
- **Smarter Spacing**: SRS-powered review adapts precisely to memory strength, keeping recall sharp with less grind
- **Pronunciation Feedback**: Instant, character-level feedback shows exactly where you're off (all privately on your device)
- **Micro-Dialogues**: Choose your reply, speak it aloud, and hear the natural response — real conversation built from what you already know
- **Flow Mode**: Hands-free listening sessions (10–60 min) that train your ear and rhythm without screens or clicks
- **Autopilot Learning**: The app glides between modes — review, quiz, dialogue, flow — so you can just focus on language
- **Multiple LLM Providers**: Use Gemini or local LLMs — your choice of engine and privacy
- **Privacy-First Design**: No accounts. No tracking. Your data never leaves your device
- **Adaptive Intelligence**: The system quietly tracks what you struggle with and targets it — no manual tweaking needed

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
Models are stored in the Electron userData directory:
- **macOS**: `~/Library/Application Support/KotobaAI/models/`
- **Linux**: `~/.config/KotobaAI/models/`
- **Windows**: `%APPDATA%/KotobaAI/models/`

The app automatically detects and uses any available Whisper model (any `ggml-*.bin` file) in the models directory. It prioritizes larger/better models if multiple are available:
1. `ggml-large-v3-turbo-q8_0.bin` (best quality, recommended)
2. `ggml-large-v3-turbo.bin`
3. `ggml-large-v3.bin`
4. `ggml-large-v2.bin`
5. `ggml-large.bin`
6. `ggml-medium.bin`
7. `ggml-base.bin`
8. `ggml-small.bin` (default, smallest/fastest)

```bash
# Download a model to the userData directory
# On macOS:
mkdir -p ~/Library/Application\ Support/KotobaAI/models
cd ~/Library/Application\ Support/KotobaAI/models

# Example: Download small model (fastest, smallest)
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# Example: Download large turbo model (best quality)
curl -L -o ggml-large-v3-turbo-q8_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin
```

Or run `./bootstrap.sh` to automatically download the default model (ggml-small.bin). You can download additional models later for better accuracy.

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
# Note: The model path will be automatically detected when using managed services
# If running manually, use the full path to any Whisper model in the userData directory:
# On macOS (replace with your actual model filename):
whisper-server --model ~/Library/Application\ Support/KotobaAI/models/ggml-large-v3-turbo-q8_0.bin --threads 8 --port 8080
```

**Stanza Service** (lemmatization):
```bash
cd src/main/lemmatization
uv run python stanza-service.py
# Runs on http://127.0.0.1:8888
```

**Optional: Managed Services** (automatic service management):
The app can automatically start and manage whisper-server and stanza-service as child processes. Enable this with:
```bash
MANAGE_SERVICES=1 npm run dev
```

When enabled:
- Services are spawned on random ports if default ports (8080, 8888) are taken
- Services are monitored and automatically restarted if they crash
- Port conflicts are automatically detected and resolved
- Services are cleaned up when the app exits

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
