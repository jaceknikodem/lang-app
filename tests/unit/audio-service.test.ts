import { AudioService } from '../../src/main/audio/audio-service';
import { TTSAudioGenerator } from '../../src/main/audio/audio-generator';
import { ElevenLabsAudioGenerator } from '../../src/main/audio/elevenlabs-generator';
import type { RecordingSession, RecordingOptions } from '../../src/main/audio/audio-recorder';
import type { TranscriptionOptions, TranscriptionResult } from '../../src/main/audio/speech-recognition';

// Mock Electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app-data')
  }
}));

// Mock AudioRecorder
jest.mock('../../src/main/audio/audio-recorder', () => {
  return {
    AudioRecorder: jest.fn().mockImplementation(() => ({
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      cancelRecording: jest.fn(),
      getCurrentSession: jest.fn(),
      isRecording: jest.fn(),
      getAvailableDevices: jest.fn(),
      deleteRecording: jest.fn(),
      getRecordingInfo: jest.fn()
    }))
  };
});

// Mock SpeechRecognitionService
jest.mock('../../src/main/audio/speech-recognition', () => {
  return {
    SpeechRecognitionService: jest.fn().mockImplementation(() => ({
      initialize: jest.fn(),
      transcribeAudio: jest.fn(),
      compareTranscription: jest.fn(),
      isServerAvailable: jest.fn()
    }))
  };
});

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
      expect(mockGenerator.generateAudio).toHaveBeenCalledWith('hello', undefined, undefined, undefined, undefined, undefined, undefined);
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
      
      expect(mockGenerator.generateAudio).toHaveBeenCalledWith('hello world', 'english', undefined, undefined, undefined, undefined, undefined);
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

    it('should handle partial failures in batch generation', async () => {
      const mockGenerator = {
        generateAudio: jest.fn()
          .mockResolvedValueOnce('/tmp/test-app-data/audio/hello.aiff')
          .mockRejectedValueOnce(new Error('Generation failed'))
          .mockResolvedValueOnce('/tmp/test-app-data/audio/world.aiff'),
        playAudio: jest.fn().mockResolvedValue(undefined),
        stopAudio: jest.fn(),
        audioExists: jest.fn().mockResolvedValue(true)
      };
      
      const service = new AudioService(mockGenerator);
      const results = await service.generateBatchAudio(['hello', 'fail', 'world'], 'english');
      
      expect(results).toEqual(['hello.aiff', '', 'world.aiff']);
      expect(mockGenerator.generateAudio).toHaveBeenCalledTimes(3);
    });
  });

  describe('recording methods', () => {
    let mockRecorder: any;

    beforeEach(() => {
      // Get the mocked AudioRecorder instance
      const { AudioRecorder } = require('../../src/main/audio/audio-recorder');
      audioService = new AudioService();
      // Get the instance created in constructor
      mockRecorder = (audioService as any).audioRecorder;
    });

    describe('startRecording', () => {
      it('should start recording successfully', async () => {
        const mockSession: RecordingSession = {
          id: 'test-session-1',
          filePath: '/tmp/test-app-data/recordings/test.wav',
          isRecording: true,
          startTime: Date.now()
        };

        mockRecorder.startRecording.mockResolvedValue(mockSession);

        const result = await audioService.startRecording();

        expect(result).toEqual(mockSession);
        expect(mockRecorder.startRecording).toHaveBeenCalledWith(undefined);
      });

      it('should start recording with options', async () => {
        const options: RecordingOptions = {
          sampleRate: 44100,
          channels: 2,
          threshold: 0.3
        };
        const mockSession: RecordingSession = {
          id: 'test-session-2',
          filePath: '/tmp/test-app-data/recordings/test2.wav',
          isRecording: true,
          startTime: Date.now()
        };

        mockRecorder.startRecording.mockResolvedValue(mockSession);

        const result = await audioService.startRecording(options);

        expect(result).toEqual(mockSession);
        expect(mockRecorder.startRecording).toHaveBeenCalledWith(options);
      });

      it('should handle sox missing error', async () => {
        const error = new Error('sox command not found');
        mockRecorder.startRecording.mockRejectedValue(error);

        await expect(audioService.startRecording()).rejects.toThrow('Audio recording requires sox');
      });

      it('should handle generic recording errors', async () => {
        const error = new Error('Recording failed');
        mockRecorder.startRecording.mockRejectedValue(error);

        await expect(audioService.startRecording()).rejects.toThrow('Failed to start recording');
      });
    });

    describe('stopRecording', () => {
      it('should stop recording successfully', async () => {
        const mockSession: RecordingSession = {
          id: 'test-session-1',
          filePath: '/tmp/test-app-data/recordings/test.wav',
          isRecording: false,
          startTime: Date.now(),
          duration: 5000
        };

        mockRecorder.stopRecording.mockResolvedValue(mockSession);

        const result = await audioService.stopRecording();

        expect(result).toEqual(mockSession);
        expect(mockRecorder.stopRecording).toHaveBeenCalled();
      });

      it('should return null when no recording is active', async () => {
        mockRecorder.stopRecording.mockResolvedValue(null);

        const result = await audioService.stopRecording();

        expect(result).toBeNull();
      });

      it('should handle errors when stopping recording', async () => {
        const error = new Error('Stop failed');
        mockRecorder.stopRecording.mockRejectedValue(error);

        await expect(audioService.stopRecording()).rejects.toThrow('Failed to stop recording');
      });
    });

    describe('cancelRecording', () => {
      it('should cancel recording successfully', async () => {
        mockRecorder.cancelRecording.mockResolvedValue(undefined);

        await audioService.cancelRecording();

        expect(mockRecorder.cancelRecording).toHaveBeenCalled();
      });

      it('should handle errors when canceling recording', async () => {
        const error = new Error('Cancel failed');
        mockRecorder.cancelRecording.mockRejectedValue(error);

        await expect(audioService.cancelRecording()).rejects.toThrow('Failed to cancel recording');
      });
    });

    describe('getCurrentRecordingSession', () => {
      it('should return current recording session', () => {
        const mockSession: RecordingSession = {
          id: 'test-session-1',
          filePath: '/tmp/test-app-data/recordings/test.wav',
          isRecording: true,
          startTime: Date.now()
        };

        mockRecorder.getCurrentSession.mockReturnValue(mockSession);

        const result = audioService.getCurrentRecordingSession();

        expect(result).toEqual(mockSession);
        expect(mockRecorder.getCurrentSession).toHaveBeenCalled();
      });

      it('should return null when no recording session', () => {
        mockRecorder.getCurrentSession.mockReturnValue(null);

        const result = audioService.getCurrentRecordingSession();

        expect(result).toBeNull();
      });
    });

    describe('isRecording', () => {
      it('should return true when recording', () => {
        mockRecorder.isRecording.mockReturnValue(true);

        const result = audioService.isRecording();

        expect(result).toBe(true);
        expect(mockRecorder.isRecording).toHaveBeenCalled();
      });

      it('should return false when not recording', () => {
        mockRecorder.isRecording.mockReturnValue(false);

        const result = audioService.isRecording();

        expect(result).toBe(false);
      });
    });

    describe('getAvailableRecordingDevices', () => {
      it('should return available devices', async () => {
        const devices = ['default', 'device1', 'device2'];
        mockRecorder.getAvailableDevices.mockResolvedValue(devices);

        const result = await audioService.getAvailableRecordingDevices();

        expect(result).toEqual(devices);
        expect(mockRecorder.getAvailableDevices).toHaveBeenCalled();
      });

      it('should return default device on error', async () => {
        const error = new Error('Failed to get devices');
        mockRecorder.getAvailableDevices.mockRejectedValue(error);

        const result = await audioService.getAvailableRecordingDevices();

        expect(result).toEqual(['default']);
      });
    });

    describe('deleteRecording', () => {
      it('should delete recording successfully', async () => {
        mockRecorder.deleteRecording.mockResolvedValue(undefined);

        await audioService.deleteRecording('/tmp/test.wav');

        expect(mockRecorder.deleteRecording).toHaveBeenCalledWith('/tmp/test.wav');
      });

      it('should handle errors when deleting recording', async () => {
        const error = new Error('Delete failed');
        mockRecorder.deleteRecording.mockRejectedValue(error);

        await expect(audioService.deleteRecording('/tmp/test.wav')).rejects.toThrow('Failed to delete recording');
      });
    });

    describe('getRecordingInfo', () => {
      it('should return recording info', async () => {
        const info = { size: 1024, duration: 5000 };
        mockRecorder.getRecordingInfo.mockResolvedValue(info);

        const result = await audioService.getRecordingInfo('/tmp/test.wav');

        expect(result).toEqual(info);
        expect(mockRecorder.getRecordingInfo).toHaveBeenCalledWith('/tmp/test.wav');
      });

      it('should return null on error', async () => {
        const error = new Error('Info failed');
        mockRecorder.getRecordingInfo.mockRejectedValue(error);

        const result = await audioService.getRecordingInfo('/tmp/test.wav');

        expect(result).toBeNull();
      });
    });
  });

  describe('speech recognition methods', () => {
    let mockSpeechRecognition: any;

    beforeEach(() => {
      audioService = new AudioService();
      mockSpeechRecognition = (audioService as any).speechRecognition;
    });

    describe('initializeSpeechRecognition', () => {
      it('should initialize successfully', async () => {
        mockSpeechRecognition.initialize.mockResolvedValue(undefined);

        await audioService.initializeSpeechRecognition();

        expect(mockSpeechRecognition.initialize).toHaveBeenCalled();
      });

      it('should handle errors gracefully without throwing', async () => {
        const error = new Error('Server unavailable');
        mockSpeechRecognition.initialize.mockRejectedValue(error);

        // Should not throw - non-blocking
        await expect(audioService.initializeSpeechRecognition()).resolves.toBeUndefined();
        expect(mockSpeechRecognition.initialize).toHaveBeenCalled();
      });
    });

    describe('transcribeAudio', () => {
      it('should transcribe audio successfully', async () => {
        const mockResult: TranscriptionResult = {
          text: 'Hello world',
          language: 'en',
          confidence: 0.95
        };
        const options: TranscriptionOptions = {
          language: 'english'
        };

        mockSpeechRecognition.transcribeAudio.mockResolvedValue(mockResult);

        const result = await audioService.transcribeAudio('/tmp/test.wav', options);

        expect(result).toEqual(mockResult);
        expect(mockSpeechRecognition.transcribeAudio).toHaveBeenCalledWith('/tmp/test.wav', options);
      });

      it('should handle transcription errors', async () => {
        const error = new Error('Transcription failed');
        mockSpeechRecognition.transcribeAudio.mockRejectedValue(error);

        await expect(audioService.transcribeAudio('/tmp/test.wav', { language: 'english' })).rejects.toThrow('Failed to transcribe audio');
      });
    });

    describe('compareTranscription', () => {
      it('should compare transcription successfully', async () => {
        const mockResult = {
          similarity: 0.85,
          normalizedTranscribed: 'hello world',
          normalizedExpected: 'hello world',
          expectedWords: [{ word: 'hello', similarity: 0.9, matched: true }],
          transcribedWords: ['hello', 'world']
        };

        mockSpeechRecognition.compareTranscription.mockResolvedValue(mockResult);

        const result = await audioService.compareTranscription('hello world', 'hello world', 'A1');

        expect(result).toEqual(mockResult);
        expect(mockSpeechRecognition.compareTranscription).toHaveBeenCalledWith('hello world', 'hello world', 'A1');
      });

      it('should handle null proficiency level', async () => {
        const mockResult = {
          similarity: 0.85,
          normalizedTranscribed: 'hello',
          normalizedExpected: 'hello',
          expectedWords: [],
          transcribedWords: ['hello']
        };

        mockSpeechRecognition.compareTranscription.mockResolvedValue(mockResult);

        const result = await audioService.compareTranscription('hello', 'hello', null);

        expect(result).toEqual(mockResult);
        expect(mockSpeechRecognition.compareTranscription).toHaveBeenCalledWith('hello', 'hello', null);
      });
    });

    describe('isSpeechRecognitionReady', () => {
      it('should return true when server is available', async () => {
        mockSpeechRecognition.isServerAvailable.mockResolvedValue(true);

        const result = await audioService.isSpeechRecognitionReady();

        expect(result).toBe(true);
        expect(mockSpeechRecognition.isServerAvailable).toHaveBeenCalled();
      });

      it('should return false when server is unavailable', async () => {
        mockSpeechRecognition.isServerAvailable.mockResolvedValue(false);

        const result = await audioService.isSpeechRecognitionReady();

        expect(result).toBe(false);
      });

      it('should return false on error', async () => {
        const error = new Error('Connection failed');
        mockSpeechRecognition.isServerAvailable.mockRejectedValue(error);

        const result = await audioService.isSpeechRecognitionReady();

        expect(result).toBe(false);
      });
    });
  });

  describe('voice mapping methods', () => {
    let mockElevenLabsGenerator: any;
    let mockTTSGenerator: any;

    beforeEach(() => {
      mockElevenLabsGenerator = {
        constructor: { name: 'ElevenLabsAudioGenerator' },
        getVoiceMappings: jest.fn(),
        saveVoiceMappings: jest.fn(),
        resetVoiceMappingsToDefaults: jest.fn(),
        config: { elevenLabsModel: 'eleven_flash_v2_5' },
        getLastUsedVoiceId: jest.fn().mockReturnValue('voice-123')
      };

      mockTTSGenerator = {
        constructor: { name: 'TTSAudioGenerator' }
      };
    });

    describe('getVoiceMappings', () => {
      it('should return voice mappings when ElevenLabs is active', async () => {
        const mappings = { spanish: ['voice1', 'voice2'], italian: ['voice3'] };
        mockElevenLabsGenerator.getVoiceMappings.mockResolvedValue(mappings);

        const service = new AudioService(mockElevenLabsGenerator);
        const result = await service.getVoiceMappings();

        expect(result).toEqual(mappings);
        expect(mockElevenLabsGenerator.getVoiceMappings).toHaveBeenCalled();
      });

      it('should throw error when system TTS is active', async () => {
        const service = new AudioService(mockTTSGenerator);

        await expect(service.getVoiceMappings()).rejects.toThrow('Voice mappings are only available when ElevenLabs TTS is active');
      });
    });

    describe('saveVoiceMappings', () => {
      it('should save voice mappings when ElevenLabs is active', async () => {
        const mappings = { spanish: ['voice1', 'voice2'] };
        mockElevenLabsGenerator.saveVoiceMappings.mockResolvedValue(undefined);

        const service = new AudioService(mockElevenLabsGenerator);
        await service.saveVoiceMappings(mappings);

        expect(mockElevenLabsGenerator.saveVoiceMappings).toHaveBeenCalledWith(mappings);
      });

      it('should throw error when system TTS is active', async () => {
        const service = new AudioService(mockTTSGenerator);

        await expect(service.saveVoiceMappings({ spanish: ['voice1'] })).rejects.toThrow('Voice mappings can only be saved when ElevenLabs TTS is active');
      });
    });

    describe('resetVoiceMappingsToDefaults', () => {
      it('should reset voice mappings when ElevenLabs is active', async () => {
        mockElevenLabsGenerator.resetVoiceMappingsToDefaults.mockResolvedValue(undefined);

        const service = new AudioService(mockElevenLabsGenerator);
        await service.resetVoiceMappingsToDefaults();

        expect(mockElevenLabsGenerator.resetVoiceMappingsToDefaults).toHaveBeenCalled();
      });

      it('should throw error when system TTS is active', async () => {
        const service = new AudioService(mockTTSGenerator);

        await expect(service.resetVoiceMappingsToDefaults()).rejects.toThrow('Voice mappings can only be reset when ElevenLabs TTS is active');
      });
    });

    describe('getAudioGenerationInfo', () => {
      it('should return ElevenLabs info when ElevenLabs is active', () => {
        const service = new AudioService(mockElevenLabsGenerator);
        const info = service.getAudioGenerationInfo();

        expect(info).toEqual({
          service: 'elevenlabs',
          model: 'eleven_flash_v2_5',
          voiceId: 'voice-123'
        });
      });

      it('should return system TTS info when system TTS is active', () => {
        const service = new AudioService(mockTTSGenerator);
        const info = service.getAudioGenerationInfo();

        expect(info).toEqual({
          service: 'system-tts'
        });
      });
    });
  });

  describe('audio operations', () => {
    let mockGenerator: any;
    let mockFs: any;

    beforeEach(() => {
      mockGenerator = {
        generateAudio: jest.fn(),
        playAudio: jest.fn().mockResolvedValue(undefined),
        stopAudio: jest.fn(),
        audioExists: jest.fn().mockResolvedValue(true),
        normalizeAudioVolume: jest.fn(),
        stitchAudio: jest.fn()
      };
      mockFs = require('fs').promises;
    });

    describe('regenerateAudio', () => {
      it('should regenerate audio successfully', async () => {
        const existingPath = 'spanish/word_1/sentence_1.aiff';
        const newPath = 'spanish/word_1/sentence_1_new.aiff';
        mockGenerator.generateAudio.mockResolvedValue('/tmp/test-app-data/audio/' + newPath);
        mockGenerator.audioExists.mockResolvedValue(true);
        mockFs.unlink = jest.fn().mockResolvedValue(undefined);
        mockFs.rename = jest.fn().mockResolvedValue(undefined);

        const service = new AudioService(mockGenerator);
        const result = await service.regenerateAudio('Hello', 'spanish', 'hola', 1, 1, undefined, existingPath);

        expect(result).toBe(newPath);
        expect(mockGenerator.generateAudio).toHaveBeenCalled();
      });

      it('should restore backup on error', async () => {
        const existingPath = 'spanish/word_1/sentence_1.aiff';
        const absolutePath = '/tmp/test-app-data/audio/' + existingPath;
        const backupPath = '/tmp/test-app-data/audio/spanish/word_1/sentence_1.bak.aiff';
        mockGenerator.audioExists.mockResolvedValueOnce(true); // existing file exists
        mockFs.unlink = jest.fn().mockResolvedValue(undefined);
        mockFs.rename = jest.fn()
          .mockResolvedValueOnce(undefined) // rename to backup
          .mockResolvedValueOnce(undefined); // restore from backup
        mockGenerator.generateAudio.mockRejectedValue(new Error('Generation failed'));
        mockGenerator.audioExists.mockResolvedValueOnce(false); // new file doesn't exist

        const service = new AudioService(mockGenerator);
        await expect(service.regenerateAudio('Hello', 'spanish', 'hola', 1, 1, undefined, existingPath)).rejects.toThrow();

        // Should restore backup
        expect(mockFs.rename).toHaveBeenCalledWith(backupPath, absolutePath);
      });

      it('should handle regeneration without existing path', async () => {
        const newPath = 'spanish/word_1/sentence_1.aiff';
        mockGenerator.generateAudio.mockResolvedValue('/tmp/test-app-data/audio/' + newPath);
        mockGenerator.audioExists.mockResolvedValue(true);

        const service = new AudioService(mockGenerator);
        const result = await service.regenerateAudio('Hello', 'spanish', 'hola', 1, 1);

        expect(result).toBe(newPath);
      });
    });

    describe('normalizeAudioVolume', () => {
      it('should return null for invalid path', async () => {
        const service = new AudioService(mockGenerator);
        const result = await service.normalizeAudioVolume('', 5);

        expect(result).toBeNull();
      });

      it('should return null when file does not exist', async () => {
        mockGenerator.audioExists.mockResolvedValue(false);

        const service = new AudioService(mockGenerator);
        const result = await service.normalizeAudioVolume('test.aiff', 5);

        expect(result).toBeNull();
      });

      it('should return original path on ffmpeg error', async () => {
        mockGenerator.audioExists.mockResolvedValueOnce(true); // File exists
        mockGenerator.audioExists.mockResolvedValueOnce(false); // Normalized file doesn't exist yet
        mockGenerator.audioExists.mockResolvedValueOnce(false); // After ffmpeg fails, normalized file still doesn't exist

        // Mock execFileAsync to fail
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const execFileAsync = promisify(execFile);
        jest.spyOn(require('util'), 'promisify').mockReturnValueOnce(() => Promise.reject(new Error('ffmpeg failed')));

        const service = new AudioService(mockGenerator);
        const result = await service.normalizeAudioVolume('test.aiff', 5);

        // Should return original path on error
        expect(result).toBe('test.aiff');
      });
    });

    describe('loadAudioBase64', () => {
      it('should load audio as base64 successfully', async () => {
        const mockBuffer = Buffer.from('test audio data');
        mockFs.readFile = jest.fn().mockResolvedValue(mockBuffer);

        const service = new AudioService(mockGenerator);
        const result = await service.loadAudioBase64('test.mp3');

        expect(result).not.toBeNull();
        expect(result?.mimeType).toBe('audio/mpeg');
        expect(result?.data).toBeInstanceOf(ArrayBuffer);
      });

      it('should return null on file not found', async () => {
        const error = new Error('File not found');
        (error as any).code = 'ENOENT';
        mockFs.readFile = jest.fn().mockRejectedValue(error);

        const service = new AudioService(mockGenerator);
        const result = await service.loadAudioBase64('nonexistent.mp3');

        expect(result).toBeNull();
      });

      it('should return null for invalid path', async () => {
        const service = new AudioService(mockGenerator);
        const result = await service.loadAudioBase64('');

        expect(result).toBeNull();
      });

      it('should detect correct MIME type for different extensions', async () => {
        const mockBuffer = Buffer.from('test');
        mockFs.readFile = jest.fn().mockResolvedValue(mockBuffer);

        const service = new AudioService(mockGenerator);
        const wavResult = await service.loadAudioBase64('test.wav');
        const mp3Result = await service.loadAudioBase64('test.mp3');
        const oggResult = await service.loadAudioBase64('test.ogg');

        expect(wavResult?.mimeType).toBe('audio/wav');
        expect(mp3Result?.mimeType).toBe('audio/mpeg');
        expect(oggResult?.mimeType).toBe('audio/ogg');
      });
    });

    describe('stitchAudio', () => {
      it('should return null for empty paths', async () => {
        const service = new AudioService(mockGenerator);
        const result = await service.stitchAudio([], 'spanish');

        expect(result).toBeNull();
      });

      it('should return null when no audio files exist', async () => {
        mockGenerator.audioExists.mockResolvedValue(false);

        const service = new AudioService(mockGenerator);
        const result = await service.stitchAudio(['audio1.mp3', 'audio2.mp3'], 'spanish');

        expect(result).toBeNull();
      });

      it('should return null on ffmpeg error', async () => {
        mockGenerator.audioExists.mockResolvedValue(true);

        // Mock execFileAsync to fail
        jest.spyOn(require('util'), 'promisify').mockReturnValueOnce(() => Promise.reject(new Error('ffmpeg failed')));

        const service = new AudioService(mockGenerator);
        const result = await service.stitchAudio(['audio1.mp3'], 'spanish');

        expect(result).toBeNull();
      });
    });
  });

  describe('error handling', () => {
    let mockGenerator: any;

    beforeEach(() => {
      mockGenerator = {
        generateAudio: jest.fn(),
        playAudio: jest.fn(),
        stopAudio: jest.fn(),
        audioExists: jest.fn().mockResolvedValue(true)
      };
    });

    describe('playAudio', () => {
      it('should handle FILE_NOT_FOUND error', async () => {
        const error = new Error('File not found');
        (error as any).code = 'FILE_NOT_FOUND';
        (error as any).audioPath = '/tmp/test.aiff';
        mockGenerator.playAudio.mockRejectedValue(error);

        const service = new AudioService(mockGenerator);
        await expect(service.playAudio('test.aiff')).rejects.toThrow();
        expect((await service.playAudio('test.aiff').catch(e => e)).code).toBe('FILE_NOT_FOUND');
      });

      it('should handle PLAYBACK_STOPPED error', async () => {
        const error = new Error('Playback stopped');
        (error as any).code = 'PLAYBACK_STOPPED';
        mockGenerator.playAudio.mockRejectedValue(error);

        const service = new AudioService(mockGenerator);
        await expect(service.playAudio('test.aiff')).rejects.toThrow();
      });

      it('should handle invalid audio path', async () => {
        const service = new AudioService(mockGenerator);
        await expect(service.playAudio('')).rejects.toThrow();
        // Error is wrapped, so check for the wrapped message
        try {
          await service.playAudio('');
        } catch (error: any) {
          expect(error.message).toContain('Audio playback failed');
        }
      });

      it('should handle file not found before playback', async () => {
        mockGenerator.audioExists.mockResolvedValue(false);

        const service = new AudioService(mockGenerator);
        await expect(service.playAudio('nonexistent.aiff')).rejects.toThrow();
        try {
          await service.playAudio('nonexistent.aiff');
        } catch (error: any) {
          expect(error.code).toBe('FILE_NOT_FOUND');
        }
      });
    });
  });

  describe('static methods', () => {
    describe('getRelativeAudioPath', () => {
      it('should convert absolute path to relative', () => {
        const absolutePath = '/tmp/test-app-data/audio/spanish/word_1/sentence_1.aiff';
        const result = AudioService.getRelativeAudioPath(absolutePath);

        expect(result).toBe('spanish/word_1/sentence_1.aiff');
      });

      it('should handle relative path as-is', () => {
        const relativePath = 'spanish/word_1/sentence_1.aiff';
        const result = AudioService.getRelativeAudioPath(relativePath);

        expect(result).toBe(relativePath);
      });

      it('should remove legacy audio/ prefix', () => {
        const pathWithPrefix = 'audio/spanish/word_1.aiff';
        const result = AudioService.getRelativeAudioPath(pathWithPrefix);

        expect(result).toBe('spanish/word_1.aiff');
      });

      it('should handle Windows path separator', () => {
        const pathWithPrefix = 'audio\\spanish\\word_1.aiff';
        const result = AudioService.getRelativeAudioPath(pathWithPrefix);

        expect(result).toBe('spanish\\word_1.aiff');
      });

      it('should handle invalid path', () => {
        expect(AudioService.getRelativeAudioPath('')).toBe('');
        expect(AudioService.getRelativeAudioPath(null as any)).toBe(null);
      });
    });

    describe('resolveAudioPath', () => {
      it('should resolve relative path to absolute', () => {
        const relativePath = 'spanish/word_1.aiff';
        const result = AudioService.resolveAudioPath(relativePath);

        expect(result).toBe('/tmp/test-app-data/audio/spanish/word_1.aiff');
      });

      it('should return absolute path as-is', () => {
        const absolutePath = '/absolute/path/to/audio.aiff';
        const result = AudioService.resolveAudioPath(absolutePath);

        expect(result).toBe(absolutePath);
      });

      it('should handle Windows absolute path', () => {
        const windowsPath = 'C:\\Users\\test\\audio.aiff';
        const result = AudioService.resolveAudioPath(windowsPath);

        expect(result).toBe(windowsPath);
      });

      it('should remove legacy audio/ prefix', () => {
        const pathWithPrefix = 'audio/spanish/word_1.aiff';
        const result = AudioService.resolveAudioPath(pathWithPrefix);

        expect(result).toBe('/tmp/test-app-data/audio/spanish/word_1.aiff');
      });

      it('should handle invalid path', () => {
        expect(AudioService.resolveAudioPath('')).toBe('');
        expect(AudioService.resolveAudioPath(null as any)).toBe(null);
      });
    });
  });
});
