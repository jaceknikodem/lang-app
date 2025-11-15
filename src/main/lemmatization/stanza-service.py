#!/usr/bin/env python3
"""
FastAPI service wrapping Stanza for lemmatization
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import stanza
import sys
from wordfreq import zipf_frequency

app = FastAPI(title="Stanza Lemmatization Service")

# Enable CORS for localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model storage
models: Dict[str, stanza.Pipeline] = {}

# Map app language names to Stanza language codes
LANGUAGE_CODE_MAP = {
    'spanish': 'es',
    'italian': 'it',
    'portuguese': 'pt',
    'polish': 'pl',
    'indonesian': 'id',
    # Also handle ISO codes directly
    'es': 'es',
    'it': 'it',
    'pt': 'pt',
    'pl': 'pl',
    'id': 'id'
}

def map_language_to_code(language: str) -> str:
    """Convert app language name to Stanza language code"""
    normalized = language.lower().strip()
    return LANGUAGE_CODE_MAP.get(normalized, 'es')  # Default to Spanish


def removeIndonesianPossessiveSuffix(word: str) -> str:
    """Remove common Indonesian possessive suffixes (-nya, -ku, -mu) from a word.
    
    Only strips suffixes when the word is long enough after removal.
    Returns the stripped word or original if no suffix found.
    """
    if word.endswith('nya') and len(word) > 3:
        # tagihannya -> tagihan
        return word[:-3]
    elif word.endswith('ku') and len(word) > 2:
        # bukuku -> buku
        return word[:-2]
    elif word.endswith('mu') and len(word) > 2:
        # bukumu -> buku
        return word[:-2]
    return word


class LoadModelRequest(BaseModel):
    language: str


class LemmatizeWordsRequest(BaseModel):
    words: List[str]
    language: str


class StatusResponse(BaseModel):
    status: str
    loaded_models: List[str]
    service: str


class LemmatizeWordsResponse(BaseModel):
    lemmas: Dict[str, str]  # word -> lemma mapping


class FreqWordRequest(BaseModel):
    words: List[str]
    language: str


class FreqWordResponse(BaseModel):
    frequencies: Dict[str, float]  # word -> zipf_frequency


@app.get("/status", response_model=StatusResponse)
async def get_status():
    """Get service status and list of loaded models"""
    print(f"[Lemmatization] Status check: {len(models)} model(s) loaded: {list(models.keys())}")
    return {
        "status": "running",
        "loaded_models": list(models.keys()),
        "service": "stanza-lemmatization"
    }


@app.post("/load_model")
async def load_model(request: LoadModelRequest):
    """Load a Stanza model for the given language"""
    try:
        language_code = map_language_to_code(request.language)
        
        # Check if model is already loaded
        if language_code in models:
            print(f"[Lemmatization] Model for {language_code} ({request.language}) is already loaded, skipping")
            return {
                "status": "already_loaded",
                "language": language_code,
                "message": f"Model for {language_code} ({request.language}) is already loaded"
            }
        
        # Download and load the model
        print(f"[Lemmatization] Loading Stanza model for language: {language_code} ({request.language})")
        pipeline = stanza.Pipeline(
            lang=language_code,
            processors='tokenize,lemma',
            verbose=False,
            use_gpu=False  # Set to True if GPU available
        )
        
        models[language_code] = pipeline
        print(f"[Lemmatization] Successfully loaded model for {language_code} ({request.language})")
        
        return {
            "status": "loaded",
            "language": language_code,
            "message": f"Model for {language_code} ({request.language}) loaded successfully"
        }
    except Exception as e:
        print(f"[Lemmatization] Failed to load model for {request.language}: {str(e)}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load model for {request.language}: {str(e)}"
        )


@app.post("/lemmatize_words", response_model=LemmatizeWordsResponse)
async def lemmatize_words(request: LemmatizeWordsRequest):
    """Lemmatize a list of words"""
    try:
        language_code = map_language_to_code(request.language)
        print(f"[Lemmatization] Received lemmatize_words request: {len(request.words)} words for {language_code} ({request.language})")
        print(f"[Lemmatization] Words to lemmatize: {', '.join(request.words[:10])}{'...' if len(request.words) > 10 else ''}")
        
        # Check if model is loaded, if not, load it automatically
        if language_code not in models:
            print(f"[Lemmatization] Model for {language_code} not loaded, loading automatically...")
            try:
                # Download and load the model
                print(f"[Lemmatization] Loading Stanza model for language: {language_code} ({request.language})")
                pipeline = stanza.Pipeline(
                    lang=language_code,
                    processors='tokenize,lemma',
                    verbose=False,
                    use_gpu=False  # Set to True if GPU available
                )
                models[language_code] = pipeline
                print(f"[Lemmatization] Successfully loaded model for {language_code} ({request.language})")
            except Exception as e:
                print(f"[Lemmatization] Failed to load model for {request.language}: {str(e)}", file=sys.stderr)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load model for {request.language}: {str(e)}"
                )
        else:
            pipeline = models[language_code]
        lemmas: Dict[str, str] = {}
        
        # Process words (can batch process multiple words)
        # Create a simple sentence with the words for processing
        text = ' '.join(request.words)
        
        if not text.strip():
            return {"lemmas": {}}
        
        print(f"[Lemmatization] Processing text: {text[:100]}{'...' if len(text) > 100 else ''}")
        doc = pipeline(text)
        
        # Extract lemmas from the document
        lemma_map: Dict[str, str] = {}
        for sentence in doc.sentences:
            for word in sentence.words:
                original_text = word.text.lower()
                lemma = word.lemma.lower() if word.lemma else original_text
                
                # Indonesian-specific post-processing: strip possessive suffixes
                # when Stanza didn't lemmatize (lemma == original)
                if language_code == 'id' and lemma == original_text:
                    lemma = removeIndonesianPossessiveSuffix(lemma)
                
                # Store both original and lemma, but prefer lemma
                if original_text not in lemma_map:
                    lemma_map[original_text] = lemma
        
        # Map each requested word to its lemma and log the mapping
        for word in request.words:
            word_lower = word.lower().strip()
            # Try to find lemma in the map
            lemma = lemma_map.get(word_lower, word_lower)
            lemmas[word] = lemma
            
        print(f"[Lemmatization] Lemma mappings: {', '.join([f'{w}={l}' for w, l in list(lemmas.items())[:10]])}{'...' if len(lemmas) > 10 else ''}")
        return {"lemmas": lemmas}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to lemmatize words: {str(e)}"
        )


@app.post("/freqword", response_model=FreqWordResponse)
async def freqword(request: FreqWordRequest):
    """Get Zipf frequencies for a list of words"""
    try:
        language_code = map_language_to_code(request.language)
        print(f"[Lemmatization] Received freqword request: {len(request.words)} words for {language_code} ({request.language})")
        
        frequencies: Dict[str, float] = {}
        
        for word in request.words:
            try:
                # zipf_frequency returns 0.0 if word not found, which is expected behavior
                zipf_freq = zipf_frequency(word, language_code)
                frequencies[word] = zipf_freq
            except Exception as e:
                # If wordfreq doesn't support the language or word, return 0.0
                print(f"[Lemmatization] Error getting frequency for word '{word}': {str(e)}", file=sys.stderr)
                frequencies[word] = 0.0
        
        print(f"[Lemmatization] Frequency mappings: {', '.join([f'{w}={f:.2f}' for w, f in list(frequencies.items())[:10]])}{'...' if len(frequencies) > 10 else ''}")
        return {"frequencies": frequencies}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Lemmatization] Failed to get word frequencies: {str(e)}", file=sys.stderr)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get word frequencies: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("STANZA_PORT", "8888"))
    uvicorn.run(app, host="127.0.0.1", port=port)


