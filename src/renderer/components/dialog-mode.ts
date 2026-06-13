/**
 * Dialog mode component for conversational practice
 */

import { html, nothing, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, state } from 'lit/decorators.js';
import { Sentence, DialogueVariant, TranscriptionAnalysis, Word } from '../../shared/types/core.js';
import type { SessionSummary } from './session-complete.js';
import './session-complete.js';
import './progress-bar.js';
import { sharedStyles } from '../styles/shared.js';
import { buttonStyles } from '../styles/button.styles.js';
import { stateStyles } from '../styles/state.styles.js';
import { dialogModeStyles } from './dialog-mode.styles.js';
import { recordingStyles } from './recording.styles.js';
import { useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import { sessionManager } from '../utils/session-manager.js';
import { router } from '../utils/router.js';
import { RecordingController } from './recording-controller.js';
import { TranscriptionController } from './transcription-controller.js';
import './recording-status.js';
import { checkProficiencyLevel } from '../utils/app-initializer.js';
import {
  getSimilarityThresholds,
  type ProficiencyLevel,
} from '../../shared/utils/similarity-threshold.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { BaseComponent } from './base-component.js';
import { logger } from '../utils/logger.js';
import { markdownToHtml } from '../utils/markdown-utils.js';
import { startSpeechRecognitionCheck } from '../utils/speech-recognition-checker.js';
import { FollowUpController } from './follow-up-controller.js';
import { loadDialogSession as loadDialogSessionService } from '../utils/dialog-session-service.js';
import { type TranscriptionResult } from './dialog-bubbles.js';
import './dialog-bubbles.js';

@customElement('dialog-mode')
export class DialogMode extends BaseComponent {
  @state()
  private currentSentence: Sentence | null = null;

  @state()
  private beforeSentenceAudio: string | null = null;

  @state()
  private responseOptions: DialogueVariant[] = [];

  @state()
  private isLoadingVariants = false;

  @state()
  private selectedOption: DialogueVariant | null = null;

  private recording = new RecordingController(this, {
    onBeforeStart: () => {
      if (this.currentAudioElement) this.currentAudioElement.pause();
      this.isAudioPlaying = false;
    },
    onRecordingComplete: () => this.performSpeechRecognition(),
    onError: (msg) => {
      this.error = msg;
    },
  });

  private transcription = new TranscriptionController(this);

  @state()
  private transcriptionResult: TranscriptionResult | null = null;

  @state()
  private isTranscribing = false;

  @state()
  private speechRecognitionReady = false;

  private followUp = new FollowUpController(this, {
    getContext: () => {
      if (!this.isTopicBasedFlow && !this.selectedOption) return null;
      const userTranscription = this.transcriptionResult?.text;
      if (!userTranscription) return null;

      const variantId = this.isTopicBasedFlow
        ? -(this.currentSentence?.id || 0)
        : this.selectedOption?.id || 0;

      const conversationHistory: string[] = [];
      if (this.currentSentence?.contextBefore)
        conversationHistory.push(this.currentSentence.contextBefore);
      if (this.currentSentence?.sentence) conversationHistory.push(this.currentSentence.sentence);
      if (userTranscription) conversationHistory.push(userTranscription);
      if (this.followUp.followUpText) conversationHistory.push(this.followUp.followUpText);

      return { variantId, conversationHistory };
    },
    onGenerated: () => {
      if (this.followUp.followUpAudio && this.autoplayEnabled) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            void this.playFollowUpAudio();
          }, 300);
        });
      }
    },
  });

  private recordedAudioPath: string | null = null;

  @state()
  private showTranslations = true;

  @state()
  private autoplayEnabled = false;

  private isAudioPlaying = false;

  @state()
  private isTopicBasedFlow = false;

  @state()
  private transcriptionAnalysis: TranscriptionAnalysis | null = null;

  @state()
  private isAnalyzingTranscription = false; // Track if transcription analysis is in progress

  private transcriptionAnalysisSentenceId: number | null = null; // Track which sentence the analysis is for

  @state()
  private previousCorrections: string[] = []; // Store up to 3 previous corrections for topic-based flow

  @state()
  private showCompletion = false;

  @state()
  private sessionSummary: SessionSummary | null = null;

  private initialTotalDialogs = 0; // Track initial total for progress calculation

  private speechRecognitionCheckCleanup: (() => void) | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private keyboardUnsubscribe?: () => void;
  private currentProficiencyLevel: ProficiencyLevel | null = null;
  private dialogCount = 0; // Track number of dialogs completed in this session
  private dialogsWithAudio = 0; // Track number of dialogs where user recorded audio

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
    if (this.recording.isRecording) {
      await this.recording.cancelRecording();
    }

    // Reset dialog state
    this.transcriptionResult = null;
    this.selectedOption = null;
    this.followUp.clear();
    this.isTranscribing = false;
    this.transcription.streamingTranscriptionText = null;
    this.recordedAudioPath = null;
    this.transcriptionAnalysis = null;
    this.isAnalyzingTranscription = false;
    this.transcriptionAnalysisSentenceId = null;
    this.dialogCount = 0;
    this.dialogsWithAudio = 0;

    // Reload dialog session for the new language
    await this.loadDialogSession();
  };

  connectedCallback() {
    super.connectedCallback();

    // Reset dialog count and session start time when component is connected
    this.dialogCount = 0;
    this.dialogsWithAudio = 0;
    this.sessionStartTime = Date.now();
    this.showCompletion = false;
    this.sessionSummary = null;
    this.initialTotalDialogs = 0; // Reset initial total
    this.previousCorrections = []; // Reset previous corrections when starting new session

    // Load current language and proficiency level, and create dialog session for tracking
    window.electronAPI.database
      .getCurrentLanguage()
      .then(async (language) => {
        this.currentLanguage = language;
        const proficiency = await checkProficiencyLevel(language);
        this.currentProficiencyLevel = proficiency as ProficiencyLevel | null;

        await this.createTrackingSession('dialog', language);
      })
      .catch((err) => {
        logger.error({ error: err }, 'Failed to load current language');
      });

    this.loadDialogSession();
    this.loadAutoplaySetting();

    this.speechRecognitionCheckCleanup = startSpeechRecognitionCheck((ready) => {
      this.speechRecognitionReady = ready;
      this.requestUpdate();
    });

    // Set up transcription progress listener for streaming updates
    // Set up keyboard bindings
    this.setupKeyboardBindings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.currentSessionId && !this.showCompletion) {
      void this.updateSessionOnCompletion();
    }

    this.speechRecognitionCheckCleanup?.();
    this.speechRecognitionCheckCleanup = null;

    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
      this.keyboardUnsubscribe = undefined;
    }

    // Clean up audio - stop both HTML5 audio and IPC audio
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    // Stop any IPC audio playback that might be playing
    void window.electronAPI.audio.stopAudio().catch(() => {
      // Ignore errors when stopping (might not be playing)
    });
  }

  private async loadDialogSession() {
    try {
      this.isLoading = true;
      this.error = null;
      this.currentSentence = null;
      this.responseOptions = [];
      this.selectedOption = null;
      this.followUp.clear();
      this.transcriptionResult = null;
      this.transcriptionAnalysis = null;
      this.isAnalyzingTranscription = false;
      this.transcriptionAnalysisSentenceId = null;
      this.recordedAudioPath = null;

      if (this.initialTotalDialogs === 0) {
        const session = sessionManager.getCurrentSession();
        this.initialTotalDialogs = session.dialogSessions?.length || 0;
      }

      await this.loadAutoplaySetting();
      await this.loadShowTranslationsSetting();

      const result = await loadDialogSessionService(this.dialogCount);

      switch (result.status) {
        case 'loaded':
          this.currentSentence = result.sentence;
          this.beforeSentenceAudio = result.beforeSentenceAudio;
          this.isTopicBasedFlow = result.isTopicBasedFlow;
          this.responseOptions = result.responseOptions;
          this.previousCorrections = result.previousCorrections;
          this.isLoading = false;
          if (!result.isTopicBasedFlow && result.responseOptions.length === 0) {
            void this.loadVariantsAsync(result.sentence);
          }
          if (this.beforeSentenceAudio && this.autoplayEnabled) {
            requestAnimationFrame(() => {
              setTimeout(() => {
                this.playBeforeSentence();
              }, 300);
            });
          }
          break;
        case 'show_summary':
          await this.showSessionSummary();
          break;
        case 'no_sentences':
          this.error = 'No sentences available for dialog practice. Please learn more words first.';
          this.isLoading = false;
          break;
        case 'error':
          this.error = result.message;
          this.isLoading = false;
          break;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load dialog session');
      this.error = getErrorMessage(error, 'Failed to load dialog session');
      this.isLoading = false;
    }
  }

  private async loadVariantsAsync(sentence: Sentence): Promise<void> {
    this.isLoadingVariants = true;
    try {
      const variants = await window.electronAPI.dialog.generateVariants(sentence.id);
      const originalVariant: DialogueVariant = {
        id: -sentence.id,
        sentenceId: sentence.id,
        variantSentence: sentence.sentence,
        variantTranslation: sentence.translation,
        variantPronunciation: sentence.pronunciation,
        variantSentenceAudio: sentence.audioPath || undefined,
        createdAt: new Date(),
      };
      const options = [originalVariant, ...variants.slice(0, 2)];
      options.sort(() => Math.random() - 0.5);
      this.responseOptions = options;
    } catch (error) {
      logger.error({ error }, 'Failed to load variants');
      this.responseOptions = [
        {
          id: -sentence.id,
          sentenceId: sentence.id,
          variantSentence: sentence.sentence,
          variantTranslation: sentence.translation,
          createdAt: new Date(),
        },
      ];
    } finally {
      this.isLoadingVariants = false;
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

  private async loadShowTranslationsSetting() {
    try {
      const setting = await window.electronAPI.database.getSetting('dialog_show_translations');
      if (setting !== null) {
        this.showTranslations = setting === 'true';
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load show translations setting');
    }
  }

  private async saveShowTranslationsSetting() {
    try {
      await window.electronAPI.database.setSetting(
        'dialog_show_translations',
        String(this.showTranslations)
      );
    } catch (error) {
      logger.error({ error }, 'Failed to save show translations setting');
    }
  }

  private async playBeforeSentence() {
    if (this.isAudioPlaying) return;
    this.isAudioPlaying = true;
    try {
      // If continuation is generated, play all 3 in sequence: trigger, user recording, continuation
      if (this.followUp.showFollowUp && this.recordedAudioPath && this.followUp.followUpAudio) {
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
                this.trackAudioPlayback({
                  sentenceId: this.currentSentence.id,
                  audioPath: this.beforeSentenceAudio,
                  language: this.currentLanguage,
                  mode: 'dialog',
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
          if (this.followUp.followUpAudio) {
            try {
              logger.debug(
                { audioPath: this.followUp.followUpAudio },
                '[DialogMode] Playing continuation audio'
              );
              await window.electronAPI.audio.playAudio(this.followUp.followUpAudio);
              logger.debug('[DialogMode] Continuation audio finished');
            } catch (error) {
              logger.error({ error }, 'Failed to play continuation audio');
            }
          }
        } catch (error) {
          logger.error({ error }, 'Failed to play dialog sequence');
        }
        return;
      }

      // Before user speaks: just play trigger audio
      if (!this.beforeSentenceAudio) return;

      try {
        // Stop any currently playing audio
        if (this.currentAudioElement) {
          this.currentAudioElement.pause();
        }

        // Play the trigger audio
        await window.electronAPI.audio.playAudio(this.beforeSentenceAudio);

        // Track sentence play count
        if (this.currentSentence?.id) {
          void window.electronAPI.database
            .incrementSentencePlayCount(this.currentSentence.id)
            .catch((err) => {
              logger.warn({ error: err }, 'Failed to increment sentence play count');
            });
        }
        if (this.currentSentence?.id && this.currentLanguage) {
          this.trackAudioPlayback({
            sentenceId: this.currentSentence.id,
            audioPath: this.beforeSentenceAudio,
            language: this.currentLanguage,
            mode: 'dialog',
          });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to play before sentence audio');
      }
    } finally {
      this.isAudioPlaying = false;
    }
  }

  private async playFollowUpAudio() {
    if (!this.followUp.followUpAudio || this.isAudioPlaying) return;
    this.isAudioPlaying = true;
    try {
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
      }
      await window.electronAPI.audio.playAudio(this.followUp.followUpAudio);
    } catch (error) {
      logger.error({ error }, 'Failed to play follow-up audio');
    } finally {
      this.isAudioPlaying = false;
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
      // Toggle translation visibility
      {
        ...GlobalShortcuts.TOGGLE_AUDIO_ONLY,
        action: () => {
          this.showTranslations = !this.showTranslations;
          void this.saveShowTranslationsSetting();
        },
        context: 'dialog',
        description: 'Toggle English translation visibility',
      },
      // Next dialog
      {
        key: CommonKeys.ENTER,
        action: () => {
          // Allow skipping dialog anytime, except during recording/transcription or when generating follow-up
          if (
            !this.recording.isRecording &&
            !this.isTranscribing &&
            !this.followUp.isGeneratingFollowUp
          ) {
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
    if (this.recording.isRecording) {
      await this.recording.stopRecording();
    } else {
      if (
        !this.speechRecognitionReady ||
        (!this.isTopicBasedFlow && !this.responseOptions.length)
      ) {
        return;
      }
      this.transcriptionResult = null;
      this.isTranscribing = false;
      await this.recording.startRecording();
    }
  }

  private async performSpeechRecognition() {
    const currentRecording = this.recording.currentRecording;
    if (
      !currentRecording ||
      (!this.isTopicBasedFlow && !this.responseOptions.length) ||
      !this.speechRecognitionReady
    ) {
      return;
    }

    this.isTranscribing = true;
    this.transcriptionResult = null;
    this.transcription.clear();

    try {
      const currentLanguage = await window.electronAPI.database.getCurrentLanguage();

      // Transcribe the recorded audio
      const transcription = await window.electronAPI.audio.transcribeAudio(
        currentRecording.filePath,
        { language: currentLanguage }
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

      if (currentRecording) {
        this.recordedAudioPath = currentRecording.filePath;
      }

      // Mark transcription as complete
      this.isTranscribing = false;
      this.transcription.streamingTranscriptionText = null;

      // Record pronunciation attempt in database (tracks full history)
      if (
        this.currentSentence?.id &&
        !this.isTopicBasedFlow &&
        this.selectedOption &&
        this.transcriptionResult
      ) {
        try {
          await window.electronAPI.database.recordPronunciationAttempt(
            this.currentSentence.id,
            this.transcriptionResult.similarity,
            this.selectedOption.variantSentence, // Expected text (the variant that matched)
            transcription.text, // Transcribed text
            this.recording.currentRecording?.filePath || null // Audio path
          );
        } catch (error) {
          logger.warn({ error }, 'Failed to record pronunciation attempt');
        }
      }

      // Track that user recorded audio for this dialog
      if (this.recording.currentRecording?.filePath) {
        this.dialogsWithAudio++;
      }

      // For topic-based flow, run transcription analysis and follow-up generation in parallel
      if (this.isTopicBasedFlow) {
        const currentLanguage = await window.electronAPI.database.getCurrentLanguage();
        const assistantSentence = this.currentSentence?.sentence;
        const currentSentenceId = this.currentSentence?.id || null;

        // Get the word's topic if available
        let topic: string | undefined;
        if (this.currentSentence?.wordId) {
          try {
            const word = await window.electronAPI.database.getWordById(this.currentSentence.wordId);
            topic = word?.topic;
          } catch (error) {
            logger.warn({ error }, 'Failed to get word topic for transcription analysis');
          }
        }

        // Track which sentence this analysis is for
        this.transcriptionAnalysisSentenceId = currentSentenceId;
        this.isAnalyzingTranscription = true;

        // Start both LLM queries in parallel
        const [transcriptionAnalysisResult, followUpResult] = await Promise.allSettled([
          // Transcription analysis
          assistantSentence
            ? window.electronAPI.dialog.analyzeTranscription(
                transcription.text,
                currentLanguage,
                assistantSentence,
                topic
              )
            : Promise.resolve(null),
          // Follow-up generation
          this.followUp.generate(),
        ]);

        // Handle transcription analysis result - only if it's still for the current sentence
        if (
          transcriptionAnalysisResult.status === 'fulfilled' &&
          this.transcriptionAnalysisSentenceId === currentSentenceId
        ) {
          this.transcriptionAnalysis = transcriptionAnalysisResult.value;
          this.isAnalyzingTranscription = false;

          // Don't add current correction to previousCorrections yet
          // It will be added when moving to the next dialog to avoid displaying it twice
        } else {
          if (transcriptionAnalysisResult.status === 'rejected') {
            logger.warn(
              { error: transcriptionAnalysisResult.reason },
              'Failed to analyze transcription'
            );
          }
          // Only clear if this result is for the current sentence
          if (this.transcriptionAnalysisSentenceId === currentSentenceId) {
            this.transcriptionAnalysis = null;
            this.isAnalyzingTranscription = false;
          }
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
        if (
          this.transcriptionResult &&
          this.transcriptionResult.similarity >= thresholds.successThreshold
        ) {
          await this.followUp.generate();
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
      this.transcription.streamingTranscriptionText = null;
    }
  }

  /**
   * Render transcription analysis (correction and grammar explanation)
   */
  private renderTranscriptionAnalysis(): TemplateResult | typeof nothing {
    // Show loading state if analysis is in progress
    if (this.isAnalyzingTranscription) {
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
            <div style="font-size: 13px; color: var(--text-secondary); font-style: italic;">
              Analyzing your response...
            </div>
          </div>
        </div>
      `;
    }

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
                <div
                  class="correction-single-line"
                  style="
                    margin-bottom: ${grammarExplanation && hasGrammarMistakes
                    ? 'var(--spacing-xs)'
                    : '0'};
                    padding: 4px 8px;
                    background: rgba(0, 0, 0, 0.03);
                    border-radius: 4px;
                    font-size: 12px;
                    color: var(--text-secondary);
                    font-style: italic;
                    line-height: 1.4;
                  "
                >
                  ${correction}
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
                  <div style="margin: 0; font-size: 13px; line-height: 1.4; font-weight: 400;">
                    ${unsafeHTML(markdownToHtml(grammarExplanation))}
                  </div>
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private async nextDialog() {
    console.log('[DialogMode] nextDialog - user clicked next, consuming current session');

    // Move current correction to previousCorrections and save to database before resetting (for topic-based flow)
    if (this.isTopicBasedFlow && this.transcriptionAnalysis?.correction && this.currentSentence) {
      const correction = this.transcriptionAnalysis.correction;
      // Only save corrections shorter than 100 characters
      if (correction.length < 100) {
        // Add to previous corrections (keep only last 3)
        this.previousCorrections = [correction, ...this.previousCorrections].slice(0, 3);

        // Save to database
        try {
          const language = await window.electronAPI.database.getCurrentLanguage();
          await window.electronAPI.database.insertDialogCorrection({
            sentenceId: this.currentSentence.id,
            sessionId: this.currentSessionId,
            correctionText: correction,
            language,
          });
        } catch (error) {
          logger.warn({ error }, 'Failed to save dialog correction to database');
        }
      }
    }

    this.transcriptionResult = null;
    this.selectedOption = null;
    this.followUp.clear();
    this.recordedAudioPath = null;
    this.transcriptionAnalysis = null;
    this.isAnalyzingTranscription = false;
    this.transcriptionAnalysisSentenceId = null;

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

    // Check if there are any more cached sessions before loading
    const session = sessionManager.getCurrentSession();
    const hasNoMoreCachedSessions = !session.dialogSessions || session.dialogSessions.length === 0;

    // Check if currentDialogIndex is undefined (meaning we've consumed all sessions)
    // This happens when we just consumed the last session
    const indexIsUndefined = session.currentDialogIndex === undefined;
    const allSessionsConsumed =
      hasNoMoreCachedSessions ||
      (indexIsUndefined && session.dialogSessions && session.dialogSessions.length > 0);

    // If we've completed at least one dialog and all sessions are consumed, show summary
    if (allSessionsConsumed && this.dialogCount > 0) {
      console.log('[DialogMode] nextDialog - all cached sessions exhausted, showing summary', {
        dialogCount: this.dialogCount,
        hasNoMoreCachedSessions,
        indexIsUndefined,
        sessionLength: session.dialogSessions?.length || 0,
        currentIndex: session.currentDialogIndex,
      });
      await this.showSessionSummary();
      return;
    }

    // Check if we've completed 5 dialogs (only if we're continuing with more sessions)
    if (this.dialogCount >= 5) {
      // Dispatch event for autopilot to check scores after 5 dialogs are done
      window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
      // Reset counter for next batch
      this.dialogCount = 0;
    }

    // Load the next session from the queue
    await this.loadDialogSession();
  }

  /**
   * Show session summary when all cached dialogues are finished
   */
  private async showSessionSummary(): Promise<void> {
    try {
      this.isLoading = false;

      // Update learning session with final counts
      await this.updateSessionOnCompletion();

      // Clear cached dialog sessions since we've finished them all
      sessionManager.clearDialogSession();
      console.log('[DialogMode] showSessionSummary - cleared cached dialog sessions');

      // Calculate time spent
      const timeSpent = Math.round((Date.now() - this.sessionStartTime) / (1000 * 60)); // minutes

      // Get completed words from the dialogs we've done
      // For now, we'll use an empty array since we don't track individual words in dialog mode
      const completedWords: Word[] = [];

      // Determine next recommendation
      const nextRecommendation: SessionSummary['nextRecommendation'] = 'new-topic';

      this.sessionSummary = {
        type: 'learning', // Use 'learning' type since dialog is a form of learning
        wordsStudied: this.dialogsWithAudio, // Only count dialogs where user recorded audio
        timeSpent,
        completedWords,
        nextRecommendation,
      };

      this.showCompletion = true;

      // Trigger pregeneration of new dialog sessions after showing summary
      window.dispatchEvent(
        new CustomEvent('dialog-session-complete', {
          detail: { dialogCount: this.dialogCount },
        })
      );
    } catch (error) {
      logger.error({ error }, 'Failed to show session summary');
      // Fallback: navigate to topic selection
      router.goToTopicSelection();
    }
  }

  private async updateSessionOnCompletion() {
    await this.finalizeTrackingSession(this.dialogsWithAudio, this.dialogCount);
  }

  private goToTopicSelection() {
    router.goToTopicSelection();
  }

  private async retryLoadDialog() {
    this.error = null;
    await this.loadDialogSession();
  }

  private renderRecordingSection() {
    if (!this.isTopicBasedFlow && !this.responseOptions.length) return '';
    if (!this.recording.isRecording && !this.isTranscribing) return '';

    return html`
      <div class="recording-section">
        <recording-status
          .isRecording=${this.recording.isRecording}
          .recordingTime=${this.recording.recordingTime}
          @cancel-recording=${this.recording.cancelRecording}
        ></recording-status>
      </div>
    `;
  }

  static styles = [sharedStyles, buttonStyles, stateStyles, dialogModeStyles, recordingStyles];

  render() {
    // Show completion screen if all cached dialogues are finished
    if (this.showCompletion && this.sessionSummary) {
      return html`
        <div class="dialog-container">
          <session-complete .sessionSummary=${this.sessionSummary}></session-complete>
        </div>
      `;
    }

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

    // Calculate progress using initial total (not current length which decreases)
    const totalDialogs = this.initialTotalDialogs || 0;
    const completedDialogs = this.dialogCount;
    const progress = totalDialogs > 0 ? ((completedDialogs + 1) / totalDialogs) * 100 : 0;

    return html`
      <div class="dialog-container">
        ${totalDialogs > 0
          ? html`
              <div class="dialog-header">
                <div class="dialog-progress">
                  <span>${completedDialogs + 1} / ${totalDialogs}</span>
                  <progress-bar
                    .value=${progress}
                    height="4px"
                    style="width: 150px;"
                  ></progress-bar>
                </div>
              </div>
            `
          : nothing}
        <div class="control-bar">
          <div class="control-buttons">
            <div class="translations-toggle">
              <span class="translations-label">Hide English</span>
              <div
                class="translations-switch ${!this.showTranslations ? 'active' : ''}"
                @click=${() => {
                  this.showTranslations = !this.showTranslations;
                  void this.saveShowTranslationsSetting();
                }}
                title="Hide English translations"
                aria-label="Hide English translations"
              >
                <div class="translations-slider"></div>
              </div>
            </div>
            ${(this.isTopicBasedFlow || this.responseOptions.length > 0) &&
            !this.transcriptionResult
              ? html`
                  ${this.recording.isRecording
                    ? html`
                        <button
                          class="record-button recording"
                          @click=${this.recording.stopRecording}
                          title="Stop recording"
                          aria-label="Stop recording"
                        >
                          <span aria-hidden="true">⏹</span>
                        </button>
                      `
                    : html`
                        <button
                          class="record-button"
                          @click=${this.recording.startRecording}
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

        <dialog-bubbles
          .sentence=${this.currentSentence}
          .transcriptionResult=${this.transcriptionResult}
          .followUpText=${this.followUp.followUpText}
          .followUpTranslation=${this.followUp.followUpTranslation}
          .followUpPronunciation=${this.followUp.followUpPronunciation}
          .followUpAudio=${this.followUp.followUpAudio ?? null}
          .showFollowUp=${this.followUp.showFollowUp}
          .isGeneratingFollowUp=${this.followUp.isGeneratingFollowUp && !this.isTranscribing}
          .isTopicBasedFlow=${this.isTopicBasedFlow}
          .isLoadingVariants=${this.isLoadingVariants}
          .responseOptions=${this.responseOptions}
          .selectedOption=${this.selectedOption}
          .showTranslations=${this.showTranslations}
          .previousCorrections=${this.previousCorrections}
          .proficiencyLevel=${this.currentProficiencyLevel}
          .beforeSentenceAudio=${this.beforeSentenceAudio}
          .isRecording=${this.recording.isRecording}
          @start-recording=${this.recording.startRecording}
          @play-variant-audio=${(e: CustomEvent<{ audioPath: string }>) => {
            if (!this.isAudioPlaying && !this.recording.isRecording) {
              void window.electronAPI.audio.playAudio(e.detail.audioPath).catch((err) => {
                logger.warn({ error: err }, 'Failed to play variant audio');
              });
            }
          }}
        ></dialog-bubbles>

        ${this.renderRecordingSection()}
        ${this.isTopicBasedFlow && this.transcriptionAnalysis
          ? this.renderTranscriptionAnalysis()
          : nothing}
        ${!this.followUp.isGeneratingFollowUp
          ? html`
              <button
                class="btn ${this.followUp.showFollowUp && this.followUp.followUpText
                  ? 'btn-primary'
                  : 'btn-secondary'}"
                @click=${this.nextDialog}
                ?disabled=${this.recording.isRecording || this.isTranscribing}
                style="margin-top: var(--spacing-md);"
                title=${this.recording.isRecording || this.isTranscribing
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
