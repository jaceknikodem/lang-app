import { AudioService } from '../../src/main/audio/audio-service';
import { TTSAudioGenerator } from '../../src/main/audio/audio-generator';

describe('Audio Service', () => {
  let audioService: AudioService;

  beforeEach(() => {
    audioService = new AudioService();
  });

  describe('generateAudio', () => {
    it('should validate input parameters', async () => {
      await expect(audioService.generateAudio('', 'english')).rejects.toThrow('Text must be a non-empty string');
      await expect(audioService.generateAudio('hello', '')).rejects.toThrow('Language must be specified');
    });

    it('should handle text trimming', async () => {
      // This test verifies the service trims whitespace
      const text = '  hello world  ';
      const language = 'english';
      
      // Mock the audio generator to avoid actual TTS calls in tests
      const mockGenerator = {
        generateAudio: jest.fn().mockResolvedValue('audio/hello_world.aiff'),
        playAudio: jest.fn().mockResolvedValue(undefined),
        audioExists: jest.fn().mockResolvedValue(true)
      };
      
      const service = new AudioService(mockGenerator);
      await service.generateAudio(text, language);
      
      expect(mockGenerator.generateAudio).toHaveBeenCalledWith('hello world', 'english');
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
          .mockResolvedValueOnce('audio/hello.aiff')
          .mockResolvedValueOnce('audio/world.aiff'),
        playAudio: jest.fn().mockResolvedValue(undefined),
        audioExists: jest.fn().mockResolvedValue(true)
      };
      
      const service = new AudioService(mockGenerator);
      const results = await service.generateBatchAudio(['hello', 'world'], 'english');
      
      expect(results).toEqual(['audio/hello.aiff', 'audio/world.aiff']);
      expect(mockGenerator.generateAudio).toHaveBeenCalledTimes(2);
    });
  });
});