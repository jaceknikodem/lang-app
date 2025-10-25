/**
 * Main application root component
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppState } from '../../shared/types/core.js';

@customElement('app-root')
export class AppRoot extends LitElement {
  @state()
  private appState: AppState = {
    currentMode: 'learning',
    quizDirection: 'foreign-to-english'
  };

  @state()
  private isLoading = true;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .app-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .mode-selector {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-bottom: 20px;
    }

    .mode-button {
      padding: 10px 20px;
      border: 2px solid #007AFF;
      background: white;
      color: #007AFF;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
    }

    .mode-button:hover {
      background: #f0f8ff;
    }

    .mode-button.active {
      background: #007AFF;
      color: white;
    }

    .content-area {
      min-height: 400px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .placeholder {
      text-align: center;
      color: #666;
      font-size: 18px;
    }

    .loading {
      text-align: center;
      color: #666;
      font-style: italic;
    }
  `;

  async connectedCallback() {
    super.connectedCallback();
    await this.initializeApp();
  }

  private async initializeApp() {
    try {
      // Check if LLM is available
      const llmAvailable = await window.electronAPI.llm.isAvailable();
      console.log('LLM Available:', llmAvailable);
      
      this.isLoading = false;
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.isLoading = false;
    }
  }

  private handleModeChange(mode: 'learning' | 'quiz') {
    this.appState = {
      ...this.appState,
      currentMode: mode
    };
  }

  render() {
    if (this.isLoading) {
      return html`<div class="loading">Initializing application...</div>`;
    }

    return html`
      <div class="app-container">
        <div class="mode-selector">
          <button 
            class="mode-button ${this.appState.currentMode === 'learning' ? 'active' : ''}"
            @click=${() => this.handleModeChange('learning')}
          >
            Learning Mode
          </button>
          <button 
            class="mode-button ${this.appState.currentMode === 'quiz' ? 'active' : ''}"
            @click=${() => this.handleModeChange('quiz')}
          >
            Quiz Mode
          </button>
        </div>

        <div class="content-area">
          ${this.renderCurrentMode()}
        </div>
      </div>
    `;
  }

  private renderCurrentMode() {
    switch (this.appState.currentMode) {
      case 'learning':
        return html`
          <div class="placeholder">
            <h3>Learning Mode</h3>
            <p>Topic selection and sentence review will be implemented here.</p>
          </div>
        `;
      case 'quiz':
        return html`
          <div class="placeholder">
            <h3>Quiz Mode</h3>
            <p>Vocabulary assessment will be implemented here.</p>
          </div>
        `;
      default:
        return html`<div class="placeholder">Unknown mode</div>`;
    }
  }
}