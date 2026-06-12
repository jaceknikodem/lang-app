# Coding Style and Design Principles

## Core Principles

### Type Safety First
- Use strict TypeScript with explicit types for public APIs
- Validate external data at system boundaries with runtime validation (Zod)
- Use type guards rather than type assertions

### Error Handling
- Always provide context when wrapping errors
- Use error chaining (`error.cause`) to preserve original errors
- Do not write code that's too defensive, prefer early failure, rather then wrapping everything in try-catch.
- Log errors with structured logging before rethrowing

### Structured Logging
- Use structured logging with context objects, not string interpolation
- Include relevant context in all log messages
- Use appropriate log levels (trace, debug, info, warn, error, fatal)

### Code Organization
- Organize by feature/domain, not by type
- Maintain clear boundaries between main, renderer, and shared code
- Use explicit exports, avoid default exports for classes/interfaces
- Refactor large functions
- Prefer modifying old code, rather than creating new similar functions.

### Async/Await
- Always use async/await, never promise chains
- Defer non-critical operations to background
- Handle errors in all async functions

### Validation
- Validate all external data (LLM responses, IPC inputs, user input) with Zod schemas
- Validate at system boundaries (IPC, API calls, file I/O)
- Fail fast with clear error messages

### Architecture
- Service-oriented: organize business logic into service classes with single responsibility
- Dependency injection: inject dependencies through constructors
- Base classes: use abstract base classes for shared functionality
- Clear separation: renderer never imports from main (use IPC)

### Security
- Validate all IPC handler inputs
- Keep renderer process sandboxed
- Don't expose sensitive information in error messages

### Performance
- Defer expensive operations to background when possible
- Load resources on demand
- Use background processing for non-blocking operations
- Prefer database-level SQL operations (such as filtering/limiting), rathern than app-level logic.

### Documentation
- Document public APIs with JSDoc
- Explain why, not what, in comments
- Include file headers describing purpose

### Testing
- Before starting a test, write unit tests (TDD-style)
- After completing a task, run all unit tests to check if it works

### Lit Components
- **ReactiveController threshold**: when a feature area has 3+ related `@state()` fields (e.g. recording state, follow-up state), extract them into a `ReactiveController` — the controller owns the fields and calls `host.requestUpdate()`
- **Service threshold**: component methods that only call `window.electronAPI` and don't read component state (`this.*`) belong in standalone async service functions under `src/renderer/utils/`, returning a union result type (`{ status: 'loaded' | 'error' | ... }`)
- **Sub-component threshold**: a render helper over ~50 lines, or one that represents a visually/logically distinct UI unit, should be its own `@customElement` with scoped `static styles`
- **Growth check**: before adding a new feature to an existing component, ask whether it belongs in a new controller, service function, or sub-component first — adding directly to the component is the last resort, not the default