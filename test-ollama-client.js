#!/usr/bin/env node

/**
 * Quick test script for the improved Ollama client
 */

const { OllamaClient } = require('./dist/main/main/llm/ollama-client.js');

async function testOllamaClient() {
    console.log('Testing improved Ollama client...');

    const client = new OllamaClient({
        model: 'granite4:tiny-h', // Using granite4 model
        timeout: 15000
    });

    try {
        // Test availability
        console.log('Checking Ollama availability...');
        const isAvailable = await client.isAvailable();
        console.log('Ollama available:', isAvailable);

        if (!isAvailable) {
            console.log('Ollama is not available. Make sure it\'s running on localhost:11434');
            return;
        }

        // Test word generation
        console.log('\nTesting word generation...');
        const words = await client.generateTopicWords('food', 'Spanish', 3);
        console.log('Generated words:', JSON.stringify(words, null, 2));

        // Test sentence generation
        if (words.length > 0) {
            console.log('\nTesting sentence generation...');
            const sentences = await client.generateSentences(words[0].word, 'Spanish', 2);
            console.log('Generated sentences:', JSON.stringify(sentences, null, 2));
        }

        console.log('\n✅ All tests passed!');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.code) {
            console.error('Error code:', error.code);
        }
    }
}

testOllamaClient();