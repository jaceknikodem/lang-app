import { logger } from './logger.js';

export async function initializeSpeechRecognition(): Promise<boolean> {
  await window.electronAPI.audio.initializeSpeechRecognition();
  return window.electronAPI.audio.isSpeechRecognitionReady();
}

export function startSpeechRecognitionCheck(onReadyChange: (ready: boolean) => void): () => void {
  const check = async () => {
    try {
      const ready = await window.electronAPI.audio.isSpeechRecognitionReady();
      onReadyChange(ready);
    } catch (error) {
      logger.error({ error }, 'Failed to check speech recognition readiness');
      onReadyChange(false);
    }
  };
  const timer = window.setInterval(check, 5000);
  return () => clearInterval(timer);
}
