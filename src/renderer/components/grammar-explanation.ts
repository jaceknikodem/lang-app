import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { sharedStyles } from '../styles/shared.js';
import { markdownToHtml } from '../utils/markdown-utils.js';

/**
 * Grammar explanation panel. Presentational + self-contained:
 * - shows a loading spinner while the explanation is being fetched,
 * - renders the markdown explanation with a close button,
 * - lets the user select text inside it and right-click to "Read out loud".
 *
 * Communicates with its host purely via events:
 * - `close`      — user clicked the × button
 * - `read-aloud` — user picked "Read out loud"; `detail.text` is the selection
 */
@customElement('grammar-explanation')
export class GrammarExplanation extends LitElement {
  /** Markdown explanation text; `null`/empty renders nothing (unless loading). */
  @property({ type: String }) explanation: string | null = null;

  /** When true, show the loading spinner instead of content. */
  @property({ type: Boolean }) loading = false;

  @state() private contextMenu: { x: number; y: number; selectedText: string } | null = null;

  static styles = [
    sharedStyles,
    css`
      .grammar-loading-box {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        border: 1px solid #ccc;
        border-radius: var(--border-radius);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--text-secondary);
      }

      .grammar-explanation-box {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        border: 1px solid #ccc;
        border-radius: var(--border-radius);
      }

      .grammar-explanation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
      }

      .grammar-explanation-header h4 {
        margin: 0;
        font-size: 16px;
        color: var(--text-primary);
      }

      .grammar-close-btn {
        background: transparent;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
      }

      .grammar-close-btn:hover {
        background: var(--background-secondary);
        color: var(--text-primary);
      }

      .grammar-explanation-content {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-primary);
      }

      .grammar-explanation-content code {
        background: var(--background-primary);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
        font-size: 0.9em;
      }

      .grammar-explanation-content strong {
        font-weight: 600;
      }

      .grammar-explanation-content em {
        font-style: italic;
      }

      .grammar-explanation-content ul {
        margin: var(--spacing-xs) 0;
        padding-left: var(--spacing-lg);
      }

      .grammar-explanation-content li {
        margin: var(--spacing-xs) 0;
      }

      .context-menu {
        position: fixed;
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        min-width: 150px;
        padding: var(--spacing-xs) 0;
      }

      .context-menu-item {
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: pointer;
        font-size: 13px;
        color: var(--text-primary);
        transition: background 0.15s ease;
      }

      .context-menu-item:hover {
        background: var(--background-secondary);
      }

      .context-menu-item:active {
        background: var(--primary-light);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('click', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleOutsideClick = (event: MouseEvent): void => {
    if (!this.contextMenu) return;
    const path = event.composedPath();
    const insideMenu = path.some(
      (el) => el instanceof HTMLElement && el.classList?.contains('context-menu')
    );
    const insideContent = path.some(
      (el) => el instanceof HTMLElement && el.classList?.contains('grammar-explanation-content')
    );
    if (!insideMenu && !insideContent) {
      this.closeContextMenu();
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.contextMenu) {
      this.closeContextMenu();
    }
  };

  private handleClose(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const selectedText = window.getSelection()?.toString().trim() || '';
    // Only show menu for a reasonable selection length
    if (selectedText.length < 5 || selectedText.length > 100) {
      this.contextMenu = null;
      return;
    }
    this.contextMenu = { x: e.clientX, y: e.clientY, selectedText };
  };

  private closeContextMenu(): void {
    this.contextMenu = null;
    window.getSelection()?.removeAllRanges();
  }

  private handleReadAloud = (): void => {
    if (!this.contextMenu) return;
    const text = this.contextMenu.selectedText;
    this.closeContextMenu();
    this.dispatchEvent(
      new CustomEvent('read-aloud', { detail: { text }, bubbles: true, composed: true })
    );
  };

  render(): TemplateResult {
    if (this.loading) {
      return html`
        <div class="grammar-loading-box">
          <div class="spinner"></div>
          <span>Loading explanation...</span>
        </div>
      `;
    }

    if (!this.explanation) {
      return html``;
    }

    return html`
      <div class="grammar-explanation-box">
        <div class="grammar-explanation-header">
          <button class="grammar-close-btn" @click=${this.handleClose} title="Close">×</button>
        </div>
        <div class="grammar-explanation-content" @contextmenu=${this.handleContextMenu}>
          ${unsafeHTML(markdownToHtml(this.explanation))}
        </div>
        ${this.contextMenu
          ? html`
              <div
                class="context-menu"
                style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
                @click=${(e: Event) => e.stopPropagation()}
              >
                <div class="context-menu-item" @click=${this.handleReadAloud}>Read out loud</div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'grammar-explanation': GrammarExplanation;
  }
}
