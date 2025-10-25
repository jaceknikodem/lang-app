/**
 * Simple test script to verify LLM word generation
 */

const { OllamaClient } = require('./dist/main/main/llm/ollama-client.js');
const { ContentGenerator } = require('./dist/main/main/llm/content-generator.js');

async function testWordGeneration() {
  console.log('Testing LLM word generation...');
  
  try {
    const client = new OllamaClient();
    const generator = new ContentGenerator(client);
    
    // Test 1: General vocabulary (empty topic)
    console.log('\n1. Testing general vocabulary generation...');
    const generalWords = await generator.generateTopicVocabulary(undefined, 'Spanish', 5);
    console.log(`Generated ${generalWords.length} general words:`, generalWords);
    
    // Test 2: Topic-specific vocabulary
    console.log('\n2. Testing topic-specific vocabulary generation...');
    const topicWords = await generator.generateTopicVocabulary('food', 'Spanish', 3);
    console.log(`Generated ${topicWords.length} food-related words:`, topicWords);
    
    // Test 3: Empty string topic (should be treated as general)
    console.log('\n3. Testing empty string topic...');
    const emptyTopicWords = await generator.generateTopicVocabulary('', 'Spanish', 2);
    console.log(`Generated ${emptyTopicWords.length} words for empty topic:`, emptyTopicWords);
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testWordGeneration();