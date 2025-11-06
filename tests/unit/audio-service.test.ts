import { AudioService } from '../../src/main/audio/audio-service';
import { TTSAudioGenerator } from '../../src/main/audio/audio-generator';

// Mock Electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app-data')
  }
}));

describe('Audio Service', () => {
  let audioService: AudioService;

  beforeEach(() => {
    audioService = new AudioService();
  });

  describe('generateAudio', () => {
    it('should validate input parameters', async () => {
      await expect(audioService.generateAudio('', 'english')).rejects.toThrow('Audio generation failed');
    });

    it('should allow missing language and use defaults', async () => {
      const mockGenerator = {
        generateAudio: jest.fn().mockResolvedValue('/tmp/test-app-data/audio/hello.aiff'),
        playAudio: jest.fn().mockResolvedValue(undefined),
        stopAudio: jest.fn(),
        audioExists: jest.fn().mockResolvedValue(true)
      };

      const service = new AudioService(mockGenerator);
      const result = await service.generateAudio('hello', '');

      expect(result).toBe('hello.aiff');
      expect(mockGenerator.generateAudio).toHaveBeenCalledWith('hello', undefined, undefined, undefined, undefined, undefined);
    });

    it('should handle text trimming', async () => {
      // This test verifies the service trims whitespace
      const text = '  hello world  ';
      const language = 'english';
      
      // Mock the audio generator to avoid actual TTS calls in tests
      const mockGenerator = {
        generateAudio: jest.fn().mockResolvedValue('/tmp/test-app-data/audio/hello_world.aiff'),
        playAudio: jest.fn().mockResolvedValue(undefined),
        stopAudio: jest.fn(),
        audioExists: jest.fn().mockResolvedValue(true)
      };
      
      const service = new AudioService(mockGenerator);
      await service.generateAudio(text, language);
      
      expect(mockGenerator.generateAudio).toHaveBeenCalledWith('hello world', 'english', undefined, undefined, undefined, undefined);
    });
  });

  describe('audioExists', () => {
    it('should handle invalid paths gracefully', async () => {
      const result = await audioService.audioExists('');
      expect(result).toBe(false);
    });
  });

  describe('batch operations', () => {
    it('should generate audio for multiple texts', async () => {
      const mockGenerator = {
        generateAudio: jest.fn()
          .mockResolvedValueOnce('/tmp/test-app-data/audio/hello.aiff')
          .mockResolvedValueOnce('/tmp/test-app-data/audio/world.aiff'),
        playAudio: jest.fn().mockResolvedValue(undefined),
        stopAudio: jest.fn(),
        audioExists: jest.fn().mockResolvedValue(true)
      };
      
      const service = new AudioService(mockGenerator);
      const results = await service.generateBatchAudio(['hello', 'world'], 'english');
      
      expect(results).toEqual(['hello.aiff', 'world.aiff']);
      expect(mockGenerator.generateAudio).toHaveBeenCalledTimes(2);
    });
  });
});
