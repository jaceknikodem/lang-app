# Local Language Learning App

A privacy-first desktop language learning application that operates entirely offline. Learn vocabulary through contextual sentences with full audio support, spaced repetition, and conversational practice.

## Features

- **Immersive Context**: Every word appears in natural sentences with audio
- **Smarter Spacing**: SRS-powered review adapts precisely to memory strength, keeping recall sharp with less grind
- **Pronunciation Feedback**: Instant, word-level feedback shows exactly where you're off (all privately on your device)
- **Micro-Dialogues**: Choose your reply, speak it aloud, and hear the natural response — real conversation built from what you already know
- **Flow Mode**: Hands-free listening sessions (10–60 min) that train your ear and rhythm without screens or clicks
- **Autopilot Learning**: The app glides between modes — review, quiz, dialogue, flow — so you can just focus on language
- **Multiple LLM Providers**: Use Gemini or local LLMs — your choice of engine and privacy
- **Privacy-First Design**: No accounts. No cloud tracking. Your data never leaves your device
- **Adaptive Intelligence**: The system quietly tracks what you struggle with and targets it — no manual tweaking needed

## On-Device Tracking

All tracking happens locally and never leaves your device. The app tracks:

- **Learning sessions**: Mode, language, duration, and activity counts
- **Word progress**: Strength, SRS values, last studied timestamps, known/ignored words
- **Audio playback**: Which sentences you played, playback speeds, and context
- **Pronunciation practice**: Attempts, similarity scores, transcriptions, and audio recordings
- **Quiz performance**: Recall ratings and strength changes
- **Word selection**: Neglected words (shown but not selected)
- **Dictionary usage**: Hover events for dict lookups
- **Sentence engagement**: Last shown timestamps and play counts

All data is stored in a local SQLite database and never transmitted anywhere.

## Tech Stack

- **Runtime**: Electron (TypeScript)
- **Frontend**: Lit web components
- **Database**: SQLite (better-sqlite3)
- **LLM**: Ollama (local) or Google Gemini API (cloud)
- **Audio**: macOS TTS, ElevenLabs API, or Whisper.cpp
- **Lemmatization**: Stanza (Python/FastAPI)
- **SRS**: FSRS and Classic algorithms

## Dependencies

Most dependencies are automatically installed by `./bootstrap.sh`. The bootstrap script handles:
- **Ollama**: Installed via Homebrew (default LLM provider)
- **Whisper (whisper-cpp)**: Installed via Homebrew
- **uv package manager**: Installed automatically
- **Python dependencies**: Set up in the lemmatization directory
- **Lemmatization service**: Downloads models automatically


The app automatically starts and manages whisper-server and stanza-service as child processes during runtime. Enable this with:
```bash
MANAGE_SERVICES=1 npm run dev
```

## Setup

1. Install Node.js 18+
2. Run the bootstrap script to install system dependencies, download models, and set up services: `./bootstrap.sh`

## Development

```bash
# Development mode
npm run dev

# Run tests
npm run test:all
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
