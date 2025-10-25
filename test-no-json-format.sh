#!/bin/bash

echo "=== Testing WITHOUT format: json constraint ==="

PROMPT='Generate exactly 3 Spanish food words as a JSON array:
[
  {"word": "manzana", "translation": "apple", "frequency": "high"},
  {"word": "queso", "translation": "cheese", "frequency": "medium"},
  {"word": "cocinar", "translation": "to cook", "frequency": "low"}
]

Now generate 3 different Spanish food words in the same format:'

cat > /tmp/no_format_request.json << EOF
{
  "model": "granite4:tiny-h",
  "prompt": $(echo "$PROMPT" | jq -R -s '.'),
  "stream": false
}
EOF

echo "Prompt:"
echo "$PROMPT"
echo

echo "Request (without format constraint):"
cat /tmp/no_format_request.json | jq '.'
echo

RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/no_format_request.json)

echo "Response:"
echo "$RESPONSE" | jq -r '.response'
echo

# Also test with explicit array schema
echo "=== Testing with explicit array schema ==="

ARRAY_SCHEMA_PROMPT='Return a JSON array (list) of 3 Spanish food words. The response must start with [ and end with ]. Each item should have word, translation, and frequency fields.'

cat > /tmp/array_schema_request.json << EOF
{
  "model": "granite4:tiny-h",
  "prompt": $(echo "$ARRAY_SCHEMA_PROMPT" | jq -R -s '.'),
  "stream": false
}
EOF

RESPONSE2=$(curl -s -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d @/tmp/array_schema_request.json)

echo "Array schema response:"
echo "$RESPONSE2" | jq -r '.response'