# HTTP/REST Migration Plan

## Goal

Extract the backend from Electron IPC into a standalone HTTP server so the renderer
can run as an ordinary browser-based web app.

## Current architecture

```
Electron main process  ←→  preload (contextBridge)  ←→  Electron renderer
  DB, LLM, audio, SRS       window.electronAPI.*          UI components
```

## Target architecture

```
Node.js HTTP server  ←→  fetch() + WebSocket  ←→  Browser (or Electron shell)
  DB, LLM, audio, SRS    ApiClient abstraction      UI components (unchanged)
```

---

## What needs to change (by category)

### 1. File paths → URLs
Audio files are stored at `{userData}/audio/{lang}/…` and the DB keeps absolute paths.
The server serves the audio directory as static files and the API returns URLs instead
of paths. No DB schema change needed: the server strips the base prefix at the API layer.

`/audio/es/word_123/sentence_456.wav` served at `GET /audio/es/word_123/sentence_456.wav`

Affects every field named `audioPath`, `beforeSentenceAudio`, `afterSentenceAudio`,
`continuationAudios`, `englishAudioPath`, and the `audioPath` column in the DB.

### 2. Push events → WebSocket
One push channel survives (streaming transcription preview is dropped):

- `jobs.onWordUpdated` — fires when background word generation finishes/fails

This becomes a WebSocket broadcast from the server to all connected clients.
Protocol: `{ type: "word-updated", payload: { wordId, processingStatus, sentenceCount } }`

### 3. Audio playback → browser Web Audio API
`audio.playAudio(path)` and `audio.stopAudio()` delegate to the main process today.
In the browser the renderer handles playback itself. The renderer already has
`AudioPlayerService` that fetches audio data; it will just use the audio URL directly
(`new Audio(url)` or `fetch(url)` into an AudioBuffer) instead of `loadAudioBase64`.

Remove from server API: `playAudio`, `stopAudio`, `loadAudioBase64`.

### 4. Audio recording → browser MediaRecorder
`startRecording` / `stopRecording` use a system-level recorder in the main process.
The `RecordingSession` it returns contains a file path that gets passed to `transcribeAudio`.

Replace with:
1. Browser `navigator.mediaDevices.getUserMedia()` + `MediaRecorder` → produces a Blob
2. `POST /api/audio/transcribe` (multipart/form-data) accepts the Blob directly

Remove from server API: `startRecording`, `stopRecording`, `cancelRecording`,
`getCurrentRecordingSession`, `isRecording`, `getAvailableRecordingDevices`,
`deleteRecording`, `getRecordingInfo`.

`onTranscriptionProgress` (streaming live preview) is dropped entirely.

### 5. Native OS dialogs / app lifecycle → browser equivalents

| Current | Replacement |
|---|---|
| `lifecycle.openBackupDialog()` | `<a download href="/api/lifecycle/backup">` |
| `lifecycle.restoreFromBackup(path)` | `POST /api/lifecycle/restore` (file upload) |
| `lifecycle.openBackupDirectory()` | remove (show path as text if needed) |
| `lifecycle.closeApp()` | `window.close()` |
| `lifecycle.checkForUpdates()` | `GET /api/version` |
| `lifecycle.restartAll()` | `window.location.reload()` |

---

## Phases

### Phase 1 — HTTP server (backend only)

Stand up a Fastify server inside the Electron main process. Wire every existing IPC
handler namespace as a set of HTTP routes. Keep IPC working in parallel throughout
this phase; no renderer changes yet.

**Tasks**
- Add `fastify`, `@fastify/cors`, `@fastify/static` to dependencies
- Create `src/server/`:
  - `server.ts` — Fastify instance, plugin registration, starts on a configurable port
    (default `11011`, read from `config.toml` or env var)
  - `routes/database.ts`, `routes/llm.ts`, `routes/audio.ts`, `routes/srs.ts`,
    `routes/jobs.ts`, `routes/dialog.ts`, `routes/flow.ts`, `routes/scoring.ts`,
    `routes/lifecycle.ts`, `routes/lemmatization.ts`, `routes/topics.ts`, `routes/quiz.ts`
  - `middleware/error-handler.ts` — maps thrown errors to HTTP status codes
- Serve the audio directory as static files under `/audio` prefix
- Each route handler receives the same service instances already used by IPC handlers
  (pass them in as Fastify plugins / decorated context)
- Start the server from `main.ts` before creating the Electron window; pass the port
  to the renderer via an existing IPC call or hardcode it

**Outcome:** every API call reachable via `curl`; renderer untouched.

---

### Phase 2 — WebSocket for job updates

Add a WebSocket server on the same port.

**Tasks**
- Add `ws` to dependencies
- Create `src/server/websocket.ts` — upgrades `http.Server` connections on `/ws`
- `WordGenerationRunner` already has an event emitter; subscribe to it and broadcast
  `word-updated` messages to all connected clients
- No renderer changes yet (IPC listener still works)

**Outcome:** job updates reachable over WebSocket; can be verified with `wscat`.

---

### Phase 3 — Renderer transport abstraction

Create an `ApiClient` interface that mirrors `IPCBridge` so the renderer can be
switched from IPC to HTTP without touching every call site.

**Tasks**
- `src/shared/client/api-client.ts` — interface type (same shape as `IPCBridge`)
- `src/shared/client/ipc-client.ts` — current implementation wrapping `window.electronAPI`
- `src/shared/client/http-client.ts` — new implementation using `fetch()` + WebSocket
- `src/shared/client/index.ts` — exports `createApiClient(transport: 'ipc' | 'http')`
  selected by a build flag or `?transport=http` URL param initially
- Replace all `window.electronAPI.*` usages in `src/renderer/` with the client instance

**Outcome:** renderer works against both transports; switch with a flag.

---

### Phase 4 — Audio URL migration

Switch audio from base64/path transfer to plain HTTP URLs.

**Tasks**
- Add a helper in the server that converts an absolute audio path to a server-relative
  URL: strip `{userData}/audio` prefix, prepend `/audio`
- Apply the conversion at the API boundary (route handlers) — DB keeps absolute paths
- `AudioPlayerService` in the renderer fetches audio via URL instead of `loadAudioBase64`
- Update all renderer components that called `playAudio`/`stopAudio` directly (dialog-mode,
  quiz-mode, app-root) to use `AudioPlayerService`
- Remove `playAudio`, `stopAudio`, `loadAudioBase64` from server routes and `ApiClient`

**Outcome:** all audio served over HTTP; no binary payloads in API responses.

---

### Phase 5 — Recording migration

Replace main-process recording with browser `MediaRecorder`.

**Tasks**
- Create `src/renderer/utils/media-recorder-service.ts` wrapping `getUserMedia` +
  `MediaRecorder`; produces a `Blob` on stop
- Add `POST /api/audio/transcribe` route that accepts a `multipart/form-data` upload,
  writes the Blob to a temp file, calls `AudioService.transcribeAudio`, returns result
- Update `RecordingController`, `audio-recorder.ts`, and their callers in `dialog-mode`
  and `quiz-mode` to use the new service
- Remove `startRecording`, `stopRecording`, `cancelRecording`, `getCurrentRecordingSession`,
  `isRecording`, `getAvailableRecordingDevices`, `deleteRecording`, `getRecordingInfo` from
  server routes and `ApiClient`
- Remove `onTranscriptionProgress` from `ApiClient` and delete `TranscriptionController`
  (or replace with a simple spinner)

**Outcome:** recording fully in browser; no OS-level audio capture on the server.

---

### Phase 6 — Native dialog / lifecycle cleanup

Replace the remaining Electron-specific calls.

**Tasks**
- `POST /api/lifecycle/backup` — triggers backup, returns the file as a download response
- `POST /api/lifecycle/restore` — accepts a `.db` file upload, restores it
- Settings panel: replace `openBackupDialog` button with a download link and a
  `<input type="file">` for restore; remove `openBackupDirectory` button
- `lifecycle.closeApp()` → `window.close()`
- `lifecycle.checkForUpdates()` → `GET /api/version` returning `{ version, latestVersion }`
- `lifecycle.restartAll()` → `window.location.reload()`

**Outcome:** no Electron-specific calls remain in the renderer.

---

### Phase 7 — Decouple server from Electron

Once the renderer is HTTP-only:

**Tasks**
- Move `src/server/` to its own entry point (`src/server/index.ts`) runnable with plain
  `node` or `ts-node`
- Electron `main.ts` imports the server module and starts it (no architectural change,
  just a clean separation of concerns)
- Renderer `index.html` is served as a static file by Fastify (remove `build-renderer.js`
  Electron-specific step if no longer needed, or keep for the packaged app)
- The app can now also run headlessly: `node dist/server/index.js` + open a browser

**Outcome:** server and renderer are independently deployable.

---

## Not changing

- SQLite database and schema
- LLM providers (Ollama, Gemini, MLX-LM) and all LLM service logic
- SRS algorithm (FSRS engine)
- All business logic in `src/main/` services — they just get called by HTTP routes
  instead of IPC handlers

## Open questions

- **Port:** fixed (`11011`) or dynamic? Dynamic avoids conflicts but the renderer needs
  to be told the port at startup; fixed is simpler for development.
- **Auth:** localhost-only for now — no auth needed initially. Worth revisiting if the
  server ever listens on non-loopback interfaces.
- **DB audio paths:** currently absolute. Phase 4 converts at the API layer without
  touching the DB. A future cleanup could migrate stored paths to relative.
- **Electron packaging:** `better-sqlite3` is already bundled as a native module; Fastify
  and `ws` are pure JS so no new bundling issues.
