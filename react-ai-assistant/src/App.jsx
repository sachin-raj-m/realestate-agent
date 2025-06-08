import { useState, useRef, useEffect } from 'react'
import './App.css'
import Avatar from './components/Avatar'

function App() {
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTypingMessage, setCurrentTypingMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const audioRef = useRef(null)
  const typingSpeed = 30 // ms per character

  // Function to stop audio playback
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio()
    }
  }, [])

  // Function to simulate typing effect
  const typeMessage = async (text, audioBlob) => {
    setIsTyping(true)
    let currentText = ''
    
    // Start audio playback immediately
    if (audioBlob) {
      playAudio(audioBlob)
    }

    // Type out the message character by character
    for (let i = 0; i < text.length; i++) {
      currentText += text[i]
      setCurrentTypingMessage(currentText)
      await new Promise(resolve => setTimeout(resolve, typingSpeed))
    }

    // Add the complete message to the chat
    setMessages(prev => [...prev, { type: 'ai', content: text }])
    setCurrentTypingMessage('')
    setIsTyping(false)
  }

  const playAudio = async (audioBlob) => {
    try {
      if (audioRef.current) {
        const url = URL.createObjectURL(audioBlob)
        audioRef.current.src = url
        audioRef.current.playbackRate = 1.5
        setIsPlaying(true)
        
        try {
          await audioRef.current.play()
          console.log('Audio playback started')
        } catch (error) {
          console.error('Audio playback error:', error)
          setIsPlaying(false)
        }

        audioRef.current.onended = () => {
          URL.revokeObjectURL(url)
          setIsPlaying(false)
        }
      }
    } catch (error) {
      console.error('Error setting up audio:', error)
      setIsPlaying(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!inputMessage.trim()) return

    const lowerMessage = inputMessage.toLowerCase().trim()
    if (lowerMessage === 'stop' || lowerMessage === 'stop conversation') {
      stopAudio()
      setMessages(prev => [...prev, { type: 'user', content: inputMessage }])
      setMessages(prev => [...prev, { type: 'ai', content: 'Audio playback stopped. How can I help you?' }])
      setInputMessage('')
      return
    }

    stopAudio()
    setIsLoading(true)
    setMessages(prev => [...prev, { type: 'user', content: inputMessage }])

    try {
      // Get LLM response
      console.log('Sending request to LLM...')
      const llmResponse = await fetch('http://localhost:5001/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/plain'
        },
        body: JSON.stringify({ message: inputMessage })
      })
      
      if (!llmResponse.ok) {
        throw new Error(`HTTP error! status: ${llmResponse.status}`)
      }
      
      const responseText = await llmResponse.text()
      console.log('Received LLM response:', responseText)
      
      // Get TTS audio in parallel
      console.log('Requesting TTS...')
      const ttsResponse = await fetch('http://localhost:5001/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({ text: responseText })
      })
      
      if (!ttsResponse.ok) {
        throw new Error(`TTS HTTP error! status: ${ttsResponse.status}`)
      }
      
      const audioBlob = await ttsResponse.blob()
      console.log('Received audio blob, starting synchronized playback')
      
      // Start typing animation with audio
      typeMessage(responseText, audioBlob)
      
    } catch (error) {
      console.error('Error:', error)
      setMessages(prev => [...prev, { type: 'error', content: 'An error occurred. Please try again.' }])
    } finally {
      setIsLoading(false)
      setInputMessage('')
    }
  }

  return (
    <div className="app-container">
      <div className="chat-container">
        <div className="avatar-section">
          <Avatar isPlaying={isPlaying} />
          {isPlaying && (
            <button 
              className="stop-button" 
              onClick={stopAudio}
              aria-label="Stop speaking"
            >
              Stop Speaking
            </button>
          )}
          {isLoading && (
            <div className="loading-indicator">
              Processing...
            </div>
          )}
        </div>
        
        <div className="messages-section">
          {messages.map((message, index) => (
            <div key={index} className={`message ${message.type}`}>
              <div className="message-content">{message.content}</div>
            </div>
          ))}
          {isTyping && (
            <div className="message ai">
              <div className="message-content">{currentTypingMessage}</div>
            </div>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your message... (type 'stop' to stop audio)"
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Processing...' : 'Send'}
          </button>
        </form>
      </div>
      <audio 
        ref={audioRef} 
        style={{ display: 'none' }} 
      />
    </div>
  )
}

export default App