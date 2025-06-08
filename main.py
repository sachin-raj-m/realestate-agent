import os
import dotenv
import json
import logging
import hashlib
import time
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
from langchain_groq import ChatGroq
from langchain.prompts.chat import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from flask import Flask, request, jsonify, Response, render_template
from flask_cors import CORS

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

# Initialize LLM model at startup
try:
    llm = ChatGroq(groq_api_key=GROQ_API_KEY, model_name="llama3-70b-8192")
    logger.info("Successfully initialized Groq LLM")
except Exception as e:
    logger.error(f"Failed to initialize Groq LLM: {e}")
    raise

# Cache for conversation history
conversation_history: List[Dict[str, str]] = []

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

if __name__ == '__main__':
    logger.info("Starting Flask server...")
    app.run(debug=False, port=5001, threaded=True)