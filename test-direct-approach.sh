#!/bin/bash

echo "=== Testing Direct Array Approach ==="

# Try the most direct possible approach
DIRECT_PROMPT='[
{"word": "pan", "translation": "bread", "frequency": "high"},
{"word": "agua", "translation": "water", "frequency": "high"},
{"word": "comer", "translation": "to eat", "frequency": "medium"}
]

Now create a similar JSON array with 3 different Spanish food words:'

cat > /tmp/direct_request.json << EOF
{
  "model": "granite4:tiny-h",
  "prompt": $(echo "$DIRECT_PROMPT" | jq -R -s '.'),
  "stream": false,
  "format": "json"
}
EOF

echo "Direct prompt:"
echo "$DIRECT_PROMPT"
echo

RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/direct_request.json)

echo "Response:"
echo "$RESPONSE" | jq -r '.response'
echo

# Try with system message approach
echo "=== Testing System Message Approach ==="

SYSTEM_PROMPT='You are a JSON generator. You only respond with valid JSON arrays. Generate 3 Spanish food words in this format:
[{"word":"spanish_word","translation":"english","frequency":"high|medium|low"}]'

cat > /tmp/system_request.json << EOF
{
  "model": "granite4:tiny-h",
  "prompt": $(echo "$SYSTEM_PROMPT" | jq -R -s '.'),
  "stream": false,
  "format": "json"
}
EOF

RESPONSE2=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/system_request.json)

echo "System approach response:"
echo "$RESPONSE2" | jq -r '.response'
echo

# Try with explicit array instruction
echo "=== Testing Explicit Array Instruction ==="

ARRAY_PROMPT='Generate a JSON array (not object) containing exactly 3 items. Each item should be a Spanish food word with English translation and frequency. Start with [ and end with ].'

cat > /tmp/array_request.json << EOF
{
  "model": "granite4:tiny-h",
  "prompt": $(echo "$ARRAY_PROMPT" | jq -R -s '.'),
  "stream": false,
  "format": "json"
}
EOF

RESPONSE3=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/array_request.json)

echo "Array instruction response:"
echo "$RESPONSE3" | jq -r '.response'