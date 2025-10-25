/**
 * Settings panel component for application lifecycle management
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

// Type is already declared in preload.ts, no need to redeclare

@customElement('settings-panel')
export class SettingsPanel extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .settings-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 2rem;
      }

      .settings-section {
        margin-bottom: 2rem;
        padding: 1.5rem;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        background: #fafafa;
      }

      .settings-section h3 {
        margin-top: 0;
        color: #333;
        font-size: 1.2rem;
      }

      .settings-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .settings-row:last-child {
        margin-bottom: 0;
      }

      .settings-description {
        flex: 1;
        margin-right: 1rem;
      }

      .settings-description p {
        margin: 0;
        color: #666;
        font-size: 0.9rem;
      }

      .action-button {
        padding: 0.5rem 1rem;
        background: #007acc;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
        min-width: 120px;
      }

      .action-button:hover {
        background: #005a9e;
      }

      .action-button:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .status-message {
        margin-top: 0.5rem;
        padding: 0.5rem;
        border-radius: 4px;
        font-size: 0.9rem;
      }

      .status-success {
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }

      .status-error {
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }

      .status-info {
        background: #d1ecf1;
        color: #0c5460;
        border: 1px solid #bee5eb;
      }




    `
  ];

  @state()
  private backupStatus = '';

  @state()
  private isCreatingBackup = false;



  async connectedCallback() {
    super.connectedCallback();
  }



  private async createBackup() {
    this.isCreatingBackup = true;
    this.backupStatus = '';

    try {
      const backupPath = await window.electronAPI.lifecycle.createBackup();
      this.backupStatus = `Backup created successfully at: ${backupPath}`;
    } catch (error) {
      console.error('Failed to create backup:', error);
      this.backupStatus = `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      this.isCreatingBackup = false;
    }
  }





  render() {
    return html`
      <div class="settings-container">
        <h2>Settings</h2>



        <div class="settings-section">
          <h3>Data Management</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Create Backup</strong>
              <p>Create a backup of your learning data and audio files</p>
            </div>
            <button 
              class="action-button" 
              @click=${this.createBackup}
              ?disabled=${this.isCreatingBackup}
            >
              ${this.isCreatingBackup ? 'Creating...' : 'Create Backup'}
            </button>
          </div>
          ${this.backupStatus ? html`
            <div class="status-message ${this.backupStatus.includes('Failed') ? 'status-error' : 'status-success'}">
              ${this.backupStatus}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
}