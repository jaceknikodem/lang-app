/**
 * Unit tests for prompt generation methods in BaseLLMClient
 */

import { BaseLLMClient } from '../../src/main/llm/base-llm-client';

// Create a test subclass to expose protected methods
class TestLLMClient extends BaseLLMClient {
  // Expose protected methods for testing
  public testCreateTopicWordsPrompt(
    topic: string,
    language: string,
    count: number,
    existingWords: string[] = [],
    proficiencyLevel?: string
  ): string {
    return this.createTopicWordsPrompt(topic, language, count, existingWords, proficiencyLevel);
  }

  public testCreateSentencesPrompt(
    word: string,
    language: string,
    count: number,
    knownWords: string[] = [],
    topic?: string,
    proficiencyLevel?: string
  ): string {
    return this.createSentencesPrompt(word, language, count, knownWords, topic, proficiencyLevel);
  }

  public testCreateContextSentencesPrompt(
    sentence: string,
    translation: string,
    language: string
  ): string {
    return this.createContextSentencesPrompt(sentence, translation, language);
  }

  public testCreateDialogueVariantPrompt(
    triggerSentence: string,
    triggerTranslation: string,
    language: string,
    knownWords: string[],
    count: number
  ): string {
    return this.createDialogueVariantPrompt(
      triggerSentence,
      triggerTranslation,
      language,
      knownWords,
      count
    );
  }

  public testCreateFollowUpPrompt(
    conversationHistory: string[],
    language: string,
    proficiencyLevel?: string
  ): string {
    return this.createFollowUpPrompt(conversationHistory, language, proficiencyLevel);
  }

  // Abstract method implementation (not used in tests)
  protected async makeRequest(_prompt: string, _model?: string): Promise<any> {
    throw new Error('Not implemented in test class');
  }

  // Implement abstract generateResponse method
  protected async generateResponse(_prompt: string, _model?: string): Promise<string> {
    throw new Error('Not implemented in test class');
  }
}

describe('BaseLLMClient Prompt Generation', () => {
  let client: TestLLMClient;

  beforeEach(() => {
    client = new TestLLMClient();
  });

  describe('createTopicWordsPrompt', () => {
    it('should generate prompt with basic parameters', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3);

      expect(prompt).toContain('Generate exactly 3 different Spanish words related to "food"');
      expect(prompt).toContain('CRITICAL: You must return exactly 3 words');
      expect(prompt).toContain('Return ONLY the JSON array');
    });

    it('should include exclusion list when existing words provided', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, ['hola', 'casa']);

      expect(prompt).toContain('Do NOT include any of these existing words: hola, casa');
    });

    it('should not include exclusion text when no existing words', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, []);

      expect(prompt).not.toContain('Do NOT include any of these existing words');
    });

    it('should truncate long exclusion lists to 50 words', () => {
      const existingWords = Array.from({ length: 60 }, (_, i) => `word${i}`);
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, existingWords);

      expect(prompt).toContain('word49');
      expect(prompt).toContain('...');
      expect(prompt).not.toContain('word50');
    });

    it('should include proficiency level guidance for newbie', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, [], 'newbie');

      expect(prompt).toContain("user's proficiency level is NEWBIE");
      expect(prompt).toContain('Use everyday words appropriate for NEWBIE level');
    });

    it('should include proficiency level guidance for a1', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, [], 'a1');

      expect(prompt).toContain("user's proficiency level is A1");
      expect(prompt).toContain('Use everyday words appropriate for A1 level');
    });

    it('should include proficiency level guidance for a2', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, [], 'a2');

      expect(prompt).toContain("user's proficiency level is A2");
      expect(prompt).toContain('Use everyday words appropriate for A2 level');
    });

    it('should include proficiency level guidance for b1', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3, [], 'b1');

      expect(prompt).toContain("user's proficiency level is B1");
      expect(prompt).toContain('Use everyday words appropriate for B1 level');
    });

    it('should not include proficiency text when not provided', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3);

      expect(prompt).not.toContain("user's proficiency level");
    });

    it('should handle empty topic string', () => {
      const prompt = client.testCreateTopicWordsPrompt('', 'Spanish', 3);

      expect(prompt).toContain('related to ""');
    });

    it('should include canonical dictionary form instructions', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3);

      expect(prompt).toContain('canonical dictionary form');
      expect(prompt).toContain('Verbs: infinitive form');
      expect(prompt).toContain('Nouns: singular form');
      expect(prompt).toContain('Adjectives: base form');
    });

    it('should include correct example format', () => {
      const prompt = client.testCreateTopicWordsPrompt('food', 'Spanish', 3);

      expect(prompt).toContain('"word": "spanish_word1", "translation": "english_translation1"');
    });
  });

  describe('createSentencesPrompt', () => {
    it('should generate prompt with basic parameters', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3);

      expect(prompt).toContain(
        "Generate exactly 3 natural, conversational sentences in Spanish using the word 'hola'"
      );
      expect(prompt).toContain('CRITICAL: You must return exactly 3 sentences');
      expect(prompt).toContain('Return ONLY the JSON array');
    });

    it('should include known words guidance when provided', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3, ['casa', 'perro']);

      expect(prompt).toContain('When possible, try to include some of these known words');
      expect(prompt).toContain('casa, perro');
    });

    it('should not include known words text when empty', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3, []);

      expect(prompt).not.toContain('When possible, try to include some of these known words');
    });

    it('should include topic guidance when provided', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3, [], 'food');

      expect(prompt).toContain(
        'All sentences should relate to or be contextually relevant to the topic: "food"'
      );
    });

    it('should not include topic text when not provided', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3);

      expect(prompt).not.toContain(
        'All sentences should relate to or be contextually relevant to the topic'
      );
    });

    it('should include proficiency level guidance for newbie', () => {
      const prompt = client.testCreateSentencesPrompt(
        'hola',
        'Spanish',
        3,
        [],
        undefined,
        'newbie'
      );

      expect(prompt).toContain("user's proficiency level is NEWBIE");
      expect(prompt).toContain('presente (ser/estar/tener/haber/ir/hacer + regular verbs)');
    });

    it('should include proficiency level guidance for a1', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3, [], undefined, 'a1');

      expect(prompt).toContain("user's proficiency level is A1");
      expect(prompt).toContain('presente (all persons)');
    });

    it('should include proficiency level guidance for a2', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3, [], undefined, 'a2');

      expect(prompt).toContain("user's proficiency level is A2");
      expect(prompt).toContain('pretérito perfecto compuesto');
    });

    it('should include proficiency level guidance for b1', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3, [], undefined, 'b1');

      expect(prompt).toContain("user's proficiency level is B1");
      expect(prompt).toContain('pretérito imperfecto and pretérito indefinido');
    });

    it('should include context sentence format in example', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3);

      expect(prompt).toContain('contextBefore');
      expect(prompt).toContain('contextAfter');
      expect(prompt).toContain('contextBeforeTranslation');
      expect(prompt).toContain('contextAfterTranslation');
    });

    it('should include word usage instructions', () => {
      const prompt = client.testCreateSentencesPrompt('hola', 'Spanish', 3);

      expect(prompt).toContain("Each sentence must contain the word 'hola'");
      expect(prompt).toContain('canonical dictionary form');
    });

    it('should handle word with special characters', () => {
      const prompt = client.testCreateSentencesPrompt('niño', 'Spanish', 3);

      expect(prompt).toContain("using the word 'niño'");
    });
  });

  describe('createContextSentencesPrompt', () => {
    it('should generate prompt with sentence and translation', () => {
      const prompt = client.testCreateContextSentencesPrompt(
        'Hola, ¿cómo estás?',
        'Hello, how are you?',
        'Spanish'
      );

      expect(prompt).toContain('Sentence in Spanish: "Hola, ¿cómo estás?"');
      expect(prompt).toContain('English translation: "Hello, how are you?"');
    });

    it('should include context sentence format', () => {
      const prompt = client.testCreateContextSentencesPrompt('Hola', 'Hello', 'Spanish');

      expect(prompt).toContain('contextBefore');
      expect(prompt).toContain('contextAfter');
      expect(prompt).toContain('contextBeforeTranslation');
      expect(prompt).toContain('contextAfterTranslation');
    });

    it('should include rules about context sentences', () => {
      const prompt = client.testCreateContextSentencesPrompt('Hola', 'Hello', 'Spanish');

      expect(prompt).toContain('Context sentences should be short (3-10 words each)');
      expect(prompt).toContain('form a natural conversation or narrative flow');
      expect(prompt).toContain('[contextBefore] [given sentence] [contextAfter]');
    });

    it('should handle different languages', () => {
      const prompt = client.testCreateContextSentencesPrompt('Bonjour', 'Hello', 'French');

      expect(prompt).toContain('Sentence in French: "Bonjour"');
    });

    it('should require JSON object format', () => {
      const prompt = client.testCreateContextSentencesPrompt('Hola', 'Hello', 'Spanish');

      expect(prompt).toContain('Return ONLY a JSON object');
    });
  });

  describe('createDialogueVariantPrompt', () => {
    it('should generate prompt with trigger sentence and count', () => {
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'Spanish',
        [],
        3
      );

      expect(prompt).toContain('Generate exactly 3 diverse Spanish response sentence(s)');
      expect(prompt).toContain('Trigger sentence: "¿Cómo estás?"');
      expect(prompt).toContain('Trigger translation: "How are you?"');
    });

    it('should include known words when provided', () => {
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'Spanish',
        ['hola', 'casa', 'perro'],
        3
      );

      expect(prompt).toContain('Use words from this list when possible: hola, casa, perro');
    });

    it('should not include known words text when empty', () => {
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'Spanish',
        [],
        3
      );

      expect(prompt).not.toContain('Use words from this list when possible');
    });

    it('should truncate known words to 20', () => {
      const knownWords = Array.from({ length: 25 }, (_, i) => `word${i}`);
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'Spanish',
        knownWords,
        3
      );

      expect(prompt).toContain('word19');
      expect(prompt).not.toContain('word20');
    });

    it('should include example format for count', () => {
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'Spanish',
        [],
        3
      );

      expect(prompt).toContain('"sentence": "spanish_response_1"');
      expect(prompt).toContain('"sentence": "spanish_response_2"');
      expect(prompt).toContain('"sentence": "spanish_response_3"');
    });

    it('should include diversity requirements', () => {
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'Spanish',
        [],
        3
      );

      expect(prompt).toContain('DIFFERENT from the others');
      expect(prompt).toContain('diverse options');
      expect(prompt).toContain('vary in wording, structure, or approach');
    });

    it('should capitalize language name', () => {
      const prompt = client.testCreateDialogueVariantPrompt(
        '¿Cómo estás?',
        'How are you?',
        'spanish',
        [],
        3
      );

      expect(prompt).toContain('Spanish response');
    });
  });

  describe('createFollowUpPrompt', () => {
    it('should generate prompt with conversation history', () => {
      const prompt = client.testCreateFollowUpPrompt(['Hola mundo', 'Hello world'], 'Spanish');

      expect(prompt).toContain('1. Hola mundo');
      expect(prompt).toContain('2. Hello world');
    });

    it('should specify continuation requirements', () => {
      const prompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish');

      // Default proficiency level returns 2 sentences
      expect(prompt).toContain('Generate a natural continuation of about 2 sentences');
      expect(prompt).toContain('NOT be a question');
      expect(prompt).toContain('Continue the thought or provide related context');
    });

    it('should vary sentence count based on proficiency level', () => {
      // Test newbie - 1 sentence
      const newbiePrompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish', 'newbie');
      expect(newbiePrompt).toContain('Generate a natural continuation of about 1 sentence');

      // Test a1 - 2 sentences
      const a1Prompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish', 'a1');
      expect(a1Prompt).toContain('Generate a natural continuation of about 2 sentences');

      // Test a2 - 3 sentences
      const a2Prompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish', 'a2');
      expect(a2Prompt).toContain('Generate a natural continuation of about 3 sentences');

      // Test b1 - 4 sentences
      const b1Prompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish', 'b1');
      expect(b1Prompt).toContain('Generate a natural continuation of about 4 sentences');
    });

    it('should require both language text and translation', () => {
      const prompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish');

      expect(prompt).toContain('You must return BOTH the Spanish text AND its English translation');
    });

    it('should include preferred JSON format', () => {
      const prompt = client.testCreateFollowUpPrompt(['Hola'], 'Spanish');

      expect(prompt).toContain('"text": "Spanish continuation text here"');
      expect(prompt).toContain('"translation": "English translation here"');
    });

    it('should capitalize language name', () => {
      const prompt = client.testCreateFollowUpPrompt(['Hola'], 'spanish');

      expect(prompt).toContain('Spanish conversation');
      expect(prompt).toContain('Spanish');
    });

    it('should handle different languages', () => {
      const prompt = client.testCreateFollowUpPrompt(['Bonjour'], 'French');

      expect(prompt).toContain('French conversation');
      expect(prompt).toContain('French continuation');
    });
  });
});
