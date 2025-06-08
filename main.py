import os
import dotenv
import json
import logging
from datetime import datetime
from typing import List, Dict, Any
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

# Constants
MAX_HISTORY_LENGTH = 10

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

# Cache for conversation history
conversation_history: List[Dict[str, str]] = []

def get_relevant_history(history: List[Dict[str, str]], max_length: int = MAX_HISTORY_LENGTH) -> List[Dict[str, str]]:
    """Get relevant conversation history."""
    if not history:
        return []
    return history[-max_length:] if len(history) > max_length else history

def answer_query(message: str, chat_history: List[Dict[str, str]]) -> str:
    """Process user query and generate response using GROQ."""
    try:
        # Get relevant history
        relevant_history = get_relevant_history(chat_history)
        
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
        
        return response.content

    except Exception as e:
        logger.error(f"Error in answer_query: {str(e)}", exc_info=True)
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
            logger.error("Chat endpoint: No message provided")
            return jsonify({'error': 'No message provided'}), 400
            
        user_message = data.get('message').strip()
        logger.info(f"Chat endpoint: Processing message: {user_message[:50]}...")
        
        try:
            # Get response from LLM
            response_text = answer_query(user_message, conversation_history)
            
            if not response_text:
                logger.error("Chat endpoint: No response generated")
                return jsonify({'error': 'No response generated'}), 500

            logger.info("Chat endpoint: Successfully generated response")
            return Response(response_text, content_type='text/plain')
            
        except Exception as inner_e:
            logger.error(f"Chat processing error: {str(inner_e)}", exc_info=True)
            return jsonify({'error': f'Failed to process chat: {str(inner_e)}'}), 500
    
    except Exception as e:
        logger.error(f"Chat endpoint error: {str(e)}", exc_info=True)
        return jsonify({'error': f'Server error: {str(e)}'}), 500

if __name__ == '__main__':
    logger.info("Starting Flask server...")
    app.run(debug=False, port=5001, threaded=True)