# Project Structure

## Directory Organization

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

## Component Architecture

### Main Process Components
- **DatabaseLayer**: SQLite CRUD operations, schema management
- **LLMClient**: Ollama HTTP client, prompt generation
- **AudioGenerator**: TTS integration, file caching
- **IPCBridge**: Secure API exposure to renderer

### Renderer Components
- **app-root**: Main application shell and routing
- **learning-mode**: Sentence review and word interaction
- **quiz-mode**: Assessment interface with bidirectional quizzing
- **topic-selector**: Optional topic input for vocabulary generation
- **progress-summary**: Study statistics and progress tracking

## File Naming Conventions

- **Components**: kebab-case (e.g., `word-viewer.ts`)
- **Classes**: PascalCase (e.g., `DatabaseLayer.ts`)
- **Interfaces**: PascalCase with `I` prefix (e.g., `ILLMClient.ts`)
- **Audio files**: `<text_content>.aiff` (e.g., `apa_kabar.aiff`)
- **Database**: `language_learning.db`

## Data Flow Patterns

1. **UI → IPC → Main Process**: All user actions flow through secure IPC
2. **Database-first**: All state changes immediately persisted to SQLite
3. **Component isolation**: Each Lit component manages its own reactive state
4. **Error boundaries**: Each major component handles its own error states

## Security Boundaries

- **Renderer sandbox**: No direct filesystem or system access
- **IPC validation**: All cross-process data validated with Zod schemas
- **Local-only**: No external network access except localhost Ollama
- **File restrictions**: Audio files limited to designated directory