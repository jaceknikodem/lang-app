#!/bin/bash
set -e  # Exit on any error

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

# 2. Check if models exist
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

# 3. Check if uv is installed
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

# 4. Run uv sync
echo -e "\n${YELLOW}Running uv sync...${NC}"
LEMMATIZATION_DIR="src/main/lemmatization"

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

echo -e "\n${GREEN}✅ Bootstrap setup completed successfully!${NC}"
echo -e "${GREEN}You can now run 'npm run dev' to start the application.${NC}"

