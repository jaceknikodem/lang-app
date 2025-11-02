/**
 * Dialog mode component for conversational practice
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Sentence, DialogueVariant } from '../../shared/types/core.js';
import { sharedStyles } from '../styles/shared.js';
import { useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import { sessionManager } from '../utils/session-manager.js';
import type { RecordingOptions, RecordingSession } from '../../shared/types/audio.js';

// DialogueVariant is now imported from shared/types/core.js

interface TranscriptionResult {
  text: string;
  similarity: number;
  normalizedTranscribed: string;
  normalizedExpected: string;
  expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
  transcribedWords: string[];
}

@customElement('dialog-mode')
export class DialogMode extends LitElement {
  @state()
  private isLoading = false;

  @state()
  private error: string | null = null;

  @state()
  private currentSentence: Sentence | null = null;

  @state()
  private beforeSentenceAudio: string | null = null;

  @state()
  private responseOptions: DialogueVariant[] = [];

  @state()
  private selectedOption: DialogueVariant | null = null;

  @state()
  private isRecording = false;

  @state()
  private recordingTime = 0;

  @state()
  private currentRecording: {
    session: RecordingSession;
    filePath: string;
    duration: number;
  } | null = null;

  @state()
  private transcriptionResult: TranscriptionResult | null = null;

  @state()
  private isTranscribing = false;

  @state()
  private streamingTranscriptionText: string | null = null;

  @state()
  private speechRecognitionReady = false;

  @state()
  private followUpText = '';

  @state()
  private followUpTranslation = '';

  @state()
  private followUpAudio: string | null = null;

  @state()
  private showFollowUp = false;

  private recordedAudioPath: string | null = null;

  @state()
  private isGeneratingFollowUp = false;

  @state()
  private showTranslations = true;

  private recordingTimer: number | null = null;
  private recordingStatusCheckTimer: number | null = null;
  private speechRecognitionCheckTimer: number | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private transcriptionProgressUnsubscribe: (() => void) | null = null;
  private keyboardUnsubscribe?: () => void;
  private currentLanguage = '';
  private dialogCount = 0; // Track number of dialogs completed in this session

  private handleExternalLanguageChange = async (event: Event) => {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    this.currentLanguage = newLanguage;
    
    // Update session manager with new language to ensure it uses correct language's session
    sessionManager.setActiveLanguage(newLanguage);
    
    // Cancel any ongoing recording or transcription
    if (this.isRecording) {
      await this.cancelRecording();
    }
    
    // Reset dialog state
    this.transcriptionResult = null;
    this.selectedOption = null;
    this.followUpText = '';
    this.followUpTranslation = '';
    this.followUpAudio = null;
    this.showFollowUp = false;
    this.isGeneratingFollowUp = false;
    this.isTranscribing = false;
    this.streamingTranscriptionText = null;
    this.recordedAudioPath = null;
    this.dialogCount = 0; // Reset dialog count on language change
    
    // Reload dialog session for the new language
    await this.loadDialogSession();
  };

  connectedCallback() {
    super.connectedCallback();
    
    // Reset dialog count when component is connected
    this.dialogCount = 0;
    
    // Listen for language changes
    document.addEventListener('language-changed', this.handleExternalLanguageChange);
    
    // Load current language
    window.electronAPI.database.getCurrentLanguage().then(language => {
      this.currentLanguage = language;
    }).catch(err => {
      console.error('Failed to load current language:', err);
    });
    
    this.loadDialogSession();
    this.checkSpeechRecognitionReady();
    
    // Set up periodic checks
    this.speechRecognitionCheckTimer = window.setInterval(() => {
      this.checkSpeechRecognitionReady();
    }, 5000);

    // Set up transcription progress listener for streaming updates
    this.transcriptionProgressUnsubscribe = window.electronAPI.audio.onTranscriptionProgress(
      (payload) => {
        if (payload.isFinal) {
          // Final transcription received, clear streaming text
          this.streamingTranscriptionText = null;
        } else {
          // Intermediate transcription update
          this.streamingTranscriptionText = payload.text;
          this.requestUpdate();
        }
      }
    );

    // Set up keyboard bindings
    this.setupKeyboardBindings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    // Remove language change listener
    document.removeEventListener('language-changed', this.handleExternalLanguageChange);
    
    // Clean up transcription progress listener
    if (this.transcriptionProgressUnsubscribe) {
      this.transcriptionProgressUnsubscribe();
      this.transcriptionProgressUnsubscribe = null;
    }
    
    // Clean up recording timers
    this.clearRecordingTimer();
    this.clearRecordingStatusCheck();
    if (this.speechRecognitionCheckTimer) {
      clearInterval(this.speechRecognitionCheckTimer);
      this.speechRecognitionCheckTimer = null;
    }
    
    // Cancel any ongoing recording
    if (this.isRecording) {
      this.cancelRecording().catch(err => {
        console.error('Error cancelling recording on disconnect:', err);
      });
    }
    
    // Clean up keyboard bindings
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
      this.keyboardUnsubscribe = undefined;
    }
    
    // Clean up audio
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
  }

  private async loadDialogSession() {
    try {
      this.isLoading = true;
      this.error = null;
      this.currentSentence = null;
      this.responseOptions = [];
      this.selectedOption = null;
      this.followUpText = '';
      this.followUpTranslation = '';
      this.followUpAudio = null;
      this.showFollowUp = false;
      this.transcriptionResult = null;
      this.recordedAudioPath = null;

      // Check for cached dialog session first
      const cachedSession = sessionManager.getCurrentDialogSession();
      if (cachedSession) {
        console.log('[DialogMode] loadDialogSession - using cached session from session manager', {
          sessionId: cachedSession.id,
          sentenceId: cachedSession.sentenceId,
          responseOptionsCount: cachedSession.responseOptions.length
        });
        
        // Get current language to verify cached session is for the correct language
        const currentLanguage = await window.electronAPI.database.getCurrentLanguage();
        
        // Load from cache
        try {
          const sentences = await window.electronAPI.database.getSentencesByIds([cachedSession.sentenceId]);
          const sentence = sentences && sentences.length > 0 ? sentences[0] : null;
          
          if (!sentence) {
            console.log('[DialogMode] loadDialogSession - cached session sentence not found in DB, discarding session', {
              sessionId: cachedSession.id,
              cachedSentenceId: cachedSession.sentenceId
            });
            sessionManager.consumeCurrentDialogSession();
          } else if (sentence) {
            // Verify the sentence's language matches the current language
            const word = await window.electronAPI.database.getWordById(sentence.wordId);
            
            if (word && word.language === currentLanguage) {
              console.log('[DialogMode] loadDialogSession - cached session validated and loaded', {
                sessionId: cachedSession.id,
                sentenceId: sentence.id,
                wordId: sentence.wordId,
                language: currentLanguage,
                responseOptionsCount: cachedSession.responseOptions.length
              });
              this.currentSentence = sentence;
              this.beforeSentenceAudio = cachedSession.beforeSentenceAudio || null;
              
              // Convert cached response options back to DialogueVariant format
              this.responseOptions = cachedSession.responseOptions.map(v => ({
                id: v.id,
                sentenceId: v.sentenceId,
                variantSentence: v.variantSentence,
                variantTranslation: v.variantTranslation,
                createdAt: new Date(v.createdAt)
              }));
              
              // Don't consume yet - will be consumed when user completes the dialog (in nextDialog)
              // This allows the session to persist if the user navigates away and comes back
              
              this.isLoading = false;
              
              // Auto-play trigger audio if available
              if (this.beforeSentenceAudio) {
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    this.playBeforeSentence();
                  }, 300);
                });
              }
              return;
            } else {
              // Language mismatch - discard cached session
              console.log('[DialogMode] loadDialogSession - language mismatch, discarding cached session', {
                sessionId: cachedSession.id,
                sentenceId: sentence.id,
                wordLanguage: word?.language || 'NOT_FOUND',
                currentLanguage: currentLanguage
              });
              sessionManager.consumeCurrentDialogSession();
            }
          }
        } catch (error) {
          console.error('[DialogMode] loadDialogSession - error during validation', {
            sessionId: cachedSession.id,
            cachedSentenceId: cachedSession.sentenceId,
            error
          });
          sessionManager.consumeCurrentDialogSession();
        }
      }

      // No cached session - generate new one
      console.log('[DialogMode] loadDialogSession - no cached session, generating new');
      // Step 1: Select a sentence with high word strengths
      const sentence = await window.electronAPI.dialog.selectSentence();
      
      if (!sentence) {
        console.log('[DialogMode] loadDialogSession - no sentence available');
        this.error = 'No sentences available for dialog practice. Please learn more words first.';
        this.isLoading = false;
        return;
      }

      console.log('[DialogMode] loadDialogSession - selected new sentence', {
        sentenceId: sentence.id,
        wordId: sentence.wordId
      });
      this.currentSentence = sentence;

      // Step 2: Prepare trigger (beforeSentence audio)
      if (sentence.contextBefore) {
        try {
          const audioPath = await window.electronAPI.dialog.ensureBeforeSentenceAudio(sentence.id);
          this.beforeSentenceAudio = audioPath || null;
        } catch (error) {
          console.warn('Failed to generate beforeSentence audio:', error);
          this.beforeSentenceAudio = null;
        }
      }

      // Step 3: Generate response options (target + 2 variants)
      try {
        console.log('[DialogMode] loadDialogSession - generating variants', {
          sentenceId: sentence.id
        });
        const variants = await window.electronAPI.dialog.generateVariants(sentence.id);
        
        console.log('[DialogMode] loadDialogSession - variants generated', {
          sentenceId: sentence.id,
          variantsCount: variants.length,
          variantIds: variants.map(v => v.id)
        });
        
        // Create a pseudo-variant for the original sentence (using negative ID to indicate it's the original)
        const originalVariant: DialogueVariant = {
          id: -sentence.id, // Negative ID to indicate it's the original sentence
          sentenceId: sentence.id,
          variantSentence: sentence.sentence,
          variantTranslation: sentence.translation,
          createdAt: new Date()
        };
        
        // Combine target sentence with variants
        this.responseOptions = [
          originalVariant,
          ...variants.slice(0, 2) // Take up to 2 variants
        ];
        
        // Shuffle options so target isn't always first
        this.responseOptions.sort(() => Math.random() - 0.5);
      } catch (error) {
        console.error('Failed to generate variants:', error);
        // Fallback: use only the target sentence
        this.responseOptions = [{
          id: -sentence.id,
          sentenceId: sentence.id,
          variantSentence: sentence.sentence,
          variantTranslation: sentence.translation,
          createdAt: new Date()
        }];
      }

      this.isLoading = false;
      
      // Save the generated session to cache so it persists across navigation
      // Only save if we have response options
      if (this.responseOptions && this.responseOptions.length > 0) {
        try {
          const dialogSession: import('../utils/session-manager.js').DialogSessionState = {
            id: `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sentenceId: sentence.id,
            sentence: sentence.sentence,
            translation: sentence.translation,
            contextBefore: sentence.contextBefore,
            contextBeforeTranslation: sentence.contextBeforeTranslation,
            beforeSentenceAudio: this.beforeSentenceAudio || undefined,
            responseOptions: this.responseOptions.map(v => ({
              id: v.id,
              sentenceId: v.sentenceId,
              variantSentence: v.variantSentence,
              variantTranslation: v.variantTranslation,
              createdAt: v.createdAt.toISOString()
            })),
            createdAt: new Date().toISOString()
          };
          
          // Add to cache (will set currentDialogIndex if it's the first session)
          sessionManager.addDialogSession(dialogSession);
        } catch (error) {
          console.error('[DialogMode] loadDialogSession - failed to save session to cache', error);
        }
      }
      
      // Auto-play trigger audio if available (after component updates)
      if (this.beforeSentenceAudio) {
        // Use requestAnimationFrame to ensure component has rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.playBeforeSentence();
          }, 300);
        });
      }
    } catch (error) {
      console.error('Failed to load dialog session:', error);
      this.error = error instanceof Error ? error.message : 'Failed to load dialog session';
      this.isLoading = false;
    }
  }

  private async checkSpeechRecognitionReady() {
    try {
      this.speechRecognitionReady = await window.electronAPI.audio.isSpeechRecognitionReady();
    } catch (error) {
      console.error('Failed to check speech recognition readiness:', error);
      this.speechRecognitionReady = false;
    }
  }

  private async playBeforeSentence() {
    // If continuation is generated, play all 3 in sequence: trigger, user recording, continuation
    if (this.showFollowUp && this.recordedAudioPath && this.followUpAudio) {
      try {
        // Stop any currently playing audio (both HTML5 and system audio)
        if (this.currentAudioElement) {
          this.currentAudioElement.pause();
          this.currentAudioElement = null;
        }
        // Stop system audio playback to ensure clean sequential playback
        // Stop multiple times to ensure any queued auto-play is cancelled
        try {
          await window.electronAPI.audio.stopAudio();
          await new Promise(resolve => setTimeout(resolve, 200));
          await window.electronAPI.audio.stopAudio(); // Stop again to catch any late-starting audio
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (stopError) {
          // Ignore errors when stopping (might not be playing)
        }

        // Play trigger audio and wait for it to complete
        if (this.beforeSentenceAudio) {
          try {
            console.log('[DialogMode] Playing trigger audio:', this.beforeSentenceAudio);
            await window.electronAPI.audio.playAudio(this.beforeSentenceAudio);
            console.log('[DialogMode] Trigger audio finished');
            
            // Track sentence play count
            if (this.currentSentence?.id) {
              void window.electronAPI.database.incrementSentencePlayCount(this.currentSentence.id).catch(err => {
                console.warn('Failed to increment sentence play count:', err);
              });
            }
          } catch (error) {
            console.error('Failed to play trigger audio:', error);
            // Continue with next audio even if this one fails
          }
        }

        // Play user's recording (normalized for better volume) and wait for it to complete
        if (this.recordedAudioPath) {
          try {
            // Normalize/amplify the recording for better playback volume (5dB amplification)
            const normalizedPath = await window.electronAPI.audio.normalizeAudioVolume(this.recordedAudioPath, 5);
            const audioPathToPlay = normalizedPath || this.recordedAudioPath;
            
            console.log('[DialogMode] Playing user recording:', audioPathToPlay);
            await window.electronAPI.audio.playAudio(audioPathToPlay);
            console.log('[DialogMode] User recording finished');
          } catch (error) {
            console.error('Failed to play user recording:', error);
            // Continue with next audio even if this one fails
          }
        }

        // Play continuation audio and wait for it to complete
        if (this.followUpAudio) {
          try {
            console.log('[DialogMode] Playing continuation audio:', this.followUpAudio);
            await window.electronAPI.audio.playAudio(this.followUpAudio);
            console.log('[DialogMode] Continuation audio finished');
          } catch (error) {
            console.error('Failed to play continuation audio:', error);
          }
        }
      } catch (error) {
        console.error('Failed to play dialog sequence:', error);
      }
      return;
    }

    // Before user speaks: just play trigger audio
    if (!this.beforeSentenceAudio) {
      return;
    }

    try {
      // Stop any currently playing audio
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }

      // Play the trigger audio
      await window.electronAPI.audio.playAudio(this.beforeSentenceAudio);
      
      // Track sentence play count
      if (this.currentSentence?.id) {
        void window.electronAPI.database.incrementSentencePlayCount(this.currentSentence.id).catch(err => {
          console.warn('Failed to increment sentence play count:', err);
        });
      }
    } catch (error) {
      console.error('Failed to play before sentence audio:', error);
    }
  }

  private async playFollowUpAudio() {
    if (!this.followUpAudio) {
      return;
    }

    try {
      // Stop any currently playing audio
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }

      // Play the audio
      await window.electronAPI.audio.playAudio(this.followUpAudio);
    } catch (error) {
      console.error('Failed to play follow-up audio:', error);
    }
  }

  private setupKeyboardBindings() {
    const bindings = [
      // Recording
      {
        ...GlobalShortcuts.RECORD_PRONUNCIATION,
        action: () => this.toggleRecording(),
        context: 'dialog',
        description: 'Toggle pronunciation recorder'
      },
      // Audio replay (speaker button)
      {
        key: CommonKeys.SPACE,
        action: () => {
          if (this.beforeSentenceAudio && !this.isRecording) {
            this.playBeforeSentence();
          }
        },
        context: 'dialog',
        description: 'Play trigger audio'
      },
      // Toggle translation visibility
      {
        key: 't',
        action: () => {
          this.showTranslations = !this.showTranslations;
        },
        context: 'dialog',
        description: 'Toggle English translation visibility'
      },
      // Next dialog
      {
        key: CommonKeys.ENTER,
        action: () => {
          // Allow skipping dialog anytime, except during recording/transcription or when generating follow-up
          if (!this.isRecording && !this.isTranscribing && !this.isGeneratingFollowUp) {
            this.nextDialog();
          }
        },
        context: 'dialog',
        description: 'Next dialog'
      }
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private async toggleRecording() {
    if (!this.speechRecognitionReady || !this.responseOptions.length) {
      return;
    }
    
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording || !this.speechRecognitionReady || !this.responseOptions.length) {
      return;
    }

    try {
      // Stop any currently playing audio
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }

      const recordingOptions: RecordingOptions = {
        sampleRate: 16000,
        channels: 1,
        threshold: 0.5,
        silence: '1.0',
        endOnSilence: true
      };

      const session = await window.electronAPI.audio.startRecording(recordingOptions);
      this.isRecording = true;
      this.recordingTime = 0;
      this.currentRecording = null;
      this.transcriptionResult = null;
      this.isTranscribing = false;
      
      // Start recording timer
      this.recordingTimer = window.setInterval(() => {
        this.recordingTime += 1;
      }, 1000);

      // Set up periodic check for recording status (in case of auto-stop)
      this.setupRecordingStatusCheck();
    } catch (error) {
      console.error('Error starting recording:', error);
      this.isRecording = false;
      this.error = `Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async stopRecording() {
    if (!this.isRecording) {
      return;
    }

    try {
      const completedSession = await window.electronAPI.audio.stopRecording();
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      
      // Hide transcribing box when stopping recording
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;

      if (completedSession && !completedSession.isRecording) {
        // Get the recording file path from the session
        const filePath = completedSession.filePath;
        
        // Calculate duration if available
        const duration = completedSession.duration || (Date.now() - completedSession.startTime) / 1000;

        this.currentRecording = {
          session: completedSession,
          filePath,
          duration
        };

        // Automatically perform speech recognition
        await this.performSpeechRecognition();
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      // Hide transcribing box on error too
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;
      this.error = `Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async cancelRecording() {
    if (!this.isRecording) {
      return;
    }

    try {
      await window.electronAPI.audio.cancelRecording();
      this.isRecording = false;
      this.currentRecording = null;
      this.transcriptionResult = null;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      // Hide transcribing box when canceling
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;
    } catch (error) {
      console.error('Error cancelling recording:', error);
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      // Hide transcribing box on error too
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;
    }
  }

  private clearRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private setupRecordingStatusCheck() {
    // Clear any existing status check timer
    this.clearRecordingStatusCheck();

    // Check recording status every 500ms to detect auto-stop
    this.recordingStatusCheckTimer = window.setInterval(async () => {
      if (this.isRecording) {
        try {
          const isStillRecording = await window.electronAPI.audio.isRecording();
          if (!isStillRecording) {
            // Recording was stopped automatically (likely due to silence)
            await this.handleRecordingAutoStop();
          }
        } catch (error) {
          console.error('Error checking recording status:', error);
        }
      }
    }, 500);
  }

  private clearRecordingStatusCheck() {
    if (this.recordingStatusCheckTimer) {
      clearInterval(this.recordingStatusCheckTimer);
      this.recordingStatusCheckTimer = null;
    }
  }

  private async handleRecordingAutoStop() {
    this.isRecording = false;
    this.clearRecordingTimer();
    this.clearRecordingStatusCheck();

    try {
      const completedSession = await window.electronAPI.audio.getCurrentRecordingSession();
      
      if (completedSession && !completedSession.isRecording) {
        const filePath = completedSession.filePath;
        const duration = completedSession.duration || (Date.now() - completedSession.startTime) / 1000;

        this.currentRecording = {
          session: completedSession,
          filePath,
          duration
        };

        // Automatically perform speech recognition
        await this.performSpeechRecognition();
      }
    } catch (error) {
      console.error('Error handling auto-stop:', error);
      this.error = 'Recording stopped automatically but there was an error processing it.';
      this.isRecording = false;
    }
  }

  private async performSpeechRecognition() {
    if (!this.currentRecording || !this.responseOptions.length || !this.speechRecognitionReady) {
      return;
    }

    this.isTranscribing = true;
    this.transcriptionResult = null;
    this.streamingTranscriptionText = null;

    try {
      const currentLanguage = await window.electronAPI.database.getCurrentLanguage();

      // Transcribe the recorded audio
      const transcription = await window.electronAPI.audio.transcribeAudio(
        this.currentRecording.filePath,
        {
          language: currentLanguage,
          model: 'base'
        }
      );

      // Compare with all three candidate sentences
      const comparisons = await Promise.all(
        this.responseOptions.map(async (option) => {
          const comparison = await window.electronAPI.audio.compareTranscription(
            transcription.text,
            option.variantSentence
          );
          return {
            option,
            comparison
          };
        })
      );

      // Find the best match
      const bestMatch = comparisons.reduce((best, current) => {
        return current.comparison.similarity > best.comparison.similarity ? current : best;
      }, comparisons[0]);

      this.transcriptionResult = {
        text: transcription.text,
        ...bestMatch.comparison
      };
      this.selectedOption = bestMatch.option;

      // Record pronunciation attempt in database (tracks full history)
      if (this.currentSentence?.id) {
        try {
          await window.electronAPI.database.recordPronunciationAttempt(
            this.currentSentence.id,
            bestMatch.comparison.similarity,
            bestMatch.option.variantSentence, // Expected text (the variant that matched)
            transcription.text // Transcribed text
          );
        } catch (error) {
          console.warn('Failed to record pronunciation attempt:', error);
        }
      }

      // Store the recorded audio path for later playback
      if (this.currentRecording) {
        this.recordedAudioPath = this.currentRecording.filePath;
      }

      // If similarity is high enough (>= 0.75), mark as success and continue
      // (follow-up will be generated after transcription is marked as complete)
      if (bestMatch.comparison.similarity >= 0.75) {
        // Mark transcription as complete first
        this.isTranscribing = false;
        this.streamingTranscriptionText = null;
        
        // Then generate follow-up continuation
        await this.generateFollowUp();
      } else {
        // Similarity too low - mark transcription as complete
        this.isTranscribing = false;
        this.streamingTranscriptionText = null;
      }
      // If similarity is too low, show "Try Again" button next to the similarity badge
    } catch (error) {
      console.error('Speech recognition failed:', error);
      this.transcriptionResult = {
        text: 'Speech recognition failed. Please try again.',
        similarity: 0,
        normalizedTranscribed: '',
        normalizedExpected: '',
        expectedWords: [],
        transcribedWords: []
      };
      // Mark transcription as complete on error
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;
    }
  }

  private async generateFollowUp() {
    if (!this.selectedOption || this.isGeneratingFollowUp) {
      return;
    }

    try {
      this.isGeneratingFollowUp = true;
      // Use the selected variant's ID to get/cache continuation
      const followUp = await window.electronAPI.dialog.generateFollowUp(this.selectedOption.id);
      // Handle both string (legacy) and object formats
      if (typeof followUp === 'string') {
        this.followUpText = followUp;
        this.followUpTranslation = '';
        this.followUpAudio = null;
      } else {
        this.followUpText = followUp.text || '';
        this.followUpTranslation = followUp.translation || '';
        this.followUpAudio = followUp.audio || null;
      }
      this.showFollowUp = true;
      
      // Auto-play continuation audio if available
      if (this.followUpAudio) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.playFollowUpAudio();
          }, 300);
        });
      }
    } catch (error) {
      console.error('Failed to generate follow-up:', error);
      this.followUpText = '';
      this.followUpTranslation = '';
    } finally {
      this.isGeneratingFollowUp = false;
    }
  }

  private async nextDialog() {
    console.log('[DialogMode] nextDialog - user clicked next, consuming current session');
    // Consume the current dialog session (mark it as used and advance to next)
    const currentSession = sessionManager.getCurrentDialogSession();
    if (currentSession) {
      console.log('[DialogMode] nextDialog - consuming session', {
        sessionId: currentSession.id,
        sentenceId: currentSession.sentenceId
      });
    }
    sessionManager.consumeCurrentDialogSession();
    
    // Increment dialog count
    this.dialogCount++;
    
    // Check if we've completed 5 dialogs
    if (this.dialogCount >= 5) {
      // Dispatch event for autopilot to check scores after 5 dialogs are done
      window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
      // Reset counter for next batch
      this.dialogCount = 0;
    }
    
    // Load the next session from the queue
    await this.loadDialogSession();
    
    // Schedule a new dialog session to be generated asynchronously and added to the end of the queue
    setImmediate(() => {
      this.scheduleNewDialogSession().catch(error => {
        console.error('Failed to schedule new dialog session:', error);
        // Non-critical error - continue without new session
      });
    });
  }

  /**
   * Generate a new dialog session and add it to the end of the queue (FIFO)
   */
  private async scheduleNewDialogSession(): Promise<void> {
    try {
      const sessionData = await window.electronAPI.dialog.pregenerateSession();
      if (!sessionData) {
        console.log('No dialog session could be pre-generated for queue (no sentences available)');
        return;
      }

      // Convert response options dates from ISO strings back to Date objects
      const responseOptions = sessionData.responseOptions.map((v: {
        id: number;
        sentenceId: number;
        variantSentence: string;
        variantTranslation: string;
        createdAt: string;
      }) => ({
        id: v.id,
        sentenceId: v.sentenceId,
        variantSentence: v.variantSentence,
        variantTranslation: v.variantTranslation,
        createdAt: new Date(v.createdAt)
      }));

      // Create dialog session state
      const dialogSession: import('../utils/session-manager.js').DialogSessionState = {
        id: `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sentenceId: sessionData.sentenceId,
        sentence: sessionData.sentence,
        translation: sessionData.translation,
        contextBefore: sessionData.contextBefore,
        contextBeforeTranslation: sessionData.contextBeforeTranslation,
        beforeSentenceAudio: sessionData.beforeSentenceAudio,
        responseOptions: responseOptions.map((v: {
          id: number;
          sentenceId: number;
          variantSentence: string;
          variantTranslation: string;
          createdAt: Date;
        }) => ({
          id: v.id,
          sentenceId: v.sentenceId,
          variantSentence: v.variantSentence,
          variantTranslation: v.variantTranslation,
          createdAt: v.createdAt.toISOString()
        })),
        createdAt: new Date().toISOString()
      };

      // Add to the end of the queue (FIFO - removes oldest if queue is full)
      sessionManager.addDialogSession(dialogSession);
      console.log('New dialog session generated and added to queue:', {
        sessionId: dialogSession.id,
        sentenceId: dialogSession.sentenceId,
        variantsCount: dialogSession.responseOptions.length
      });
    } catch (error) {
      console.error('Failed to schedule new dialog session:', error);
      // Non-critical error - don't throw
    }
  }

  private getSimilarityClass(similarity: number): string {
    if (similarity >= 0.95) return 'excellent';
    if (similarity >= 0.85) return 'good';
    if (similarity >= 0.75) return 'fair';
    return 'poor';
  }

  private renderRecordingSection() {
    if (!this.responseOptions.length) return '';

    // Only show if actively recording or transcribing
    if (!this.isRecording && !this.isTranscribing) {
      return '';
    }

    return html`
      <div class="recording-section">
        ${this.isRecording ? this.renderRecordingStatus() : ''}
      </div>
    `;
  }

  private renderRecordingStatus() {
    const minutes = Math.floor(this.recordingTime / 60);
    const seconds = this.recordingTime % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return html`
      <div class="recording-status-container">
        <div class="recording-status">
          <div class="recording-indicator">
            <div class="recording-dot"></div>
            Recording... (auto-stop enabled)
          </div>
          <div class="recording-time">${formattedTime}</div>
          <button 
            class="cancel-recording-button"
            @click=${this.cancelRecording}
            title="Cancel recording"
          >
            ✕ Cancel
          </button>
        </div>
      </div>
    `;
  }

  private renderTranscribingStatus() {
    return html`
      <div class="recording-status-container">
        <div class="recording-status">
          <div class="transcribing-indicator">
            <div class="spinner"></div>
            Transcribing...
          </div>
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .dialog-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        gap: var(--spacing-lg);
        max-width: 800px;
        margin: 0 auto;
      }

      .control-bar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        width: 100%;
        max-width: 600px;
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--background-primary);
        border-bottom: 1px solid var(--border-color);
        margin-bottom: var(--spacing-md);
      }

      .dialog-bubbles {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
      }

      .dialog-bubble {
        padding: var(--spacing-md) var(--spacing-lg);
        border-radius: 18px;
        max-width: 75%;
        position: relative;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .bubble-left {
        align-self: flex-start;
        background: var(--background-secondary);
        border-top-left-radius: 4px;
      }

      .bubble-right {
        align-self: flex-end;
        background: var(--primary-color);
        color: white;
        border-top-right-radius: 4px;
      }

      .bubble-content {
        flex: 1;
      }

      .bubble-text-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .bubble-text {
        font-size: 16px;
        margin: 0;
        line-height: 1.5;
        flex: 1;
      }

      .similarity-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        min-width: 45px;
        white-space: nowrap;
      }

      .similarity-badge.excellent {
        background: var(--success-light);
        color: var(--success-color);
      }

      .similarity-badge.good {
        background: #d4edda;
        color: #28a745;
      }

      .similarity-badge.fair {
        background: #fff3cd;
        color: #856404;
      }

      .similarity-badge.poor {
        background: var(--error-light);
        color: var(--error-color);
      }

      .bubble-right .similarity-badge {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }

      .bubble-right .similarity-badge.excellent {
        background: rgba(52, 199, 89, 0.3);
        color: white;
      }

      .bubble-right .similarity-badge.good {
        background: rgba(40, 167, 69, 0.3);
        color: white;
      }

      .bubble-right .similarity-badge.fair {
        background: rgba(255, 193, 7, 0.3);
        color: white;
      }

      .bubble-right .similarity-badge.poor {
        background: rgba(255, 59, 48, 0.3);
        color: white;
      }

      .try-again-button {
        font-size: 14px;
        padding: var(--spacing-sm) var(--spacing-md);
      }

      .bubble-right .bubble-text {
        color: white;
      }

      .bubble-translation {
        font-size: 14px;
        margin: var(--spacing-xs) 0 0 0;
        opacity: 0.8;
        font-style: italic;
      }

      .bubble-right .bubble-translation {
        color: rgba(255, 255, 255, 0.9);
      }

      .response-options {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        width: 100%;
        max-width: 600px;
        margin: var(--spacing-md) auto 0;
      }

      .response-option {
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: default;
        transition: all 0.2s ease;
        border-radius: var(--border-radius-small);
        border: 1px solid #ccc;
        background: var(--background-primary);
      }

      .response-option .sentence {
        font-size: 18px;
        margin: 0 0 var(--spacing-xs) 0;
      }

      .response-option .translation {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .recording-section {
        margin-top: var(--spacing-md);
        margin-bottom: var(--spacing-lg);
      }

      .recording-status-container {
        padding: var(--spacing-md);
        background: var(--background-primary);
        border-radius: var(--border-radius);
        border: 2px solid var(--error-color);
        margin-bottom: var(--spacing-md);
      }

      .recording-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .recording-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: 14px;
        color: var(--error-color);
        font-weight: 500;
      }

      .recording-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--error-color);
        animation: pulse 1.5s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .recording-time {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }

      .cancel-recording-button {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--border-color);
        background: var(--background-secondary);
        color: var(--text-primary);
        border-radius: var(--border-radius);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: var(--spacing-xs);
      }

      .cancel-recording-button:hover {
        background: var(--error-light);
        border-color: var(--error-color);
        color: var(--error-color);
      }

      .transcribing-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 14px;
        color: var(--text-primary);
      }

      .transcription-results {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--background-primary);
        border-radius: var(--border-radius);
        border: 1px solid var(--border-color);
      }

      .transcription-header {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: var(--spacing-md);
        text-align: center;
      }

      .transcription-loading {
        text-align: center;
        padding: var(--spacing-lg);
      }

      .streaming-transcription {
        margin-top: var(--spacing-md);
      }

      .transcription-text {
        margin: var(--spacing-md) 0;
      }

      .transcription-text .label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-xs);
      }

      .transcription-text .text {
        font-size: 16px;
        color: var(--text-primary);
      }

      .color-coded-text {
        line-height: 1.6;
      }

      .similarity-score {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin: var(--spacing-md) 0;
        font-size: 14px;
      }

      .similarity-bar {
        flex: 1;
        height: 20px;
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        overflow: hidden;
        border: 1px solid var(--border-color);
      }

      .similarity-fill {
        height: 100%;
        transition: width 0.3s ease;
      }

      .similarity-fill.excellent {
        background: var(--success-color);
      }

      .similarity-fill.good {
        background: #28a745;
      }

      .similarity-fill.fair {
        background: #ffc107;
      }

      .similarity-fill.poor {
        background: var(--error-color);
      }

      .similarity-percentage {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        min-width: 45px;
      }

      .pronunciation-feedback {
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius-small);
        text-align: center;
        font-weight: 500;
        margin-top: var(--spacing-md);
      }

      .pronunciation-feedback.excellent {
        background: var(--success-light);
        color: var(--success-color);
      }

      .pronunciation-feedback.good {
        background: #d4edda;
        color: #28a745;
      }

      .pronunciation-feedback.fair {
        background: #fff3cd;
        color: #856404;
      }

      .pronunciation-feedback.poor {
        background: var(--error-light);
        color: var(--error-color);
      }

      .record-button {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-xs) var(--spacing-sm);
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 16px;
        color: var(--text-primary);
      }

      .record-button:hover {
        background: var(--primary-light);
        border-color: var(--primary-color);
      }

      .record-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .record-button.recording {
        background: var(--error-light);
        border-color: var(--error-color);
        color: var(--error-color);
      }

      .record-button.recording:hover {
        background: var(--error-color);
        color: white;
      }

      .audio-replay-button {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .audio-replay-button:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: var(--primary-light);
      }

      .audio-replay-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .toggle-button {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-xs);
        margin-left: auto;
      }

      .toggle-button:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: var(--primary-light);
      }

      .toggle-label {
        font-size: 11px;
        font-weight: 500;
      }


      .loading {
        text-align: center;
        padding: var(--spacing-xl);
      }
    `
  ];

  render() {
    if (this.error) {
      return html`
        <div class="dialog-container">
          <div class="error-message">
            <p>${this.error}</p>
          </div>
        </div>
      `;
    }

    if (this.isLoading || !this.currentSentence) {
      return html`
        <div class="dialog-container">
          <div class="loading">
            <div class="spinner"></div>
            <p>Loading dialog session...</p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="dialog-container">
        <div class="control-bar">
          ${this.beforeSentenceAudio ? html`
            <button 
              class="audio-replay-button" 
              @click=${this.playBeforeSentence}
              ?disabled=${this.isRecording}
              title="Replay trigger audio"
              aria-label="Replay trigger audio"
            >
              <span aria-hidden="true">🔊</span>
            </button>
          ` : nothing}
          ${this.responseOptions.length > 0 && !this.transcriptionResult ? html`
            ${this.isRecording ? html`
              <button 
                class="record-button recording"
                @click=${this.stopRecording}
                title="Stop recording"
                aria-label="Stop recording"
              >
                <span aria-hidden="true">⏹</span>
              </button>
            ` : html`
              <button 
                class="record-button"
                @click=${this.startRecording}
                ?disabled=${!this.speechRecognitionReady}
                title=${this.speechRecognitionReady ? 'Start recording' : 'Speech recognition not ready'}
                aria-label="Start recording"
              >
                <span aria-hidden="true">🎤</span>
              </button>
            `}
          ` : nothing}
          <button 
            class="toggle-button"
            @click=${() => { this.showTranslations = !this.showTranslations; }}
            title=${this.showTranslations ? 'Hide translations' : 'Show translations'}
            aria-label=${this.showTranslations ? 'Hide translations' : 'Show translations'}
          >
            <span aria-hidden="true">${this.showTranslations ? '👁' : '👁‍🗨'}</span>
            <span class="toggle-label">${this.showTranslations ? 'Hide EN' : 'Show EN'}</span>
          </button>
        </div>

        <div class="dialog-bubbles">
          ${this.currentSentence.contextBefore ? html`
            <div class="dialog-bubble bubble-left">
              <div class="bubble-content">
                <p class="bubble-text">${this.currentSentence.contextBefore}</p>
                ${this.showTranslations && this.currentSentence.contextBeforeTranslation ? html`
                  <p class="bubble-translation">${this.currentSentence.contextBeforeTranslation}</p>
                ` : nothing}
              </div>
            </div>
          ` : nothing}

          ${this.transcriptionResult && this.selectedOption ? html`
            <div class="dialog-bubble bubble-right">
              <div class="bubble-content">
                <div class="bubble-text-container">
                  <p class="bubble-text">${this.selectedOption.variantSentence}</p>
                  ${this.transcriptionResult ? html`
                    <span class="similarity-badge ${this.getSimilarityClass(this.transcriptionResult.similarity)}">
                      ${Math.round(this.transcriptionResult.similarity * 100)}%
                    </span>
                  ` : nothing}
                </div>
                ${this.showTranslations ? html`
                  <p class="bubble-translation">${this.selectedOption.variantTranslation}</p>
                ` : nothing}
                ${this.transcriptionResult.similarity < 0.75 ? html`
                  <button 
                    class="btn btn-primary try-again-button"
                    @click=${this.startRecording}
                    style="margin-top: var(--spacing-sm); width: 100%;"
                  >
                    Try Again
                  </button>
                ` : nothing}
              </div>
            </div>
          ` : this.responseOptions.length > 0 && !this.transcriptionResult ? html`
            <div class="response-options">
              ${this.responseOptions.map((option, index) => html`
                <div class="response-option">
                  <p class="sentence">${option.variantSentence}</p>
                  ${this.showTranslations ? html`
                    <p class="translation">${option.variantTranslation}</p>
                  ` : nothing}
                </div>
            `)}
          </div>
        ` : nothing}

          ${this.showFollowUp && this.followUpText ? html`
            <div class="dialog-bubble bubble-left">
              <div class="bubble-content">
                <p class="bubble-text">${this.followUpText}</p>
                ${this.showTranslations && this.followUpTranslation ? html`
                  <p class="bubble-translation">${this.followUpTranslation}</p>
                ` : nothing}
              </div>
            </div>
          ` : nothing}
        </div>

        ${this.renderRecordingSection()}

        ${this.isGeneratingFollowUp && !this.isTranscribing ? html`
          <div class="loading">
            <div class="spinner"></div>
            <p>Generating follow-up...</p>
          </div>
        ` : nothing}
        ${!this.isGeneratingFollowUp ? html`
          <button 
            class="btn btn-primary"
            @click=${this.nextDialog}
            ?disabled=${this.isRecording || this.isTranscribing}
            style="margin-top: var(--spacing-md);"
            title=${this.isRecording || this.isTranscribing ? 'Wait for recording/transcription to finish' : 'Skip to next dialog'}
          >
            Next Dialog
          </button>
        ` : nothing}
      </div>
    `;
  }
}

