#!/bin/bash

echo "=== Testing Simpler Prompt ==="

SIMPLE_PROMPT='Return exactly this JSON array with 3 Spanish food words:
[
{"word":"manzana","translation":"apple","frequency":"high"},
{"word":"queso","translation":"cheese","frequency":"medium"},
{"word":"cocinar","translation":"to cook","frequency":"low"}
]'

cat > /tmp/simple_request.json << EOF
{
  "model": "qwen3:8b",
  "prompt": $(echo "$SIMPLE_PROMPT" | jq -R -s '.'),
  "stream": false,
  "format": "json"
}
EOF

echo "Simple prompt:"
echo "$SIMPLE_PROMPT"
echo

RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/simple_request.json)

echo "Response:"
echo "$RESPONSE" | jq -r '.response'
echo

# Test an even more direct approach
echo "=== Testing Ultra-Direct Prompt ==="

ULTRA_SIMPLE='[{"word":"pan","translation":"bread","frequency":"high"},{"word":"agua","translation":"water","frequency":"high"},{"word":"comer","translation":"to eat","frequency":"medium"}]'

cat > /tmp/ultra_request.json << EOF
{
  "model": "qwen3:8b",
  "prompt": "Copy this exact JSON: $ULTRA_SIMPLE",
  "stream": false,
  "format": "json"
}
EOF

RESPONSE2=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/ultra_request.json)

echo "Ultra-simple response:"
echo "$RESPONSE2" | jq -r '.response'