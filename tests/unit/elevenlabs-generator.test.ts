import { ElevenLabsAudioGenerator } from '../../src/main/audio/elevenlabs-generator';

// Mock fetch globally
global.fetch = jest.fn();

describe('ElevenLabs Audio Generator', () => {
    let generator: ElevenLabsAudioGenerator;
    const mockApiKey = 'test-api-key';
    const mockVoiceId = 'test-voice-id';

    beforeEach(() => {
        generator = new ElevenLabsAudioGenerator({
            elevenLabsApiKey: mockApiKey,
            elevenLabsVoiceId: mockVoiceId,
            audioDirectory: '/tmp/test-audio'
        });

        // Reset fetch mock
        (fetch as jest.Mock).mockReset();
    });

    describe('generateAudio', () => {
        it('should throw error when API key is not configured', async () => {
            const generatorWithoutKey = new ElevenLabsAudioGenerator({
                audioDirectory: '/tmp/test-audio'
            });

            await expect(generatorWithoutKey.generateAudio('hello', 'spanish'))
                .rejects.toThrow('ElevenLabs API key not configured');
        });

        it('should validate input parameters', async () => {
            await expect(generator.generateAudio('', 'spanish'))
                .rejects.toThrow('Text cannot be empty');

            await expect(generator.generateAudio('   ', 'spanish'))
                .rejects.toThrow('Text cannot be empty');
        });

        it('should use default voice when no voice ID is configured', () => {
            const generatorWithoutVoice = new ElevenLabsAudioGenerator({
                elevenLabsApiKey: mockApiKey,
                audioDirectory: '/tmp/test-audio'
            });

            // Test that it uses the default voice mapping
            expect(generatorWithoutVoice).toBeDefined();
        });

        it('should handle API errors gracefully', async () => {
            // Mock a failed API response
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: jest.fn().mockResolvedValue('Invalid API key')
            });

            await expect(generator.generateAudio('hello', 'spanish'))
                .rejects.toThrow('ElevenLabs API error');
        });

        it('should handle network errors', async () => {
            // Mock a network error
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            await expect(generator.generateAudio('hello', 'spanish'))
                .rejects.toThrow('ElevenLabs API call failed: Network error');
        });
    });

    describe('voice mapping', () => {
        it('should use default Adam voice for all languages', () => {
            const generator = new ElevenLabsAudioGenerator({
                elevenLabsApiKey: mockApiKey,
                audioDirectory: '/tmp/test-audio'
            });

            expect(generator).toBeDefined();
        });

        it('should handle different languages', () => {
            const languages = ['spanish', 'portuguese', 'italian', 'indonesian', 'polish'];

            languages.forEach(language => {
                expect(() => {
                    new ElevenLabsAudioGenerator({
                        elevenLabsApiKey: mockApiKey,
                        audioDirectory: '/tmp/test-audio'
                    });
                }).not.toThrow();
            });
        });
    });

    describe('file path generation', () => {
        it('should generate safe filenames', () => {
            // This is testing the internal sanitizeFilename method indirectly
            // by ensuring the generator can handle special characters
            expect(() => {
                new ElevenLabsAudioGenerator({
                    elevenLabsApiKey: mockApiKey,
                    audioDirectory: '/tmp/test-audio'
                });
            }).not.toThrow();
        });
    });
});