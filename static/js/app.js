document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const avatar = document.getElementById('avatar');
    
    let currentAudio = null;
    let isSpeaking = false;
    const PLAYBACK_RATE = 1.5;
    const audioCache = new Map();

    function addMessage(text, isUser) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function stopSpeaking() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.remove();
            currentAudio = null;
        }
        avatar.classList.remove('speaking');
        stopButton.disabled = true;
        isSpeaking = false;
    }

    // Function to get cached audio URL
    function getCachedAudioUrl(text) {
        const cacheKey = text.trim();
        return audioCache.get(cacheKey);
    }

    // Function to cache audio URL
    function cacheAudioUrl(text, url) {
        const cacheKey = text.trim();
        audioCache.set(cacheKey, url);
        
        // Limit cache size to prevent memory issues
        if (audioCache.size > 50) {
            const firstKey = audioCache.keys().next().value;
            audioCache.delete(firstKey);
        }
    }

    async function handleSpeech(text) {
        try {
            // Stop any currently playing audio
            stopSpeaking();

            // Start avatar animation
            avatar.classList.add('speaking');
            isSpeaking = true;
            stopButton.disabled = false;

            // Check cache first
            const cachedUrl = getCachedAudioUrl(text);
            if (cachedUrl) {
                currentAudio = new Audio(cachedUrl);
            } else {
                // Get audio from TTS endpoint
                const response = await fetch('/tts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text }),
                });

                if (!response.ok) {
                    throw new Error('TTS request failed');
                }

                const blob = await response.blob();
                const audioUrl = URL.createObjectURL(blob);
                
                // Cache the audio URL
                cacheAudioUrl(text, audioUrl);
                
                // Create audio element
                currentAudio = new Audio(audioUrl);
            }

            // Set up audio properties
            currentAudio.playbackRate = PLAYBACK_RATE;

            // Set up event listeners
            currentAudio.addEventListener('ended', () => {
                stopSpeaking();
                if (!cachedUrl) {
                    URL.revokeObjectURL(currentAudio.src);
                }
            });

            currentAudio.addEventListener('error', (e) => {
                console.error('Audio playback error:', e);
                stopSpeaking();
                if (!cachedUrl) {
                    URL.revokeObjectURL(currentAudio.src);
                }
            });

            // Play the audio
            await currentAudio.play();
        } catch (error) {
            console.error('Error playing audio:', error);
            stopSpeaking();
        }
    }

    async function sendMessage() {
        const message = userInput.value.trim().toLowerCase();
        if (!message) return;

        // Disable input while processing
        userInput.value = '';
        userInput.disabled = true;
        sendButton.disabled = true;

        try {
            // Check if it's a stop command
            if (message === 'stop') {
                stopSpeaking();
                addMessage(message, true);
                addMessage('Speech stopped.', false);
                return;
            }

            // Add user message
            addMessage(message, true);

            // Send message to chat endpoint
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            if (!response.ok) {
                throw new Error('Chat request failed');
            }

            const assistantResponse = await response.text();
            
            // Add assistant message
            addMessage(assistantResponse, false);
            
            // Play TTS response
            await handleSpeech(assistantResponse);
        } catch (error) {
            console.error('Error:', error);
            addMessage('Sorry, there was an error processing your request.', false);
        } finally {
            // Re-enable input
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