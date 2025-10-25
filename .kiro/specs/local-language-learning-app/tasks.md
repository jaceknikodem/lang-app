# Implementation Plan

- [x] 1. Set up project structure and core interfaces
  - Create Electron + TypeScript project with proper build configuration
  - Set up directory structure for main process, renderer, and shared types
  - Configure development and build scripts for cross-platform deployment
  - Define core TypeScript interfaces for Word, Sentence, and StudySession models
  - _Requirements: 2.1, 2.2, 7.1_

- [x] 2. Implement database layer and schema
  - [x] 2.1 Create SQLite database connection and migration system
    - Write database connection utilities with proper error handling
    - Implement schema migration system for future updates
    - Create initial database schema for words, sentences, and topics tables
    - _Requirements: 7.1, 7.3, 7.4_
  
  - [x] 2.2 Implement core database operations
    - Write CRUD operations for Word entity (insert, update, select by strength)
    - Implement sentence storage and retrieval by word ID
    - Create progress tracking functions for word strength and study timestamps
    - _Requirements: 3.1, 3.3, 3.4, 7.2, 7.5_
  
  - [ ]* 2.3 Write database layer unit tests
    - Create unit tests for all CRUD operations
    - Test data integrity and constraint validation
    - Verify transaction handling and rollback scenarios
    - _Requirements: 7.1, 7.5_

- [x] 3. Create LLM client for local content generation
  - [x] 3.1 Implement Ollama HTTP client
    - Write HTTP client for communicating with local Ollama instance
    - Create prompt templates for topic word generation and sentence creation
    - Implement response validation using Zod schemas
    - _Requirements: 1.1, 2.3, 5.2_
  
  - [x] 3.2 Build content generation workflows
    - Implement topic-based word generation with frequency classification
    - Create sentence generation for vocabulary words with translations
    - Add retry logic and error handling for LLM communication failures
    - _Requirements: 1.1, 5.2, 5.5_
  
  - [ ]* 3.3 Create LLM client unit tests
    - Mock Ollama API responses for testing
    - Test prompt template generation and response parsing
    - Verify error handling and retry mechanisms
    - _Requirements: 1.1, 2.3_

- [x] 4. Implement audio generation and caching system
  - [x] 4.1 Create TTS audio generator
    - Write system TTS integration using macOS 'say' command
    - Implement audio file naming convention and storage management
    - Create audio caching logic to avoid regenerating existing files
    - _Requirements: 1.3, 4.1, 4.2, 4.4_
  
  - [x] 4.2 Build audio playback coordination
    - Implement audio playback functionality for UI integration
    - Create audio file existence checking and validation
    - Add error handling for TTS generation failures
    - _Requirements: 4.3, 4.5_
  
  - [ ]* 4.3 Write audio system unit tests
    - Test TTS command execution and file generation
    - Verify caching logic and file naming conventions
    - Test audio playback coordination and error scenarios
    - _Requirements: 4.1, 4.4_

- [x] 5. Create Electron IPC bridge and main process
  - [x] 5.1 Set up Electron main process architecture
    - Configure Electron main process with security best practices
    - Create preload script for secure IPC communication
    - Implement main process initialization and lifecycle management
    - _Requirements: 2.1, 2.2_
  
  - [x] 5.2 Build IPC API surface
    - Expose database operations through secure IPC channels
    - Create LLM client APIs for renderer process access
    - Implement audio generation and playback IPC methods
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [ ]* 5.3 Test IPC communication and security
    - Verify secure communication between main and renderer processes
    - Test API surface completeness and error propagation
    - Validate input sanitization and security boundaries
    - _Requirements: 2.1, 2.2_

- [ ] 6. Implement core UI components with Lit
  - [ ] 6.1 Create application shell and routing
    - Build main app component with mode-based routing
    - Implement navigation between topic selection, learning, and quiz modes
    - Create shared UI utilities and styling system
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [ ] 6.2 Build topic and word selection components
    - Create topic input component with optional text entry
    - Implement word list display with manual selection checkboxes
    - Add word selection validation and session initialization
    - _Requirements: 5.1, 5.3, 5.4, 6.3_
  
  - [ ] 6.3 Implement sentence review (learning mode) components
    - Create sentence display component with color-coded word highlighting
    - Build word interaction system for marking known/unknown status
    - Implement audio playback button integration
    - _Requirements: 1.2, 1.4, 1.5, 4.3, 6.1, 6.4_
  
  - [ ]* 6.4 Write UI component unit tests
    - Test component rendering and user interaction handling
    - Verify state management and event propagation
    - Test accessibility and keyboard navigation
    - _Requirements: 1.4, 1.5, 6.1_

- [ ] 7. Create quiz mode and assessment system
  - [ ] 7.1 Implement quiz question generation
    - Build quiz question selection based on weakest words
    - Create question display for both quiz directions (foreign↔English)
    - Implement quiz session state management and progression
    - _Requirements: 3.2, 8.1, 8.2, 8.5_
  
  - [ ] 7.2 Build quiz interaction and scoring
    - Create correct/incorrect answer buttons with click handling
    - Implement immediate word strength updates based on quiz responses
    - Add quiz completion and results summary display
    - _Requirements: 3.3, 3.4, 3.5, 6.2, 6.4, 8.3, 8.4_
  
  - [ ]* 7.3 Write quiz system unit tests
    - Test question generation and selection algorithms
    - Verify scoring logic and strength calculation updates
    - Test quiz direction handling and session management
    - _Requirements: 3.2, 3.3, 8.1, 8.2_

- [ ] 8. Integrate complete learning workflow
  - [ ] 8.1 Connect all components into complete user flow
    - Wire topic selection → word selection → learning mode → quiz mode
    - Implement session state persistence and restoration
    - Create smooth transitions between all application modes
    - _Requirements: 5.4, 7.4, 7.5_
  
  - [ ] 8.2 Add progress tracking and summary features
    - Implement progress summary display with study statistics
    - Create word knowledge status tracking across sessions
    - Add session completion handling and next session preparation
    - _Requirements: 7.1, 7.2, 7.4_
  
  - [ ]* 8.3 Create end-to-end integration tests
    - Test complete learning workflow from topic to quiz completion
    - Verify data persistence across application restarts
    - Test error recovery and graceful degradation scenarios
    - _Requirements: 2.1, 7.4, 7.5_

- [ ] 9. Implement application packaging and deployment
  - [ ] 9.1 Configure build system for distribution
    - Set up Electron Builder for cross-platform packaging
    - Create application icons and metadata for distribution
    - Configure code signing and notarization for macOS
    - _Requirements: 2.1, 2.2_
  
  - [ ] 9.2 Add application lifecycle and data management
    - Implement proper application startup and shutdown handling
    - Create data backup and restore functionality
    - Add application update mechanism for future versions
    - _Requirements: 2.2, 7.3, 7.4_
  
  - [ ]* 9.3 Create deployment and distribution tests
    - Test application packaging and installation processes
    - Verify cross-platform compatibility and performance
    - Test data migration and backup/restore functionality
    - _Requirements: 2.1, 2.2_