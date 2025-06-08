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
            currentAudio = null;
        }
        avatar.classList.remove('speaking');
        stopButton.disabled = true;
        isSpeaking = false;
    }

    // Function to convert base64 to audio
    function base64ToAudio(base64String, contentType) {
        const byteCharacters = atob(base64String);
        const byteNumbers = new Array(byteCharacters.length);
        
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: contentType });
        return URL.createObjectURL(blob);
    }

    async function handleSpeech(text) {
        try {
            stopSpeaking();
            
            avatar.classList.add('speaking');
            isSpeaking = true;
            stopButton.disabled = false;

            // Check cache first
            const cachedUrl = audioCache.get(text.trim());
            if (cachedUrl) {
                currentAudio = new Audio(cachedUrl);
            } else {
                console.log('Sending TTS request...');
                // Get audio from TTS endpoint
                const response = await fetch('/tts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text }),
                });

                console.log('TTS response status:', response.status);
                const responseData = await response.json();

                if (!response.ok) {
                    throw new Error(`TTS request failed: ${responseData.error || response.statusText}`);
                }

                if (responseData.error) {
                    throw new Error(`TTS error: ${responseData.error}`);
                }

                if (!responseData.audio || !responseData.content_type) {
                    throw new Error('Invalid TTS response format');
                }

                console.log('Converting audio data...');
                // Convert base64 to audio URL
                const audioUrl = base64ToAudio(responseData.audio, responseData.content_type);
                audioCache.set(text.trim(), audioUrl);
                currentAudio = new Audio(audioUrl);
            }

            // Set up audio properties
            currentAudio.playbackRate = PLAYBACK_RATE;

            // Set up event listeners
            currentAudio.addEventListener('ended', () => {
                stopSpeaking();
                // Don't revoke cached URLs
                if (!audioCache.has(text.trim())) {
                    URL.revokeObjectURL(currentAudio.src);
                }
            });

            currentAudio.addEventListener('error', (e) => {
                console.error('Audio playback error:', e.target.error);
                stopSpeaking();
                if (!audioCache.has(text.trim())) {
                    URL.revokeObjectURL(currentAudio.src);
                }
                throw new Error(`Audio playback failed: ${e.target.error.message || 'Unknown error'}`);
            });

            console.log('Playing audio...');
            // Play the audio
            await currentAudio.play();
        } catch (error) {
            console.error('Error in handleSpeech:', error);
            stopSpeaking();
            // Add error message to chat
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

            if (!response.ok) {
                throw new Error('Chat request failed');
            }

            const assistantResponse = await response.text();
            addMessage(assistantResponse, false);
            await handleSpeech(assistantResponse);
        } catch (error) {
            console.error('Error:', error);
            addMessage('Sorry, there was an error processing your request.', false);
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