# Stanza Lemmatization Service

A FastAPI service that wraps Stanza for lemmatization functionality.

## Setup

This service uses `uv` for Python package management and requires Python 3.10.

### Install uv (if not already installed)

```bash
# On macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or with pip
pip install uv
```

### Setup the project

```bash
# Navigate to the lemmatization directory
cd src/main/lemmatization

# Install Python 3.10 and dependencies with uv
uv python install 3.10
uv sync
```

This will:
1. Install Python 3.10 using uv (if not already available)
2. Create a virtual environment
3. Install all dependencies specified in `pyproject.toml`

### Run the service

```bash
# Using uv
uv run python stanza-service.py

# Or activate the virtual environment and run directly
uv venv --python 3.10
source .venv/bin/activate  # On macOS/Linux
# or
.venv\Scripts\activate  # On Windows
python stanza-service.py
```

The service will start on `http://127.0.0.1:8888` by default.

## Endpoints

- `GET /status` - Get service status and list of loaded models
- `POST /load_model` - Load a Stanza model for a given language
- `POST /lemmatize_words` - Lemmatize a list of words

## Language Support

The service supports the following languages:
- Spanish (`es`)
- Italian (`it`)
- Portuguese (`pt`)
- Polish (`pl`)
- Indonesian (`id`)

