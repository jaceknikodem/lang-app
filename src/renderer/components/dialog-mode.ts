/**
 * Dialog mode component for conversational practice
 */

import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Sentence, DialogueVariant, TranscriptionAnalysis } from '../../shared/types/core.js';
import { sharedStyles } from '../styles/shared.js';
import { useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import { sessionManager } from '../utils/session-manager.js';
import { router } from '../utils/router.js';
import type { RecordingOptions, RecordingSession } from '../../shared/types/audio.js';
import { checkProficiencyLevel } from '../utils/app-initializer.js';
import {
  getSimilarityThresholds,
  getSimilarityClass,
  type ProficiencyLevel,
} from '../../shared/utils/similarity-threshold.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { BaseComponent } from './base-component.js';
import { logger } from '../utils/logger.js';

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
export class DialogMode extends BaseComponent {
  @state()
  private currentSentence: Sentence | null = null;

  @state()
  private beforeSentenceAudio: string | null = null;

  @state()
  private afterSentenceAudio: string | null = null;

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

  @state()
  private autoplayEnabled = false;

  @state()
  private isAudioPlaying = false;

  @state()
  private isTopicBasedFlow = false;

  @state()
  private transcriptionAnalysis: TranscriptionAnalysis | null = null;

  @state()
  private relatedWords: string[] = [];

  private recordingTimer: number | null = null;
  private recordingStatusCheckTimer: number | null = null;
  private speechRecognitionCheckTimer: number | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private transcriptionProgressUnsubscribe: (() => void) | null = null;
  private keyboardUnsubscribe?: () => void;
  private currentProficiencyLevel: ProficiencyLevel | null = null;
  private dialogCount = 0; // Track number of dialogs completed in this session
  private currentSessionId: number | undefined;

  protected override handleExternalLanguageChange = async (event: Event): Promise<void> => {
    // Call base class handler first
    await super.handleExternalLanguageChange(event);

    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    // Load proficiency level for the new language
    const proficiency = await checkProficiencyLevel(newLanguage);
    this.currentProficiencyLevel = proficiency as ProficiencyLevel | null;

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

    // Load current language and proficiency level, and create dialog session for tracking
    window.electronAPI.database
      .getCurrentLanguage()
      .then(async (language) => {
        this.currentLanguage = language;
        const proficiency = await checkProficiencyLevel(language);
        this.currentProficiencyLevel = proficiency as ProficiencyLevel | null;

        // Create dialog session for tracking
        try {
          this.currentSessionId = await window.electronAPI.tracking.createSession(
            'dialog',
            language
          );
        } catch (error) {
          logger.warn({ error }, 'Failed to create dialog session');
        }
      })
      .catch((err) => {
        logger.error({ error: err }, 'Failed to load current language');
      });

    this.loadDialogSession();
    this.checkSpeechRecognitionReady();
    this.loadAutoplaySetting();

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
      this.cancelRecording().catch((err) => {
        logger.error({ error: err }, 'Error cancelling recording on disconnect');
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
      this.transcriptionAnalysis = null;
      this.relatedWords = [];
      this.recordedAudioPath = null;

      // Check for cached dialog session first
      const cachedSession = sessionManager.getCurrentDialogSession();
      if (cachedSession) {
        console.log('[DialogMode] loadDialogSession - using cached session from session manager', {
          sessionId: cachedSession.id,
          sentenceId: cachedSession.sentenceId,
          responseOptionsCount: cachedSession.responseOptions.length,
        });

        // Reload autoplay setting to ensure it's up-to-date
        await this.loadAutoplaySetting();

        // Get current language to verify cached session is for the correct language
        const currentLanguage = await window.electronAPI.database.getCurrentLanguage();

        // Load from cache
        try {
          const sentences = await window.electronAPI.database.getSentencesByIds([
            cachedSession.sentenceId,
          ]);
          const sentence = sentences && sentences.length > 0 ? sentences[0] : null;

          if (!sentence) {
            console.log(
              '[DialogMode] loadDialogSession - cached session sentence not found in DB, discarding session',
              {
                sessionId: cachedSession.id,
                cachedSentenceId: cachedSession.sentenceId,
              }
            );
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
                responseOptionsCount: cachedSession.responseOptions.length,
              });
              this.currentSentence = sentence;
              this.beforeSentenceAudio = cachedSession.beforeSentenceAudio || null;
              this.afterSentenceAudio = cachedSession.afterSentenceAudio || null;

              // Convert cached response options back to DialogueVariant format
              this.responseOptions = cachedSession.responseOptions.map((v) => ({
                id: v.id,
                sentenceId: v.sentenceId,
                variantSentence: v.variantSentence,
                variantTranslation: v.variantTranslation,
                createdAt: new Date(v.createdAt),
              }));

              // Don't consume yet - will be consumed when user completes the dialog (in nextDialog)
              // This allows the session to persist if the user navigates away and comes back

              this.isLoading = false;

              // Auto-play trigger audio if available and autoplay is enabled
              if (this.beforeSentenceAudio && this.autoplayEnabled) {
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    this.playBeforeSentence();
                  }, 300);
                });
              }
              return;
            } else {
              // Language mismatch - discard cached session
              console.log(
                '[DialogMode] loadDialogSession - language mismatch, discarding cached session',
                {
                  sessionId: cachedSession.id,
                  sentenceId: sentence.id,
                  wordLanguage: word?.language || 'NOT_FOUND',
                  currentLanguage: currentLanguage,
                }
              );
              sessionManager.consumeCurrentDialogSession();
            }
          }
        } catch (error) {
          logger.error(
            {
              error,
              sessionId: cachedSession.id,
              cachedSentenceId: cachedSession.sentenceId,
            },
            '[DialogMode] loadDialogSession - error during validation'
          );
          sessionManager.consumeCurrentDialogSession();
        }
      }

      // No cached session - generate new one
      console.log('[DialogMode] loadDialogSession - no cached session, generating new');

      // Reload autoplay setting to ensure it's up-to-date
      await this.loadAutoplaySetting();

      // Randomly choose between old flow (variants) and new flow (topic-based/open-ended)
      this.isTopicBasedFlow = Math.random() < 0.5;

      let sentence: Sentence | null = null;

      if (this.isTopicBasedFlow) {
        // Step 1: Select a sentence with a topic
        sentence = await window.electronAPI.dialog.selectSentenceWithTopic();
      } else {
        // Step 1: Select a sentence with high word strengths (old flow)
        sentence = await window.electronAPI.dialog.selectSentence();
      }

      if (!sentence) {
        console.log('[DialogMode] loadDialogSession - no sentence available');
        this.error = 'No sentences available for dialog practice. Please learn more words first.';
        this.isLoading = false;
        // Show a retry button
        return;
      }

      console.log('[DialogMode] loadDialogSession - selected new sentence', {
        sentenceId: sentence.id,
        wordId: sentence.wordId,
      });
      this.currentSentence = sentence;

      // Step 2: Prepare context sentences audio (beforeSentence and afterSentence)
      try {
        const contextAudio = await window.electronAPI.dialog.ensureContextSentences(sentence.id);
        this.beforeSentenceAudio = contextAudio.beforeSentenceAudio || null;
        this.afterSentenceAudio = contextAudio.afterSentenceAudio || null;
      } catch (error) {
        logger.warn({ error }, 'Failed to generate context sentences audio');
        this.beforeSentenceAudio = null;
        this.afterSentenceAudio = null;
      }

      // Step 3: Generate response options or related words based on flow type
      if (this.isTopicBasedFlow) {
        // Topic-based flow: Generate related words
        // First check if sentence already has related words cached
        if (sentence.relatedWords && sentence.relatedWords.length > 0) {
          this.relatedWords = sentence.relatedWords;
          console.log('[DialogMode] loadDialogSession - using cached related words', {
            count: this.relatedWords.length,
          });
        } else {
          // Generate and cache related words
          try {
            // Get topic from sentence's word
            const word = await window.electronAPI.database.getWordById(sentence.wordId);
            if (word?.topic) {
              console.log('[DialogMode] loadDialogSession - generating related words', {
                sentenceId: sentence.id,
                topic: word.topic,
              });
              const relatedWords = await window.electronAPI.dialog.generateRelatedWords(
                sentence.id,
                word.topic
              );
              this.relatedWords = relatedWords || [];
              console.log('[DialogMode] loadDialogSession - related words generated', {
                count: this.relatedWords.length,
              });
            }
          } catch (error) {
            logger.warn({ error }, 'Failed to generate related words');
            this.relatedWords = [];
          }
        }
        // No variants for topic-based flow
        this.responseOptions = [];
      } else {
        // Old flow: Generate variants
        try {
          console.log('[DialogMode] loadDialogSession - generating variants', {
            sentenceId: sentence.id,
          });
          const variants = await window.electronAPI.dialog.generateVariants(sentence.id);

          console.log('[DialogMode] loadDialogSession - variants generated', {
            sentenceId: sentence.id,
            variantsCount: variants.length,
            variantIds: variants.map((v) => v.id),
          });

          // Create a pseudo-variant for the original sentence (using negative ID to indicate it's the original)
          const originalVariant: DialogueVariant = {
            id: -sentence.id, // Negative ID to indicate it's the original sentence
            sentenceId: sentence.id,
            variantSentence: sentence.sentence,
            variantTranslation: sentence.translation,
            createdAt: new Date(),
          };

          // Combine target sentence with variants
          this.responseOptions = [
            originalVariant,
            ...variants.slice(0, 2), // Take up to 2 variants
          ];

          // Shuffle options so target isn't always first
          this.responseOptions.sort(() => Math.random() - 0.5);
        } catch (error) {
          logger.error({ error }, 'Failed to generate variants');
          // Fallback: use only the target sentence
          this.responseOptions = [
            {
              id: -sentence.id,
              sentenceId: sentence.id,
              variantSentence: sentence.sentence,
              variantTranslation: sentence.translation,
              createdAt: new Date(),
            },
          ];
        }
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
            contextAfter: sentence.contextAfter,
            contextAfterTranslation: sentence.contextAfterTranslation,
            beforeSentenceAudio: this.beforeSentenceAudio || undefined,
            afterSentenceAudio: this.afterSentenceAudio || undefined,
            responseOptions: this.responseOptions.map((v) => ({
              id: v.id,
              sentenceId: v.sentenceId,
              variantSentence: v.variantSentence,
              variantTranslation: v.variantTranslation,
              createdAt: v.createdAt.toISOString(),
            })),
            createdAt: new Date().toISOString(),
          };

          // Add to cache (will set currentDialogIndex if it's the first session)
          sessionManager.addDialogSession(dialogSession);
        } catch (error) {
          logger.error(
            { error },
            '[DialogMode] loadDialogSession - failed to save session to cache'
          );
        }
      }

      // Auto-play trigger audio if available and autoplay is enabled (after component updates)
      if (this.beforeSentenceAudio && this.autoplayEnabled) {
        // Use requestAnimationFrame to ensure component has rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.playBeforeSentence();
          }, 300);
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load dialog session');
      this.error = getErrorMessage(error, 'Failed to load dialog session');
      this.isLoading = false;
    }
  }

  private async checkSpeechRecognitionReady() {
    try {
      this.speechRecognitionReady = await window.electronAPI.audio.isSpeechRecognitionReady();
    } catch (error) {
      logger.error({ error }, 'Failed to check speech recognition readiness');
      this.speechRecognitionReady = false;
    }
  }

  private async loadAutoplaySetting() {
    try {
      const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
      this.autoplayEnabled = autoplaySetting === 'true';
    } catch (error) {
      logger.error({ error }, 'Failed to load autoplay setting');
      this.autoplayEnabled = false;
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
          await new Promise((resolve) => setTimeout(resolve, 200));
          await window.electronAPI.audio.stopAudio(); // Stop again to catch any late-starting audio
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch {
          // Ignore errors when stopping (might not be playing)
        }

        // Play trigger audio and wait for it to complete
        if (this.beforeSentenceAudio) {
          try {
            logger.debug(
              { audioPath: this.beforeSentenceAudio },
              '[DialogMode] Playing trigger audio'
            );
            await window.electronAPI.audio.playAudio(this.beforeSentenceAudio);
            logger.debug('[DialogMode] Trigger audio finished');

            // Track sentence play count
            if (this.currentSentence?.id) {
              void window.electronAPI.database
                .incrementSentencePlayCount(this.currentSentence.id)
                .catch((err) => {
                  logger.warn({ error: err }, 'Failed to increment sentence play count');
                });
            }
            // Track audio playback event
            if (this.currentSentence?.id && this.currentLanguage) {
              void window.electronAPI.tracking
                .recordAudioPlayback({
                  sessionId: this.currentSessionId,
                  sentenceId: this.currentSentence.id,
                  audioPath: this.beforeSentenceAudio,
                  language: this.currentLanguage,
                  mode: 'dialog',
                  playbackSpeed: 1.0, // Dialog mode doesn't have playback speed control
                })
                .catch((err: unknown) => {
                  logger.warn({ error: err }, 'Failed to record audio playback');
                });
            }
          } catch (error) {
            logger.error({ error }, 'Failed to play trigger audio');
            // Continue with next audio even if this one fails
          }
        }

        // Play user's recording (normalized for better volume) and wait for it to complete
        if (this.recordedAudioPath) {
          try {
            // Normalize/amplify the recording for better playback volume (5dB amplification)
            const normalizedPath = await window.electronAPI.audio.normalizeAudioVolume(
              this.recordedAudioPath,
              5
            );
            const audioPathToPlay = normalizedPath || this.recordedAudioPath;

            logger.debug({ audioPath: audioPathToPlay }, '[DialogMode] Playing user recording');
            await window.electronAPI.audio.playAudio(audioPathToPlay);
            logger.debug('[DialogMode] User recording finished');
          } catch (error) {
            logger.error({ error }, 'Failed to play user recording');
            // Continue with next audio even if this one fails
          }
        }

        // Play continuation audio and wait for it to complete
        if (this.followUpAudio) {
          try {
            logger.debug(
              { audioPath: this.followUpAudio },
              '[DialogMode] Playing continuation audio'
            );
            await window.electronAPI.audio.playAudio(this.followUpAudio);
            logger.debug('[DialogMode] Continuation audio finished');
          } catch (error) {
            logger.error({ error }, 'Failed to play continuation audio');
          }
        }

        // Play afterSentence audio if available
        if (this.afterSentenceAudio) {
          try {
            logger.debug(
              { audioPath: this.afterSentenceAudio },
              '[DialogMode] Playing afterSentence audio'
            );
            await window.electronAPI.audio.playAudio(this.afterSentenceAudio);
            logger.debug('[DialogMode] AfterSentence audio finished');
          } catch (error) {
            logger.error({ error }, 'Failed to play afterSentence audio');
          }
        }
      } catch (error) {
        logger.error({ error }, 'Failed to play dialog sequence');
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

      this.isAudioPlaying = true;
      // Play the trigger audio
      await window.electronAPI.audio.playAudio(this.beforeSentenceAudio);
      this.isAudioPlaying = false; // Reset when audio finishes

      // Track sentence play count
      if (this.currentSentence?.id) {
        void window.electronAPI.database
          .incrementSentencePlayCount(this.currentSentence.id)
          .catch((err) => {
            logger.warn({ error: err }, 'Failed to increment sentence play count');
          });
      }
      // Track audio playback event
      if (this.currentSentence?.id && this.currentLanguage) {
        void window.electronAPI.tracking
          .recordAudioPlayback({
            sessionId: this.currentSessionId,
            sentenceId: this.currentSentence.id,
            audioPath: this.beforeSentenceAudio,
            language: this.currentLanguage,
            mode: 'dialog',
            playbackSpeed: 1.0, // Dialog mode doesn't have playback speed control
          })
          .catch((err: unknown) => {
            logger.warn({ error: err }, 'Failed to record audio playback');
          });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to play before sentence audio');
      this.isAudioPlaying = false;
    }
  }

  private async playAfterSentence() {
    if (!this.afterSentenceAudio) {
      return;
    }

    try {
      // Stop any currently playing audio
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }

      this.isAudioPlaying = true;
      // Play the afterSentence audio
      await window.electronAPI.audio.playAudio(this.afterSentenceAudio);
      this.isAudioPlaying = false; // Reset when audio finishes

      // Track sentence play count
      if (this.currentSentence?.id) {
        void window.electronAPI.database
          .incrementSentencePlayCount(this.currentSentence.id)
          .catch((err) => {
            logger.warn({ error: err }, 'Failed to increment sentence play count');
          });
      }
      // Track audio playback event
      if (this.currentSentence?.id && this.currentLanguage) {
        void window.electronAPI.tracking
          .recordAudioPlayback({
            sessionId: this.currentSessionId,
            sentenceId: this.currentSentence.id,
            audioPath: this.afterSentenceAudio,
            language: this.currentLanguage,
            mode: 'dialog',
            playbackSpeed: 1.0, // Dialog mode doesn't have playback speed control
          })
          .catch((err: unknown) => {
            logger.warn({ error: err }, 'Failed to record audio playback');
          });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to play after sentence audio');
      this.isAudioPlaying = false;
    }
  }

  private async playFollowUpAudio() {
    if (!this.followUpAudio) {
      return;
    }

    try {
      this.isAudioPlaying = true;
      // Stop any currently playing audio
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }

      // Play the audio
      await window.electronAPI.audio.playAudio(this.followUpAudio);
      this.isAudioPlaying = false; // Reset when audio finishes
    } catch (error) {
      logger.error({ error }, 'Failed to play follow-up audio');
      this.isAudioPlaying = false;
    }
  }

  private async playAssistantAudio(audioPath: string) {
    if (!audioPath) {
      return;
    }

    try {
      this.isAudioPlaying = true;
      // Stop any currently playing audio
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }

      // Play the audio
      await window.electronAPI.audio.playAudio(audioPath);
      this.isAudioPlaying = false; // Reset when audio finishes
    } catch (error) {
      logger.error({ error }, 'Failed to play assistant audio');
      this.isAudioPlaying = false;
    }
  }

  private async playLatestAssistantAudio() {
    // Always prioritize the most recent assistant audio
    // 1. Check for current follow-up audio (most recent)
    if (this.followUpAudio) {
      await this.playFollowUpAudio();
      return;
    }

    // 2. Fallback to before sentence audio (initial trigger)
    if (this.beforeSentenceAudio) {
      await this.playBeforeSentence();
    }
  }

  private setupKeyboardBindings() {
    const bindings = [
      // Recording
      {
        ...GlobalShortcuts.RECORD_PRONUNCIATION,
        action: () => this.toggleRecording(),
        context: 'dialog',
        description: 'Toggle pronunciation recorder',
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
        description: 'Play trigger audio',
      },
      // Toggle translation visibility
      {
        ...GlobalShortcuts.TOGGLE_AUDIO_ONLY,
        action: () => {
          this.showTranslations = !this.showTranslations;
        },
        context: 'dialog',
        description: 'Toggle English translation visibility',
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
        description: 'Next dialog',
      },
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private async toggleRecording() {
    if (this.isRecording) {
      // When stopping, we don't need to check speechRecognitionReady or responseOptions
      await this.stopRecording();
    } else {
      // When starting, check prerequisites
      if (
        !this.speechRecognitionReady ||
        (!this.isTopicBasedFlow && !this.responseOptions.length)
      ) {
        return;
      }
      await this.startRecording();
    }
  }

  private async startRecording() {
    if (
      this.isRecording ||
      !this.speechRecognitionReady ||
      (!this.isTopicBasedFlow && !this.responseOptions.length)
    ) {
      return;
    }

    // Reset audio playing state when starting recording
    this.isAudioPlaying = false;

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
        endOnSilence: true,
      };

      await window.electronAPI.audio.startRecording(recordingOptions);
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
      logger.error({ error }, 'Error starting recording');
      this.isRecording = false;
      this.error = `Failed to start recording: ${getErrorMessage(error)}`;
    }
  }

  private async stopRecording() {
    if (!this.isRecording) {
      logger.debug('[DialogMode] stopRecording - not recording, returning');
      return;
    }

    try {
      const completedSession = await window.electronAPI.audio.stopRecording();

      // Handle case where stopRecording returns null (no recording was in progress)
      if (!completedSession) {
        logger.warn('[DialogMode] stopRecording - no recording session returned');
        this.isRecording = false;
        this.clearRecordingTimer();
        this.clearRecordingStatusCheck();
        return;
      }
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
        const duration =
          completedSession.duration || (Date.now() - completedSession.startTime) / 1000;

        logger.debug('[DialogMode] stopRecording - recording completed', {
          filePath,
          duration: duration.toFixed(2),
          isTopicBasedFlow: this.isTopicBasedFlow,
        });

        this.currentRecording = {
          session: completedSession,
          filePath,
          duration,
        };

        // Automatically perform speech recognition
        await this.performSpeechRecognition();
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping recording');
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      // Hide transcribing box on error too
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;
      this.error = `Failed to stop recording: ${getErrorMessage(error)}`;
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
      logger.error({ error }, 'Error cancelling recording');
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
          logger.error({ error }, 'Error checking recording status');
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
        const duration =
          completedSession.duration || (Date.now() - completedSession.startTime) / 1000;

        this.currentRecording = {
          session: completedSession,
          filePath,
          duration,
        };

        // Automatically perform speech recognition
        await this.performSpeechRecognition();
      }
    } catch (error) {
      logger.error({ error }, 'Error handling auto-stop');
      this.error = 'Recording stopped automatically but there was an error processing it.';
      this.isRecording = false;
    }
  }

  private async performSpeechRecognition() {
    if (
      !this.currentRecording ||
      (!this.isTopicBasedFlow && !this.responseOptions.length) ||
      !this.speechRecognitionReady
    ) {
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
        }
      );

      // Compare with response options (only for old flow with variants)
      if (this.isTopicBasedFlow) {
        // Topic-based flow: No variants, just use the transcription
        this.transcriptionResult = {
          text: transcription.text,
          similarity: 1.0, // No comparison for topic-based flow
          normalizedTranscribed: transcription.text.toLowerCase(),
          normalizedExpected: this.currentSentence?.sentence.toLowerCase() || '',
          expectedWords: [],
          transcribedWords: [],
        };
        this.selectedOption = null;
      } else {
        // Old flow: Compare with response options
        // Compare with all three candidate sentences
        const comparisons = await Promise.all(
          this.responseOptions.map(async (option) => {
            const comparison = await window.electronAPI.audio.compareTranscription(
              transcription.text,
              option.variantSentence,
              this.currentProficiencyLevel
            );
            return {
              option,
              comparison,
            };
          })
        );

        // Find the best match
        const bestMatch = comparisons.reduce((best, current) => {
          return current.comparison.similarity > best.comparison.similarity ? current : best;
        }, comparisons[0]);

        this.transcriptionResult = {
          text: transcription.text,
          ...bestMatch.comparison,
        };
        this.selectedOption = bestMatch.option;
      }

      // Store the recorded audio path for later playback
      if (this.currentRecording) {
        this.recordedAudioPath = this.currentRecording.filePath;
      }

      // Mark transcription as complete
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;

      // Record pronunciation attempt in database (tracks full history)
      if (this.currentSentence?.id && !this.isTopicBasedFlow && this.selectedOption) {
        try {
          await window.electronAPI.database.recordPronunciationAttempt(
            this.currentSentence.id,
            this.transcriptionResult.similarity,
            this.selectedOption.variantSentence, // Expected text (the variant that matched)
            transcription.text, // Transcribed text
            this.currentRecording?.filePath || null // Audio path
          );
        } catch (error) {
          logger.warn({ error }, 'Failed to record pronunciation attempt');
        }
      }

      // For topic-based flow, run transcription analysis and follow-up generation in parallel
      if (this.isTopicBasedFlow) {
        const currentLanguage = await window.electronAPI.database.getCurrentLanguage();
        const assistantSentence = this.currentSentence?.sentence;

        // Start both LLM queries in parallel
        const [transcriptionAnalysisResult, followUpResult] = await Promise.allSettled([
          // Transcription analysis
          assistantSentence
            ? window.electronAPI.dialog.analyzeTranscription(
                transcription.text,
                currentLanguage,
                assistantSentence
              )
            : Promise.resolve(null),
          // Follow-up generation
          this.generateFollowUp(),
        ]);

        // Handle transcription analysis result
        if (transcriptionAnalysisResult.status === 'fulfilled') {
          this.transcriptionAnalysis = transcriptionAnalysisResult.value;
        } else {
          logger.warn(
            { error: transcriptionAnalysisResult.reason },
            'Failed to analyze transcription'
          );
          this.transcriptionAnalysis = null;
        }

        // Follow-up generation handles its own errors internally
        if (followUpResult.status === 'rejected') {
          logger.warn({ error: followUpResult.reason }, 'Failed to generate follow-up');
        }
      } else {
        // For old flow, clear transcription analysis
        this.transcriptionAnalysis = null;

        // Old flow: Only generate follow-up if similarity is high enough
        const thresholds = getSimilarityThresholds(this.currentProficiencyLevel);
        if (this.transcriptionResult.similarity >= thresholds.successThreshold) {
          await this.generateFollowUp();
        }
      }
      // If similarity is too low, show "Try Again" button next to the similarity badge
    } catch (error) {
      logger.error({ error }, 'Speech recognition failed');
      this.transcriptionResult = {
        text: 'Speech recognition failed. Please try again.',
        similarity: 0,
        normalizedTranscribed: '',
        normalizedExpected: '',
        expectedWords: [],
        transcribedWords: [],
      };
      // Mark transcription as complete on error
      this.isTranscribing = false;
      this.streamingTranscriptionText = null;
    }
  }

  /**
   * Parse sentence text into words while preserving punctuation and whitespace
   */
  private parseSentenceWords(
    text: string
  ): Array<{ word: string; normalized: string; trailing: string; leading: string }> {
    // Match words (Unicode letters and numbers) and capture surrounding whitespace/punctuation
    const words: Array<{ word: string; normalized: string; trailing: string; leading: string }> =
      [];
    const wordRegex = /[\p{L}\p{N}]+/gu;
    let lastIndex = 0;
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
      // Add any text before this word as leading
      const leading = match.index > lastIndex ? text.substring(lastIndex, match.index) : '';

      const normalized = match[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      words.push({
        word: match[0],
        normalized,
        trailing: '',
        leading,
      });

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining text as trailing from last word
    if (lastIndex < text.length) {
      const remaining = text.substring(lastIndex);
      if (words.length > 0) {
        words[words.length - 1].trailing = remaining;
      }
    }

    return words;
  }

  /**
   * Get word color based on similarity score
   */
  private getWordColor(wordInfo: { word: string; similarity: number; matched: boolean }): string {
    if (!wordInfo.matched) {
      return '#ffcccc'; // Light red for unmatched (visible on blue background)
    } else if (wordInfo.similarity >= 0.9) {
      return '#ccffcc'; // Light green for well-matched
    } else {
      return '#ffffcc'; // Light yellow for partial match
    }
  }

  /**
   * Unified helper method to render a user bubble
   */
  private renderUserBubble(
    userText: string,
    userTranslation: string,
    similarity?: number,
    expectedWords?: Array<{ word: string; similarity: number; matched: boolean }>
  ): TemplateResult {
    // Parse sentence into words if we have expectedWords for color coding
    let bubbleTextContent: TemplateResult;
    if (expectedWords && expectedWords.length > 0) {
      const parsedWords = this.parseSentenceWords(userText);

      // Match parsed words to expectedWords by position and normalized comparison
      const wordElements: TemplateResult[] = [];
      let expectedWordIndex = 0;

      for (const parsedWord of parsedWords) {
        let wordInfo: { word: string; similarity: number; matched: boolean } | null = null;

        // Try to find matching expected word
        if (expectedWordIndex < expectedWords.length) {
          const expectedWord = expectedWords[expectedWordIndex];
          // Normalize expected word for comparison (it's already normalized but may have slight differences)
          const expectedNormalized = expectedWord.word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

          if (
            parsedWord.normalized === expectedNormalized ||
            parsedWord.normalized.startsWith(expectedNormalized) ||
            expectedNormalized.startsWith(parsedWord.normalized)
          ) {
            wordInfo = expectedWord;
            expectedWordIndex++;
          } else {
            // Try to find a match later in the array (in case of word order differences)
            for (let i = expectedWordIndex + 1; i < expectedWords.length; i++) {
              const otherExpected = expectedWords[i];
              const otherNormalized = otherExpected.word
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]/gu, '');
              if (parsedWord.normalized === otherNormalized) {
                wordInfo = otherExpected;
                expectedWordIndex = i + 1;
                break;
              }
            }
          }
        }

        const color = wordInfo ? this.getWordColor(wordInfo) : 'white'; // Default to white if no match
        wordElements.push(html`
          ${parsedWord.leading}<span
            style="color: ${color}; font-weight: ${wordInfo && !wordInfo.matched
              ? 'bold'
              : 'normal'};"
          >
            ${parsedWord.word} </span
          >${parsedWord.trailing}
        `);
      }

      bubbleTextContent = html`${wordElements}`;
    } else {
      // No color coding, render as plain text
      bubbleTextContent = html`${userText}`;
    }

    return html`
      <div class="dialog-bubble bubble-right">
        <div class="bubble-content">
          <div class="bubble-text-container">
            <p class="bubble-text">${bubbleTextContent}</p>
            ${similarity !== undefined
              ? html`
                  <span class="similarity-badge ${this.getSimilarityClass(similarity)}">
                    ${Math.round(similarity * 100)}%
                  </span>
                `
              : nothing}
          </div>
          ${this.showTranslations && userTranslation
            ? html` <p class="bubble-translation">${userTranslation}</p> `
            : nothing}
          ${similarity !== undefined &&
          (() => {
            const thresholds = getSimilarityThresholds(this.currentProficiencyLevel);
            return similarity < thresholds.successThreshold;
          })()
            ? html`
                <button
                  class="btn btn-primary try-again-button"
                  @click=${this.startRecording}
                  style="margin-top: var(--spacing-sm); width: 100%;"
                >
                  Try Again
                </button>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  /**
   * Render transcription analysis (correction and grammar explanation)
   */
  private renderTranscriptionAnalysis(): TemplateResult {
    if (!this.transcriptionAnalysis) {
      return nothing;
    }

    const { correction, grammarExplanation, hasGrammarMistakes } = this.transcriptionAnalysis;

    // Don't show if there's nothing to display
    if (!correction && !grammarExplanation && !hasGrammarMistakes) {
      return nothing;
    }

    return html`
      <div class="transcription-analysis" style="margin-top: var(--spacing-sm);">
        <div
          style="
            padding: var(--spacing-sm);
            border-radius: 6px;
            border: 1px solid rgba(0, 122, 255, 0.4);
          "
        >
          <h4
            style="
              margin: 0 0 var(--spacing-xs) 0;
              color: #007aff;
              font-size: 13px;
              font-weight: 700;
            "
          >
            Feedback
          </h4>
          ${correction
            ? html`
                <div style="margin-bottom: var(--spacing-xs);">
                  <strong
                    style="color: #007aff; font-size: 12px; display: block; margin-bottom: 2px; font-weight: 700;"
                    >Correction:</strong
                  >
                  <p style="margin: 0; font-size: 13px; line-height: 1.4; font-weight: 400;">
                    ${correction}
                  </p>
                </div>
              `
            : nothing}
          ${grammarExplanation && hasGrammarMistakes
            ? html`
                <div>
                  <strong
                    style="color: #007aff; font-size: 12px; display: block; margin-bottom: 2px; font-weight: 700;"
                    >Grammar:</strong
                  >
                  <p style="margin: 0; font-size: 13px; line-height: 1.4; font-weight: 400;">
                    ${grammarExplanation}
                  </p>
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private async generateFollowUp() {
    if (this.isGeneratingFollowUp) {
      logger.debug('[DialogMode] generateFollowUp - already generating, returning');
      return;
    }

    // For topic-based flow, we don't have a selectedOption, so we need to create a pseudo-variant
    // For old flow, we need selectedOption
    if (!this.isTopicBasedFlow && !this.selectedOption) {
      logger.warn('[DialogMode] generateFollowUp - no selectedOption for old flow, returning');
      return;
    }

    // Get the user's actual transcription
    const userTranscription = this.transcriptionResult?.text;
    if (!userTranscription) {
      logger.warn('[DialogMode] generateFollowUp - no user transcription, returning');
      return;
    }

    try {
      this.isGeneratingFollowUp = true;
      // For topic-based flow, use the sentence ID as a negative ID (pseudo-variant)
      // For old flow, use the selected variant's ID
      const variantId = this.isTopicBasedFlow
        ? -(this.currentSentence?.id || 0)
        : this.selectedOption?.id || 0;

      // Build conversation history from previous messages (in foreign language only)
      const conversationHistory: string[] = [];
      if (this.currentSentence?.contextBefore) {
        conversationHistory.push(this.currentSentence.contextBefore);
      }
      if (this.currentSentence?.sentence) {
        conversationHistory.push(this.currentSentence.sentence);
      }
      if (userTranscription) {
        conversationHistory.push(userTranscription);
      }
      if (this.followUpText) {
        conversationHistory.push(this.followUpText);
      }

      const followUp = await window.electronAPI.dialog.generateFollowUp(
        variantId,
        conversationHistory.length > 0 ? conversationHistory : undefined
      );

      this.followUpText = followUp.text || '';
      this.followUpTranslation = followUp.translation || '';
      this.followUpAudio = followUp.audio || null;
      this.showFollowUp = true;

      // Auto-play continuation audio if available and autoplay is enabled
      if (this.followUpAudio && this.autoplayEnabled) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.playFollowUpAudio();
          }, 300);
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to generate follow-up');
      this.followUpText = '';
      this.followUpTranslation = '';
    } finally {
      this.isGeneratingFollowUp = false;
    }
  }

  private async nextDialog() {
    console.log('[DialogMode] nextDialog - user clicked next, consuming current session');

    this.transcriptionResult = null;
    this.selectedOption = null;
    this.followUpText = '';
    this.followUpTranslation = '';
    this.followUpAudio = null;
    this.showFollowUp = false;
    this.recordedAudioPath = null;

    // Consume the current dialog session (mark it as used and advance to next)
    const currentSession = sessionManager.getCurrentDialogSession();
    if (currentSession) {
      console.log('[DialogMode] nextDialog - consuming session', {
        sessionId: currentSession.id,
        sentenceId: currentSession.sentenceId,
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
      this.scheduleNewDialogSession().catch((error) => {
        logger.error({ error }, 'Failed to schedule new dialog session');
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
      const responseOptions = sessionData.responseOptions.map(
        (v: {
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
          createdAt: new Date(v.createdAt),
        })
      );

      // Create dialog session state
      const dialogSession: import('../utils/session-manager.js').DialogSessionState = {
        id: `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sentenceId: sessionData.sentenceId,
        sentence: sessionData.sentence,
        translation: sessionData.translation,
        contextBefore: sessionData.contextBefore,
        contextBeforeTranslation: sessionData.contextBeforeTranslation,
        beforeSentenceAudio: sessionData.beforeSentenceAudio,
        responseOptions: responseOptions.map(
          (v: {
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
            createdAt: v.createdAt.toISOString(),
          })
        ),
        createdAt: new Date().toISOString(),
      };

      // Add to the end of the queue (FIFO - removes oldest if queue is full)
      sessionManager.addDialogSession(dialogSession);
      logger.info(
        {
          sessionId: dialogSession.id,
          sentenceId: dialogSession.sentenceId,
          variantsCount: dialogSession.responseOptions.length,
        },
        'New dialog session generated and added to queue'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to schedule new dialog session');
      // Non-critical error - don't throw
    }
  }

  private getSimilarityClass(similarity: number): string {
    return getSimilarityClass(similarity, this.currentProficiencyLevel);
  }

  private goToTopicSelection() {
    router.goToTopicSelection();
  }

  private async retryLoadDialog() {
    this.error = null;
    await this.loadDialogSession();
  }

  private renderRecordingSection() {
    // Show recording section when response options exist (old flow) or for topic-based flow
    if (!this.isTopicBasedFlow && !this.responseOptions.length) return '';

    // Only show if actively recording or transcribing
    if (!this.isRecording && !this.isTranscribing) {
      return '';
    }

    return html`
      <div class="recording-section">${this.isRecording ? this.renderRecordingStatus() : ''}</div>
    `;
  }

  private renderRecordingStatus() {
    const minutes = Math.floor(this.recordingTime / 60);
    const seconds = this.recordingTime % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return html`
      <div class="recording-status-container">
        <div class="recording-status">
          <div class="recording-dot"></div>
          <span class="recording-time">${formattedTime}</span>
          <span class="recording-indicator">Recording…</span>
        </div>
        <button
          class="cancel-recording-button"
          @click=${this.cancelRecording}
          title="Cancel recording"
        >
          ✕ Cancel
        </button>
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
        padding: var(--spacing-lg) var(--spacing-xl);
        gap: var(--spacing-md);
        max-width: 800px;
        margin: 0 auto;
      }

      .control-bar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--spacing-xs);
        width: 100%;
        max-width: 600px;
        padding: 4px var(--spacing-md);
        background: var(--background-primary);
        border-bottom: 1px solid var(--border-color);
        margin-bottom: var(--spacing-sm);
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

      .bubble-text span {
        display: inline;
        transition: color 0.2s ease;
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

      .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        min-height: 24px;
      }

      .typing-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-secondary);
        opacity: 0.7;
        animation: typing-bounce 1.4s ease-in-out infinite;
      }

      .typing-dot:nth-child(1) {
        animation-delay: 0s;
      }

      .typing-dot:nth-child(2) {
        animation-delay: 0.2s;
      }

      .typing-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes typing-bounce {
        0%,
        60%,
        100% {
          transform: translateY(0);
          opacity: 0.7;
        }
        30% {
          transform: translateY(-8px);
          opacity: 1;
        }
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
        padding: var(--spacing-sm) var(--spacing-md);
        background: #fff5f5;
        border-radius: var(--border-radius);
        border-top: 2px solid rgba(255, 59, 48, 0.2);
        margin-bottom: var(--spacing-sm);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-md);
      }

      .recording-status {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex: 1;
      }

      .recording-indicator {
        font-size: 13px;
        color: var(--text-secondary);
        font-weight: 400;
      }

      .recording-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff3b30;
        animation: recording-pulse 1.2s ease-in-out infinite;
        flex-shrink: 0;
      }

      @keyframes recording-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.6;
          transform: scale(1.1);
        }
      }

      .recording-time {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }

      .cancel-recording-button {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--border-color);
        background: var(--background-primary);
        color: var(--text-secondary);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }

      .cancel-recording-button:hover {
        background: var(--background-secondary);
        border-color: var(--text-tertiary);
        color: var(--text-primary);
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
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 14px;
        color: var(--text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 32px;
        height: 32px;
        line-height: 1;
        flex-shrink: 0;
      }

      .record-button:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(0, 0, 0, 0.03);
      }

      .record-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--background-secondary);
        border-color: var(--border-color);
        color: var(--text-secondary);
      }

      .record-button:disabled:hover {
        opacity: 0.5;
        border-color: var(--border-color);
        background: var(--background-secondary);
        color: var(--text-secondary);
      }

      .record-button.recording {
        background: var(--error-color);
        border-color: var(--error-color);
        color: white;
      }

      .record-button.recording:hover {
        background: var(--error-dark);
        border-color: var(--error-dark);
      }

      .record-button.user-turn {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
        box-shadow: 0 0 12px rgba(0, 123, 255, 0.5);
        animation: pulse-glow 2s ease-in-out infinite;
      }

      .record-button.user-turn:hover {
        background: var(--primary-dark);
        border-color: var(--primary-dark);
        box-shadow: 0 0 16px rgba(0, 123, 255, 0.7);
      }

      @keyframes pulse-glow {
        0%,
        100% {
          box-shadow: 0 0 12px rgba(0, 123, 255, 0.5);
        }
        50% {
          box-shadow: 0 0 20px rgba(0, 123, 255, 0.8);
        }
      }

      .audio-replay-button {
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 14px;
        color: var(--text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 32px;
        height: 32px;
        line-height: 1;
        flex-shrink: 0;
      }

      .audio-replay-button:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(0, 0, 0, 0.03);
      }

      .audio-replay-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .translations-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 14px;
        color: var(--text-secondary);
      }

      .control-buttons {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-left: auto;
      }

      .translations-switch {
        position: relative;
        width: 40px;
        height: 20px;
        background: var(--border-color);
        border-radius: 10px;
        cursor: pointer;
        transition: background-color 0.3s ease;
      }

      .translations-switch.active {
        background: var(--primary-color);
      }

      .translations-slider {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: white;
        border-radius: 50%;
        transition: transform 0.3s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .translations-switch.active .translations-slider {
        transform: translateX(20px);
      }

      .translations-label {
        font-weight: 500;
        user-select: none;
        font-size: 12px;
      }

      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xl);
        text-align: center;
      }

      .error-message {
        color: var(--error-color);
        background: var(--error-light);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--error-color);
        text-align: center;
      }

      .action-button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 2px solid var(--primary-color);
        background: var(--background-primary);
        color: var(--primary-color);
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .action-button:hover {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary:hover {
        background: var(--primary-dark);
        color: white;
      }

      .loading {
        text-align: center;
        padding: var(--spacing-xl);
      }
    `,
  ];

  render() {
    if (this.error) {
      return html`
        <div class="dialog-container">
          <div class="error-container">
            <div class="error-message">${this.error}</div>
            <div style="display: flex; gap: var(--spacing-md);">
              <button class="action-button primary" @click=${this.retryLoadDialog}>Retry</button>
              <button class="action-button" @click=${this.goToTopicSelection}>Select Words</button>
            </div>
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
          <div class="control-buttons">
            <div class="translations-toggle">
              <span class="translations-label">Hide English</span>
              <div
                class="translations-switch ${!this.showTranslations ? 'active' : ''}"
                @click=${() => {
                  this.showTranslations = !this.showTranslations;
                }}
                title="Hide English translations"
                aria-label="Hide English translations"
              >
                <div class="translations-slider"></div>
              </div>
            </div>
            ${this.beforeSentenceAudio || this.followUpAudio
              ? html`
                  <button
                    class="audio-replay-button"
                    @click=${this.playLatestAssistantAudio}
                    ?disabled=${this.isRecording}
                    title="Replay latest assistant audio"
                    aria-label="Replay latest assistant audio"
                  >
                    <span aria-hidden="true">🔊</span>
                  </button>
                `
              : nothing}
            ${(this.isTopicBasedFlow || this.responseOptions.length > 0) &&
            !this.transcriptionResult
              ? html`
                  ${this.isRecording
                    ? html`
                        <button
                          class="record-button recording"
                          @click=${this.stopRecording}
                          title="Stop recording"
                          aria-label="Stop recording"
                        >
                          <span aria-hidden="true">⏹</span>
                        </button>
                      `
                    : html`
                        <button
                          class="record-button"
                          @click=${this.startRecording}
                          ?disabled=${!this.speechRecognitionReady}
                          title=${this.speechRecognitionReady
                            ? 'Start recording'
                            : 'Speech recognition not ready'}
                          aria-label="Start recording"
                        >
                          <span aria-hidden="true">🎤</span>
                        </button>
                      `}
                `
              : nothing}
          </div>
        </div>

        <div class="dialog-bubbles">
          ${this.currentSentence.contextBefore
            ? html`
                <div class="dialog-bubble bubble-left">
                  <div class="bubble-content">
                    <p class="bubble-text">${this.currentSentence.contextBefore}</p>
                    ${this.showTranslations && this.currentSentence.contextBeforeTranslation
                      ? html`
                          <p class="bubble-translation">
                            ${this.currentSentence.contextBeforeTranslation}
                          </p>
                        `
                      : nothing}
                  </div>
                </div>
              `
            : nothing}
          ${this.isTopicBasedFlow && this.relatedWords.length > 0 && !this.transcriptionResult
            ? html`
                <div
                  class="related-words-container"
                  style="
                    margin: var(--spacing-md) 0;
                    padding: var(--spacing-md);
                    border-radius: var(--border-radius);
                  "
                >
                  <h4
                    style="
                      margin: 0 0 var(--spacing-sm) 0;
                      color: #007aff;
                      font-size: 15px;
                      font-weight: 700;
                    "
                  >
                    Related Words:
                  </h4>
                  <div
                    style="
                      display: flex;
                      flex-wrap: wrap;
                      gap: var(--spacing-xs);
                    "
                  >
                    ${this.relatedWords.map(
                      (word) => html`
                        <span
                          style="
                            padding: var(--spacing-xs) var(--spacing-sm);
                            border-radius: 4px;
                            font-size: 13px;
                            font-weight: 600;
                          "
                          >${word}</span
                        >
                      `
                    )}
                  </div>
                </div>
              `
            : nothing}
          ${this.transcriptionResult
            ? html`
                ${this.renderUserBubble(
                  this.transcriptionResult.text,
                  this.isTopicBasedFlow ? '' : this.selectedOption?.variantTranslation || '',
                  this.isTopicBasedFlow ? undefined : this.transcriptionResult.similarity,
                  this.isTopicBasedFlow ? undefined : this.transcriptionResult.expectedWords
                )}
              `
            : !this.isTopicBasedFlow && this.responseOptions.length > 0 && !this.transcriptionResult
              ? html`
                  <div class="response-options">
                    ${this.responseOptions.map(
                      (option, _index) => html`
                        <div class="response-option">
                          <p class="sentence">${option.variantSentence}</p>
                          ${this.showTranslations
                            ? html` <p class="translation">${option.variantTranslation}</p> `
                            : nothing}
                        </div>
                      `
                    )}
                  </div>
                `
              : nothing}
          ${this.isGeneratingFollowUp && !this.isTranscribing
            ? html`
                <div class="dialog-bubble bubble-left">
                  <div class="bubble-content">
                    <p class="bubble-text typing-indicator">
                      <span class="typing-dot"></span>
                      <span class="typing-dot"></span>
                      <span class="typing-dot"></span>
                    </p>
                  </div>
                </div>
              `
            : nothing}
          ${this.showFollowUp && this.followUpText
            ? html`
                <div class="dialog-bubble bubble-left">
                  <div class="bubble-content">
                    <p class="bubble-text">${this.followUpText}</p>
                    ${this.showTranslations && this.followUpTranslation
                      ? html` <p class="bubble-translation">${this.followUpTranslation}</p> `
                      : nothing}
                  </div>
                </div>
              `
            : nothing}
        </div>

        ${this.renderRecordingSection()}
        ${this.isTopicBasedFlow && this.transcriptionAnalysis
          ? this.renderTranscriptionAnalysis()
          : nothing}
        ${!this.isGeneratingFollowUp
          ? html`
              <button
                class="btn ${this.showFollowUp && this.followUpText
                  ? 'btn-primary'
                  : 'btn-secondary'}"
                @click=${this.nextDialog}
                ?disabled=${this.isRecording || this.isTranscribing}
                style="margin-top: var(--spacing-md);"
                title=${this.isRecording || this.isTranscribing
                  ? 'Wait for recording/transcription to finish'
                  : 'Skip to next dialog'}
              >
                Next Dialog
              </button>
            `
          : nothing}
      </div>
    `;
  }
}
