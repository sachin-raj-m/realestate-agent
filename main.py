import os
import dotenv
import json
import logging
import pickle
import hashlib
import time
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
from langchain_groq import ChatGroq
from langchain.prompts.chat import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from flask import Flask, request, jsonify, send_file, Response, render_template
from flask_cors import CORS
from gtts import gTTS, gTTSError
import tempfile
import threading
from queue import Queue
from functools import lru_cache
import base64
import io
from time import sleep
from threading import Lock

# Configure logging with more detail
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Load environment variables
dotenv.load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable is not set")

# Constants
MAX_HISTORY_LENGTH = 10
CACHE_EXPIRY = 86400
MAX_CACHE_SIZE = 1000

# Create necessary directories
os.makedirs("tts_cache", exist_ok=True)

# Global variables with type hints
user_context: Dict[str, Any] = {
    "property_type": "Apartment",
    "preferred_areas": ["Dubai Marina", "Downtown Dubai", "Palm Jumeirah"],
    "budget_range": {"min": 500000, "max": 2000000},
    "bedrooms": "2",
    "purpose": "Buy",
    "amenities": ["Swimming Pool", "Gym", "Parking"]
}

# Initialize LLM model at startup
try:
    llm = ChatGroq(groq_api_key=GROQ_API_KEY, model_name="llama3-70b-8192")
    logger.info("Successfully initialized Groq LLM")
except Exception as e:
    logger.error(f"Failed to initialize Groq LLM: {e}")
    raise

# Cache for conversation history and responses
conversation_history: List[Dict[str, str]] = []
response_cache: Dict[str, Tuple[str, float]] = {}

# Rate limiting configuration
RATE_LIMIT_WINDOW = 60  # seconds
MAX_REQUESTS = 100  # maximum requests per window
request_timestamps = []
rate_limit_lock = Lock()

def is_rate_limited():
    """Check if we're currently rate limited."""
    current_time = time.time()
    with rate_limit_lock:
        # Remove timestamps older than the window
        while request_timestamps and request_timestamps[0] < current_time - RATE_LIMIT_WINDOW:
            request_timestamps.pop(0)
        
        # Check if we're at the limit
        if len(request_timestamps) >= MAX_REQUESTS:
            return True
        
        # Add current timestamp
        request_timestamps.append(current_time)
        return False

def answer_query(message: str, chat_history: List[Dict[str, str]]) -> str:
    """Process user query and generate response using GROQ."""
    try:
        # Get relevant history
        relevant_history = get_relevant_history_context(message, chat_history)
        
        # Create system prompt
        system_template = """You are a knowledgeable Dubai real estate assistant. Your goal is to help users find properties 
        that match their requirements and provide detailed information about Dubai's real estate market.

        User Preferences:
        Property Type: {property_type}
        Preferred Areas: {preferred_areas}
        Budget Range: {budget_min} - {budget_max} AED
        Bedrooms: {bedrooms}
        Purpose: {purpose}
        Desired Amenities: {amenities}

        Current Time: {current_time}

        When responding:
        1. Be professional and informative about Dubai real estate
        2. Consider the user's preferences and budget
        3. Provide specific details about areas and property types
        4. Include relevant market insights
        5. Suggest similar areas when appropriate
        6. Keep responses concise but informative. keep it to one or two paragraph maximum.
        7. If you don't know something specific, tell that.

        Previous conversation context:
        {history}
        """
        
        # Format history
        history_text = "\n".join([f"{msg['role']}: {msg['content']}" for msg in relevant_history])
        
        # Current time
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Create prompt
        system_message = SystemMessagePromptTemplate.from_template(system_template)
        human_message = HumanMessagePromptTemplate.from_template("{query}")
        chat_prompt = ChatPromptTemplate.from_messages([system_message, human_message])
        
        # Format prompt with all required variables
        prompt = chat_prompt.format_prompt(
            query=message,
            property_type=user_context["property_type"],
            preferred_areas=", ".join(user_context["preferred_areas"]),
            budget_min=user_context["budget_range"]["min"],
            budget_max=user_context["budget_range"]["max"],
            bedrooms=user_context["bedrooms"],
            purpose=user_context["purpose"],
            amenities=", ".join(user_context["amenities"]),
            history=history_text,
            current_time=current_time
        )
        
        # Get response from LLM
        logger.info(f"Sending request to Groq LLM for message: {message[:50]}...")
        response = llm.invoke(input=prompt.to_messages())
        logger.info("Successfully received response from Groq LLM")
        
        # Update conversation history
        chat_history.append({"role": "user", "content": message})
        chat_history.append({"role": "assistant", "content": response.content})
        
        # Trim history if needed
        if len(chat_history) > MAX_HISTORY_LENGTH * 2:
            chat_history = chat_history[-MAX_HISTORY_LENGTH * 2:]
        
        # Return just the response content
        return response.content

    except Exception as e:
        logger.error(f"Error in answer_query: {str(e)}", exc_info=True)
        raise

def get_cached_response(message: str, context_hash: str) -> Optional[str]:
    """Get cached response with LRU caching."""
    try:
        cache_key = generate_cache_key(message, context_hash)
        if cache_key in response_cache:
            response, timestamp = response_cache[cache_key]
            if time.time() - timestamp < CACHE_EXPIRY:
                logger.info(f"Cache hit for query: {message[:30]}...")
                return response
            del response_cache[cache_key]
        return None
    except Exception as e:
        logger.error(f"Error in get_cached_response: {e}")
        return None

def get_relevant_history_context(query: str, history: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Get relevant conversation history with optimized length."""
    if not history:
        return []
    return history[-MAX_HISTORY_LENGTH:] if len(history) > MAX_HISTORY_LENGTH else history

def generate_cache_key(message: str, context_hash: str) -> str:
    """Generate cache key efficiently."""
    return hashlib.md5(f"{message.lower().strip()}_{context_hash}".encode('utf-8')).hexdigest()

def generate_speech(text: str) -> str:
    """Generate speech using gTTS and return the file path."""
    try:
        # Create a unique filename
        filename = f"{hashlib.md5(text.encode()).hexdigest()}.mp3"
        filepath = os.path.join("tts_cache", filename)
        
        # Generate speech if not in cache
        if not os.path.exists(filepath):
            tts = gTTS(text=text, lang='en', slow=False)
            tts.save(filepath)
        
        return filepath
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        raise

@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat_endpoint():
    """Chat endpoint that returns plain text response."""
    try:
        data = request.json
        if not data or not data.get('message', '').strip():
            return 'No message provided', 400
            
        user_message = data.get('message').strip()
        
        # Get response from LLM
        response_text = answer_query(user_message, conversation_history)
        
        if not response_text:
            return 'No response generated', 500

        return Response(response_text, content_type='text/plain')
    
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        return str(e), 500

@app.route('/tts', methods=['POST'])
def tts_endpoint():
    """TTS endpoint that returns audio data as base64."""
    try:
        data = request.json
        if not data or not data.get('text', '').strip():
            logger.error("TTS endpoint: No text provided in request")
            return jsonify({'error': 'No text provided'}), 400
            
        text = data.get('text').strip()
        logger.info(f"TTS endpoint: Processing text of length {len(text)}")

        # Check cache first
        cached_audio = get_cached_audio(text)
        if cached_audio:
            logger.info("TTS endpoint: Returning cached audio")
            return jsonify({
                'audio': cached_audio,
                'content_type': 'audio/mpeg',
                'cached': True
            })

        try:
            # Create an in-memory bytes buffer
            mp3_fp = io.BytesIO()
            
            # Generate speech directly to the buffer
            logger.info("TTS endpoint: Initializing gTTS")
            tts = gTTS(text=text, lang='en', slow=False)
            
            logger.info("TTS endpoint: Writing to buffer")
            tts.write_to_fp(mp3_fp)
            mp3_fp.seek(0)
            
            # Read the audio data
            audio_data = mp3_fp.read()
            
            # Cache the audio data
            cache_audio(text, audio_data)
            
            # Convert to base64
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            logger.info(f"TTS endpoint: Successfully processed. Base64 length: {len(audio_base64)}")
            return jsonify({
                'audio': audio_base64,
                'content_type': 'audio/mpeg',
                'cached': False
            })
            
        except gTTSError as e:
            logger.error(f"gTTS error: {str(e)}", exc_info=True)
            return jsonify({'error': f'Text-to-speech conversion failed. Please try again.'}), 500
            
        except Exception as inner_e:
            logger.error(f"TTS endpoint inner error: {str(inner_e)}", exc_info=True)
            return jsonify({'error': f'An unexpected error occurred. Please try again.'}), 500
    
    except Exception as e:
        logger.error(f"TTS endpoint outer error: {str(e)}", exc_info=True)
        return jsonify({'error': f'Server error: {str(e)}'}), 500

def get_cache_path(text: str) -> str:
    """Generate a cache file path for the given text."""
    text_hash = hashlib.md5(text.encode()).hexdigest()
    return os.path.join("tts_cache", f"{text_hash}.mp3")

def get_cached_audio(text: str) -> Optional[str]:
    """Get cached audio as base64 if it exists."""
    cache_path = get_cache_path(text)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'rb') as f:
                audio_data = f.read()
                return base64.b64encode(audio_data).decode('utf-8')
        except Exception as e:
            logger.error(f"Error reading cache file: {e}")
    return None

def cache_audio(text: str, audio_data: bytes) -> None:
    """Cache audio data to file."""
    try:
        cache_path = get_cache_path(text)
        with open(cache_path, 'wb') as f:
            f.write(audio_data)
    except Exception as e:
        logger.error(f"Error writing cache file: {e}")

if __name__ == '__main__':
    logger.info("Starting Flask server...")
    app.run(debug=False, port=5001, threaded=True)