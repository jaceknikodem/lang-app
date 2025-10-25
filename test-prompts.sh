#!/bin/bash

# Test script to check Ollama prompts directly with curl

echo "=== Testing Ollama Prompts with curl ==="
echo

# First, check if Ollama is running
echo "1. Checking if Ollama is available..."
curl -s http://localhost:11434/api/tags > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Ollama is running"
else
    echo "❌ Ollama is not running on localhost:11434"
    exit 1
fi

echo

# Test word generation prompt
echo "2. Testing word generation prompt..."
echo "Prompt being sent:"
echo "---"

WORD_PROMPT='CRITICAL: You must return exactly 3 words in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.

Task: Generate exactly 3 different Spanish words related to "food".

Expected output format (3 items):
[
  {"word": "spanish_word1", "translation": "english_translation1", "frequency": "high"},
  {"word": "spanish_word2", "translation": "english_translation2", "frequency": "medium"},
  {"word": "spanish_word3", "translation": "english_translation3", "frequency": "low"}
]

Rules:
1. Must be exactly 3 words
2. Each word must be different and unique
3. All words should relate to "food"
4. Include nouns, verbs, and adjectives
5. Use frequency values: "high", "medium", or "low"
6. Return ONLY the JSON array, nothing else'

echo "$WORD_PROMPT"
echo "---"
echo

echo "Sending request to Ollama..."

# Create a proper JSON payload file to avoid escaping issues
cat > /tmp/ollama_request.json << EOF
{
  "model": "granite4:tiny-h",
  "prompt": $(echo "$WORD_PROMPT" | jq -R -s '.'),
  "stream": false,
  "format": "json"
}
EOF

echo "Request payload:"
cat /tmp/ollama_request.json | jq '.'
echo

RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/ollama_request.json)

echo "Raw Ollama response:"
echo "$RESPONSE" | jq '.'
echo

echo "Extracted response field:"
echo "$RESPONSE" | jq -r '.response'
echo

echo "Trying to parse as JSON:"
PARSED_RESPONSE=$(echo "$RESPONSE" | jq -r '.response' | jq '.' 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Valid JSON response:"
    echo "$PARSED_RESPONSE"
    
    # Count items in array
    ITEM_COUNT=$(echo "$PARSED_RESPONSE" | jq 'length' 2>/dev/null)
    echo "Number of items: $ITEM_COUNT"
else
    echo "❌ Invalid JSON response"
fi

echo
echo "=== Test Complete ==="