#!/bin/bash
set -e  # Exit on any error

# Save the script's directory (where bootstrap.sh is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Starting bootstrap setup..."

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Check if Whisper is installed
echo -e "\n${YELLOW}Checking for Whisper (whisper-cpp)...${NC}"
if command_exists whisper-server; then
    echo -e "${GREEN}✓ Whisper (whisper-cpp) is already installed${NC}"
else
    echo -e "${YELLOW}Whisper not found. Installing via Homebrew...${NC}"
    if ! command_exists brew; then
        echo -e "${RED}✗ Homebrew is not installed. Please install Homebrew first: https://brew.sh${NC}"
        exit 1
    fi
    brew install whisper-cpp
    echo -e "${GREEN}✓ Whisper (whisper-cpp) installed successfully${NC}"
fi

# 2. Check if Ollama is installed
echo -e "\n${YELLOW}Checking for Ollama...${NC}"
if command_exists ollama; then
    echo -e "${GREEN}✓ Ollama is already installed${NC}"
else
    echo -e "${YELLOW}Ollama not found. Installing via Homebrew...${NC}"
    if ! command_exists brew; then
        echo -e "${RED}✗ Homebrew is not installed. Please install Homebrew first: https://brew.sh${NC}"
        exit 1
    fi
    brew install ollama
    echo -e "${GREEN}✓ Ollama installed successfully${NC}"
fi

# 2.5. Check if Ollama model is downloaded
echo -e "\n${YELLOW}Checking for Ollama model (granite4:tiny-h)...${NC}"
if command_exists ollama; then
    # Check if model is already pulled (this may fail if service isn't running, which is okay)
    MODEL_EXISTS=false
    if ollama list 2>/dev/null | grep -q "granite4:tiny-h"; then
        MODEL_EXISTS=true
    fi
    
    if [ "$MODEL_EXISTS" = true ]; then
        echo -e "${GREEN}✓ Ollama model (granite4:tiny-h) is already downloaded${NC}"
    else
        echo -e "${YELLOW}Ollama model not found. Downloading granite4:tiny-h...${NC}"
        echo -e "${YELLOW}  Note: This may take a few minutes depending on your internet connection${NC}"
        echo -e "${YELLOW}  Note: Ollama service will be started automatically if needed${NC}"
        if ollama pull granite4:tiny-h; then
            echo -e "${GREEN}✓ Ollama model (granite4:tiny-h) downloaded successfully${NC}"
        else
            echo -e "${YELLOW}⚠ Failed to download Ollama model. You can download it later with: ollama pull granite4:tiny-h${NC}"
            echo -e "${YELLOW}   Make sure Ollama service is running: ollama serve${NC}"
            echo -e "${YELLOW}   Continuing with setup...${NC}"
        fi
    fi
else
    echo -e "${YELLOW}⚠ Ollama not available, skipping model download${NC}"
fi

# 2.6. Start Ollama server
echo -e "\n${YELLOW}Starting Ollama server...${NC}"
OLLAMA_PORT=11434
OLLAMA_URL="http://127.0.0.1:${OLLAMA_PORT}"

# Check if port is already in use
if command_exists lsof && lsof -ti:${OLLAMA_PORT} > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port ${OLLAMA_PORT} is already in use. Assuming Ollama is running.${NC}"
    OLLAMA_RUNNING=true
elif command_exists ollama; then
    echo -e "${YELLOW}Starting Ollama server on port ${OLLAMA_PORT}...${NC}"
    nohup ollama serve > /tmp/ollama-service.log 2>&1 &
    OLLAMA_PID=$!
    OLLAMA_RUNNING=false
    
    # Wait for service to be ready (max 30 seconds)
    echo -e "${YELLOW}Waiting for Ollama to start...${NC}"
    for i in {1..30}; do
        if curl -s -f "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
            OLLAMA_RUNNING=true
            echo -e "${GREEN}✓ Ollama server started (PID: $OLLAMA_PID)${NC}"
            break
        fi
        sleep 1
    done
    
    if [ "$OLLAMA_RUNNING" = false ]; then
        echo -e "${YELLOW}⚠ Failed to start Ollama server or it's taking longer than expected${NC}"
        echo -e "${YELLOW}   Check logs at: /tmp/ollama-service.log${NC}"
        echo -e "${YELLOW}   You can start it manually later with: ollama serve${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Ollama not available, skipping server start${NC}"
fi

# 3. Check if models exist
echo -e "\n${YELLOW}Checking for Whisper models...${NC}"
# Models are stored in Electron userData directory
# Determine platform-specific userData path
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    MODELS_DIR="${HOME}/Library/Application Support/KotobaAI/models"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    MODELS_DIR="${HOME}/.config/KotobaAI/models"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows
    MODELS_DIR="${APPDATA}/KotobaAI/models"
else
    # Fallback to macOS path
    MODELS_DIR="${HOME}/Library/Application Support/KotobaAI/models"
fi

if [ ! -d "$MODELS_DIR" ]; then
    echo -e "${YELLOW}Creating models directory: ${MODELS_DIR}${NC}"
    mkdir -p "$MODELS_DIR"
fi

# Check if any Whisper model exists (any ggml-*.bin file)
EXISTING_MODEL=$(find "$MODELS_DIR" -maxdepth 1 -name "ggml-*.bin" -type f | head -n 1)

if [ -n "$EXISTING_MODEL" ]; then
    MODEL_NAME=$(basename "$EXISTING_MODEL")
    echo -e "${GREEN}✓ Whisper model found: ${MODEL_NAME}${NC}"
else
    # No model found, download a default one (small model for quick setup)
    echo -e "${YELLOW}No Whisper model found. Downloading default model (ggml-small.bin)...${NC}"
    echo -e "${YELLOW}  Note: You can download larger models later for better accuracy${NC}"
    echo -e "${YELLOW}  Destination: ${MODELS_DIR}/ggml-small.bin${NC}"
    
    MODEL_FILE="${MODELS_DIR}/ggml-small.bin"
    MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
    
    if command_exists curl; then
        curl -L -o "$MODEL_FILE" "$MODEL_URL"
    elif command_exists wget; then
        wget -O "$MODEL_FILE" "$MODEL_URL"
    else
        echo -e "${RED}✗ Neither curl nor wget is available. Please install one of them.${NC}"
        exit 1
    fi
    
    if [ -f "$MODEL_FILE" ]; then
        echo -e "${GREEN}✓ Whisper model downloaded successfully${NC}"
    else
        echo -e "${RED}✗ Failed to download Whisper model${NC}"
        exit 1
    fi
fi

# 4. Check if uv is installed
echo -e "\n${YELLOW}Checking for uv...${NC}"
if command_exists uv; then
    echo -e "${GREEN}✓ uv is already installed${NC}"
else
    echo -e "${YELLOW}uv not found. Installing uv...${NC}"
    if ! command_exists curl; then
        echo -e "${RED}✗ curl is not available. Please install curl first.${NC}"
        exit 1
    fi
    curl -LsSf https://astral.sh/uv/install.sh | sh
    
    # Add uv to PATH if it was just installed (for current session)
    if [ -f "$HOME/.cargo/bin/uv" ]; then
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
    
    # Verify installation
    if command_exists uv; then
        echo -e "${GREEN}✓ uv installed successfully${NC}"
    else
        echo -e "${YELLOW}⚠ uv was installed but may not be in PATH for this session.${NC}"
        echo -e "${YELLOW}   Please restart your terminal or run: export PATH=\"\$HOME/.cargo/bin:\$PATH\"${NC}"
    fi
fi

# 5. Run uv sync
echo -e "\n${YELLOW}Running uv sync...${NC}"
LEMMATIZATION_DIR="$SCRIPT_DIR/src/main/lemmatization"

if [ ! -d "$LEMMATIZATION_DIR" ]; then
    echo -e "${RED}✗ Lemmatization directory not found: $LEMMATIZATION_DIR${NC}"
    exit 1
fi

# Ensure we have uv in PATH for this script
if [ -f "$HOME/.cargo/bin/uv" ] && ! command_exists uv; then
    export PATH="$HOME/.cargo/bin:$PATH"
fi

cd "$LEMMATIZATION_DIR"
if uv sync; then
    echo -e "${GREEN}✓ uv sync completed successfully${NC}"
else
    echo -e "${RED}✗ uv sync failed${NC}"
    exit 1
fi

# 6. Start lemmatization service and download all models
echo -e "\n${YELLOW}Starting lemmatization service...${NC}"
STANZA_PORT=8888
STANZA_URL="http://127.0.0.1:${STANZA_PORT}"

# Check if port is already in use
if command_exists lsof && lsof -ti:${STANZA_PORT} > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port ${STANZA_PORT} is already in use. Assuming service is running.${NC}"
    SERVICE_RUNNING=true
else
    echo -e "${YELLOW}Starting lemmatization service on port ${STANZA_PORT}...${NC}"
    cd "$LEMMATIZATION_DIR"
    nohup uv run python stanza-service.py > /tmp/stanza-service.log 2>&1 &
    STANZA_PID=$!
    SERVICE_RUNNING=false
    
    # Wait for service to be ready (max 30 seconds)
    echo -e "${YELLOW}Waiting for service to start...${NC}"
    for i in {1..30}; do
        if curl -s -f "${STANZA_URL}/status" > /dev/null 2>&1; then
            SERVICE_RUNNING=true
            echo -e "${GREEN}✓ Lemmatization service started (PID: $STANZA_PID)${NC}"
            break
        fi
        sleep 1
    done
    
    if [ "$SERVICE_RUNNING" = false ]; then
        echo -e "${RED}✗ Failed to start lemmatization service${NC}"
        echo -e "${YELLOW}   Check logs at: /tmp/stanza-service.log${NC}"
        exit 1
    fi
fi

# 7. Download all Stanza models by loading them
echo -e "\n${YELLOW}Downloading Stanza models...${NC}"
LANGUAGES=("es:Spanish" "it:Italian" "pt:Portuguese" "pl:Polish" "id:Indonesian")

for lang_pair in "${LANGUAGES[@]}"; do
    IFS=':' read -r lang_code lang_name <<< "$lang_pair"
    echo -e "${YELLOW}Loading ${lang_name} (${lang_code}) model (this will download if needed)...${NC}"
    
    # Make POST request to load_model endpoint
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${STANZA_URL}/load_model" \
        -H "Content-Type: application/json" \
        -d "{\"language\": \"${lang_code}\"}" 2>/dev/null || echo -e "\n000")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ]; then
        # Check if it was already loaded or newly loaded
        if echo "$BODY" | grep -q "already_loaded"; then
            echo -e "${GREEN}✓ ${lang_name} (${lang_code}) model already loaded${NC}"
        else
            echo -e "${GREEN}✓ ${lang_name} (${lang_code}) model downloaded and loaded${NC}"
        fi
    else
        echo -e "${RED}✗ Failed to load ${lang_name} (${lang_code}) model (HTTP ${HTTP_CODE})${NC}"
        if [ "$SERVICE_RUNNING" = true ] && [ -z "$STANZA_PID" ]; then
            # Service was already running, don't exit
            echo -e "${YELLOW}   Service was already running - may need manual intervention${NC}"
        else
            exit 1
        fi
    fi
done

if [ -n "$STANZA_PID" ]; then
    echo -e "\n${YELLOW}Lemmatization service is running (PID: $STANZA_PID)${NC}"
    echo -e "${YELLOW}   Logs available at: /tmp/stanza-service.log${NC}"
    echo -e "${YELLOW}   To stop the service: kill $STANZA_PID${NC}"
fi

if [ -n "$OLLAMA_PID" ]; then
    echo -e "\n${YELLOW}Ollama server is running (PID: $OLLAMA_PID)${NC}"
    echo -e "${YELLOW}   Logs available at: /tmp/ollama-service.log${NC}"
    echo -e "${YELLOW}   To stop the service: kill $OLLAMA_PID${NC}"
fi

echo -e "\n${GREEN}✅ Bootstrap setup completed successfully!${NC}"
echo -e "${GREEN}You can now run 'npm run dev' to start the application.${NC}"

