document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const avatar = document.getElementById('avatar');
    
    let currentUtterance = null;
    let isSpeaking = false;
    const SPEECH_RATE = 1.1;  // Slightly faster than normal

    // Initialize speech synthesis
    const synth = window.speechSynthesis;
    let preferredVoice = null;

    // Get available voices and set preferred voice
    function loadVoices() {
        const voices = synth.getVoices();
        // Try to find a female English voice
        preferredVoice = voices.find(voice => 
            voice.lang.includes('en') && 
            voice.name.toLowerCase().includes('female')
        ) || voices.find(voice => 
            voice.lang.includes('en')  // Fallback to any English voice
        ) || voices[0];  // Fallback to any voice
    }

    // Load voices when they're available
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }
    loadVoices();

    function addMessage(text, isUser) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function stopSpeaking() {
        if (synth.speaking) {
            synth.cancel();
        }
        if (currentUtterance) {
            currentUtterance = null;
        }
        avatar.classList.remove('speaking');
        stopButton.disabled = true;
        isSpeaking = false;
    }

    async function handleSpeech(text) {
        try {
            stopSpeaking();
            
            avatar.classList.add('speaking');
            isSpeaking = true;
            stopButton.disabled = false;

            // Create and configure speech utterance
            currentUtterance = new SpeechSynthesisUtterance(text);
            currentUtterance.voice = preferredVoice;
            currentUtterance.rate = SPEECH_RATE;
            currentUtterance.pitch = 1.0;

            // Set up event listeners
            currentUtterance.onend = () => {
                stopSpeaking();
            };

            currentUtterance.onerror = (e) => {
                console.error('Speech synthesis error:', e);
                stopSpeaking();
                addMessage('⚠️ Speech synthesis failed. Please try again.', false);
            };

            // Start speaking
            synth.speak(currentUtterance);

        } catch (error) {
            console.error('Error in handleSpeech:', error);
            stopSpeaking();
            addMessage(`⚠️ Speech Error: ${error.message}`, false);
        }
    }

    async function sendMessage() {
        const message = userInput.value.trim().toLowerCase();
        if (!message) return;

        userInput.value = '';
        userInput.disabled = true;
        sendButton.disabled = true;

        try {
            if (message === 'stop') {
                stopSpeaking();
                addMessage(message, true);
                addMessage('Speech stopped.', false);
                return;
            }

            addMessage(message, true);

            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            const contentType = response.headers.get('content-type');
            let responseData;

            if (contentType && contentType.includes('application/json')) {
                responseData = await response.json();
                throw new Error(responseData.error || 'Unknown error occurred');
            } else {
                responseData = await response.text();
            }

            if (!response.ok) {
                throw new Error('Failed to get response from server');
            }

            addMessage(responseData, false);
            await handleSpeech(responseData);

        } catch (error) {
            console.error('Error:', error);
            addMessage(`⚠️ Error: ${error.message}`, false);
        } finally {
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        }
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    stopButton.addEventListener('click', stopSpeaking);

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopSpeaking();
        }
    });

    // Initial focus
    userInput.focus();
}); 