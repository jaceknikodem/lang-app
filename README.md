# Local Language Learning App

A privacy-first desktop language learning application that operates entirely offline. Learn vocabulary through contextual sentences with full audio support, spaced repetition, and conversational practice.

> **macOS only.** Audio recording relies on `sox` and the system TTS backend uses the macOS `say` command. The mlx-lm provider requires Apple Silicon.

## Features

- **Immersive Context**: Every word appears in natural sentences with audio
- **Smarter Spacing**: SRS-powered review adapts precisely to memory strength, keeping recall sharp with less grind
- **Pronunciation Feedback**: Instant, word-level feedback shows exactly where you're off (all privately on your device)
- **Micro-Dialogues**: Choose your reply, speak it aloud, and hear the natural response — real conversation built from what you already know
- **Flow Mode**: Hands-free listening sessions (10–60 min) that train your ear and rhythm without screens or clicks
- **Autopilot Learning**: The app glides between modes — review, quiz, dialogue, flow — so you can just focus on language
- **Anki Export**: Export your vocabulary as an `.apkg` deck with audio, sentences, and translations — re-import anytime to add new cards without overwriting Anki's review progress. Exports are scoped to the active theme (e.g. `Kotoba::Spanish::MTG`)
- **Learning Themes**: Switch between focused topic sets — General, AI/ML, MTG, Leadership — so the vocabulary suggestions and sentence context stay relevant to what you actually care about. Add new themes by dropping a `.txt` file into the `topics/` folder
- **Vocabulary Assessment**: A short adaptive test (2–3 rounds of 6 words) that calibrates your starting level — Newbie, A1, A2, or B1 — before frequency-based learning begins
- **Learn from Articles**: Paste any URL and the app extracts vocabulary from the article so you can study words in their original context
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

Audio files are cached locally under `~/Library/Application Support/KotobaAI/`. Each word generates ~10 WAV files (sentence audio, context clips, English translations), totalling roughly **~1 MB per word**.

## Intelligence of the System

The app uses intelligent algorithms across four key areas:

- **Word Selection**: Prioritizes words by recency (oldest studied first) and strength (weakest first). For topic-based learning, uses LLMs to generate relevant vocabulary, but excludes words you already know/ignore, and words you didn't skip last few times. For frequency-based learning, adapts starting position to proficiency level (A1: position 200, A2: 500, B1: 1000).

- **Sentence Creation**: Combines Tatoeba examples with LLM-generated sentences. Creates natural, conversational sentences that incorporate known words and include contextual dialogue.

- **Quiz Word Selection**: Prioritizes words due for SRS review, then falls back to weakest words. Excludes recently reviewed words (within 24 hours) and randomizes selection for variety.

- **Mode Selection**: Scores each mode based on your learning state (new words, weak words, due reviews, dialogue readiness, pronunciation strength) and navigates to the highest-scoring mode, avoiding mode bouncing.

## Tech Stack

- **Runtime**: Electron (TypeScript)
- **Frontend**: Lit web components
- **Database**: SQLite (better-sqlite3)
- **LLM**: Ollama (local), mlx-lm (Apple Silicon), or Google Gemini API (cloud)
- **Audio**: ElevenLabs API, Kokoro, macOS `say` (system TTS), Whisper.cpp
- **Lemmatization**: Stanza (Python/FastAPI)
- **SRS**: FSRS and Classic algorithms

## Dependencies

Most dependencies are automatically installed by `./bootstrap.sh`. The bootstrap script handles:
- **Ollama**: Installed via Homebrew (default LLM provider)
- **Whisper (whisper-cpp)**: Installed via Homebrew
- **sox**: Installed via Homebrew (required for audio recording)
- **uv package manager**: Installed automatically
- **Python dependencies**: Set up in the lemmatization directory
- **Lemmatization service**: Downloads models automatically

**mlx-lm** (optional, Apple Silicon only): install separately with `pip install mlx-lm`, then start the server with `mlx_lm.server --model <model>` before launching the app.


## Setup

1. Install Node.js 22.19+ from https://nodejs.org/en/download
2. Install `just` if you haven't already: `brew install just` (macOS) or visit [just.systems](https://just.systems)
3. Run the bootstrap setup: `just bootstrap`

## Development

All common tasks are available via `just`:

```bash
# Start development mode
just dev

# Run all tests
just test-all

# Apply formatting
just format

# List all available commands
just --list
```

### Seeding and adding words

```bash
# Seed 20 random topics from the active theme's topic file, generate words and audio
just seed-words

# Add specific words manually (topic is optional context for sentence generation)
just add-words "schadenfreude,weltanschauung" "philosophy"
```

`seed-words` reads the current theme from the database (set via the in-app theme selector) and picks topics from the matching `topics/<theme>.txt` file. Switch themes in the app first, then run `just seed-words` to populate words relevant to that theme.

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
