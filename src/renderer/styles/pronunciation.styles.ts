import { css } from 'lit';

export const pronunciationStyles = css`
  .word-reading-tooltip {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 8px 12px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    z-index: 100;
  }

  .word-reading-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: #1a1a2e;
  }

  .tooltip-hiragana {
    font-size: 15px;
    color: #e8e8f0;
    letter-spacing: 0.05em;
  }

  .tooltip-romaji {
    font-size: 11px;
    color: #9090b0;
    letter-spacing: 0.08em;
  }

  .sentence-pronunciation {
    font-size: 20px;
    color: var(--text-secondary);
    line-height: 1.4;
    margin-top: var(--spacing-xs);
    position: relative;
    display: inline-block;
    cursor: default;
  }

  .sentence-pronunciation .word-reading-tooltip {
    bottom: calc(100% + 6px);
    left: 0;
    transform: none;
  }

  .sentence-pronunciation .word-reading-tooltip::after {
    left: 16px;
    transform: none;
  }

  .sentence-pronunciation:hover .word-reading-tooltip {
    display: flex;
  }

  .context-pronunciation {
    font-size: 18px;
    color: var(--text-secondary);
    line-height: 1.4;
    margin-top: var(--spacing-xs);
    position: relative;
    display: inline-block;
    cursor: default;
  }

  .context-pronunciation .word-reading-tooltip {
    bottom: calc(100% + 6px);
    left: 0;
    transform: none;
  }

  .context-pronunciation .word-reading-tooltip::after {
    left: 16px;
    transform: none;
  }

  .context-pronunciation:hover .word-reading-tooltip {
    display: flex;
  }
`;
