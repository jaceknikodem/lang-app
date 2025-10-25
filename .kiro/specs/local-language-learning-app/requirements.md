# Requirements Document

## Introduction

A local-first language learning application that focuses on spoken-style comprehension and vocabulary recall through natural sentences. The system operates entirely offline using local LLM generation, SQLite storage, and system TTS, providing privacy-respecting language learning without external dependencies.

## Glossary

- **Local_Language_App**: The complete Electron-based language learning application
- **LLM_Client**: Local language model interface component using Ollama
- **Audio_Generator**: System component that creates and manages TTS audio files
- **Database_Layer**: SQLite-based persistence component for user progress and content
- **Learning_Mode**: Interactive session where users review generated sentences
- **Quiz_Mode**: Assessment session where users test vocabulary recall
- **Word_Strength**: Numerical value (0-100) representing user's mastery of a word

## Requirements

### Requirement 1

**User Story:** As a language learner, I want to study vocabulary through natural spoken sentences rather than isolated words, so that I can understand contextual usage and improve comprehension.

#### Acceptance Criteria

1. WHEN a user selects words for study, THE Local_Language_App SHALL generate 3-5 natural spoken-style sentences for each word using the LLM_Client
2. THE Local_Language_App SHALL display each sentence with its English translation simultaneously
3. THE Local_Language_App SHALL provide audio playback for every generated sentence using the Audio_Generator
4. THE Local_Language_App SHALL color-code words within sentences based on user status - neutral background for new; green for known, shades of yellow for words being learnt (shading correnponds to Word_Strength value); grey for ignored.
5. WHEN a user clicks on any word within a sentence, THE Local_Language_App SHALL allow marking the word as known or ignored

### Requirement 2

**User Story:** As a privacy-conscious learner, I want all learning data and content generation to remain on my device, so that my learning progress and personal data stay completely private.

#### Acceptance Criteria

1. THE Local_Language_App SHALL operate without any external network connections
2. THE Local_Language_App SHALL store all user progress data locally using the Database_Layer
3. THE Local_Language_App SHALL generate all sentences using a local LLM instance via Ollama HTTP endpoint
4. THE Local_Language_App SHALL create and store all audio files locally using system TTS commands
5. THE Local_Language_App SHALL persist all learning content in the Database_Layer for offline access

### Requirement 3

**User Story:** As a beginner learner, I want the app to automatically prioritize my weakest vocabulary, so that I can focus study time on words that need the most attention.

#### Acceptance Criteria

1. THE Local_Language_App SHALL track Word_Strength values for each vocabulary item based on user performance
2. WHEN entering Quiz_Mode, THE Local_Language_App SHALL select words with the lowest Word_Strength values
3. WHEN a user answers correctly in Quiz_Mode, THE Local_Language_App SHALL increase the Word_Strength for that vocabulary item
4. WHEN a user answers incorrectly in Quiz_Mode, THE Local_Language_App SHALL decrease or reset the Word_Strength for that vocabulary item
5. THE Local_Language_App SHALL update Word_Strength values immediately after each user response

### Requirement 4

**User Story:** As a learner who prefers audio-based learning, I want every sentence to have natural speech playback, so that I can improve my listening comprehension and pronunciation.

#### Acceptance Criteria

1. THE Local_Language_App SHALL generate audio files for all new sentences using system TTS via the Audio_Generator
2. THE Local_Language_App SHALL store audio files locally with naming convention word_counter.aiff
3. THE Local_Language_App SHALL provide a playback button for each sentence
4. THE Local_Language_App SHALL reuse existing audio files from the Database_Layer rather than regenerating
5. THE Local_Language_App SHALL support audio playback without requiring external audio services

### Requirement 5

**User Story:** As a user who wants focused learning sessions, I want to select specific topics and words for study, so that I can customize my learning to relevant vocabulary.

#### Acceptance Criteria

1. THE Local_Language_App SHALL allow users to input optional topic descriptions for vocabulary generation
2. WHEN a topic is provided, THE Local_Language_App SHALL bias word generation toward topic-relevant vocabulary using the LLM_Client
3. WHERE no topic is specified, THE Local_Language_App SHALL generate high-frequency vocabulary words

### Requirement 6

**User Story:** As a learner who dislikes typing, I want to interact with the app using only clicks and buttons, so that I can focus on comprehension rather than input mechanics.

#### Acceptance Criteria

1. THE Local_Language_App SHALL provide only click-based interactions for marking word knowledge status
2. WHEN in Quiz_Mode, THE Local_Language_App SHALL present only "I knew it" and "Not yet" buttons for user responses
3. THE Local_Language_App SHALL enable all vocabulary assessment through binary choice interactions
4. THE Local_Language_App SHALL complete all learning workflows without requiring keyboard input beyond initial topic selection

### Requirement 7

**User Story:** As a learner who wants to track progress, I want the app to remember my vocabulary knowledge between sessions, so that I can build on previous learning without starting over.

#### Acceptance Criteria

1. THE Local_Language_App SHALL persist all Word_Strength values in the Database_Layer between application sessions
2. THE Local_Language_App SHALL maintain word knowledge status (known/unknown, ignored/not) across application restarts
3. THE Local_Language_App SHALL preserve all generated sentences and audio files in local storage
4. WHEN reopening the application, THE Local_Language_App SHALL restore the complete learning state from the previous session
5. THE Local_Language_App SHALL commit all progress updates immediately to prevent data loss

### Requirement 8

**User Story:** As a learner who wants flexible practice, I want to choose between different quiz directions, so that I can test both comprehension and recall skills.

#### Acceptance Criteria

1. WHEN entering Quiz_Mode, THE Local_Language_App SHALL offer selection between foreign-to-English and English-to-foreign quiz directions
2. THE Local_Language_App SHALL present questions in the selected direction throughout the quiz session
3. WHERE foreign-to-English is selected, THE Local_Language_App SHALL display foreign language content and expect English comprehension confirmation
4. WHERE English-to-foreign is selected, THE Local_Language_App SHALL display English content and expect foreign language recall confirmation
5. THE Local_Language_App SHALL maintain consistent quiz direction throughout a single quiz session