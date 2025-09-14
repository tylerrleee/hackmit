import React, { useState, useEffect, useRef } from 'react';
import ARVideoConsultation from './ARVideoConsultation';
import './RoomVideoConsultation.css';

const RoomVideoConsultation = ({ 
    roomId, 
    userToken, 
    user,
    onLeaveRoom,
    onError 
}) => {
    // Room state management
    const [roomInfo, setRoomInfo] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const [participants, setParticipants] = useState([]);
    const [roomError, setRoomError] = useState(null);
    
    // Video consultation state
    const [isVideoCallActive, setIsVideoCallActive] = useState(false);
    const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
    const [localAudioEnabled, setLocalAudioEnabled] = useState(true);
    
    // Room management
    const [showRoomSettings, setShowRoomSettings] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');

    // Initialize room and fetch room information
    useEffect(() => {
        if (roomId && userToken) {
            initializeRoom();
        }
    }, [roomId, userToken]);

    const initializeRoom = async () => {
        try {
            setIsLoading(true);
            
            // Fetch room information from backend
            const response = await fetch(`http://localhost:3001/api/rooms/${roomId}`, {
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch room info: ${response.statusText}`);
            }

            const roomData = await response.json();
            setRoomInfo(roomData.room);
            setConnectionStatus('connected');
            
        } catch (error) {
            console.error('Failed to initialize room:', error);
            setRoomError(error.message);
            setConnectionStatus('error');
            onError?.(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnectionChange = (status) => {
        setConnectionStatus(status);
    };

    const handleVideoCallToggle = async () => {
        try {
            if (!isVideoCallActive) {
                // Start video call - connect to field medic
                console.log('🎥 Starting video call with field medic...');
                setIsVideoCallActive(true);
                await startFieldMedicConnection();
            } else {
                // End video call
                console.log('📵 Ending video call with field medic...');
                setIsVideoCallActive(false);
                await endFieldMedicConnection();
            }
        } catch (error) {
            console.error('Error toggling video call:', error);
            onError?.('Failed to toggle video call: ' + error.message);
        }
    };
    
    const startFieldMedicConnection = async () => {
        try {
            // Send start video call command to bridge via backend API
            const response = await fetch('http://localhost:3001/api/video-call/start', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: roomId,
                    surgeonId: user?.id,
                    requestFieldMedic: true
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to start video call: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('✅ Video call start request sent:', result);
            
            // Update connection status
            setConnectionStatus('connecting_video');
            
            return result;
            
        } catch (error) {
            console.error('Failed to start field medic connection:', error);
            setIsVideoCallActive(false);
            throw error;
        }
    };
    
    const endFieldMedicConnection = async () => {
        try {
            // Send end video call command to bridge via backend API
            const response = await fetch('http://localhost:3001/api/video-call/end', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: roomId,
                    surgeonId: user?.id
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to end video call: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('✅ Video call end request sent:', result);
            
            // Reset connection status
            setConnectionStatus('connected');
            
            return result;
            
        } catch (error) {
            console.error('Failed to end field medic connection:', error);
            throw error;
        }
    };

    const handleLocalVideoToggle = () => {
        setLocalVideoEnabled(!localVideoEnabled);
    };

    const handleLocalAudioToggle = () => {
        setLocalAudioEnabled(!localAudioEnabled);
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (newMessage.trim()) {
            const message = {
                id: Date.now(),
                user: user.name,
                text: newMessage,
                timestamp: new Date().toISOString()
            };
            setChatMessages([...chatMessages, message]);
            setNewMessage('');
        }
    };

    const handleLeaveRoom = () => {
        if (onLeaveRoom) {
            onLeaveRoom();
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="room-video-consultation loading">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Connecting to room...</p>
                </div>
            </div>
        );
    }

    // Error state
    if (roomError) {
        return (
            <div className="room-video-consultation error">
                <div className="error-container">
                    <h2>❌ Room Connection Failed</h2>
                    <p>{roomError}</p>
                    <div className="error-actions">
                        <button onClick={initializeRoom} className="btn-primary">
                            Retry Connection
                        </button>
                        <button onClick={handleLeaveRoom} className="btn-secondary">
                            Leave Room
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="room-video-consultation">
            {/* Room Header */}
            <div className="room-header">
                <div className="room-info">
                    <h2>🏥 {roomInfo?.type === 'ar-consultation' ? 'AR Surgery Consultation' : 'Video Consultation'}</h2>
                    <div className="room-details">
                        <span className="room-id">Room: {roomId}</span>
                        <span className={`connection-status ${connectionStatus}`}>
                            {connectionStatus === 'connected' && '🟢 Connected'}
                            {connectionStatus === 'connecting' && '🟡 Connecting'}
                            {connectionStatus === 'connecting_video' && '📹 Connecting to Field Medic'}
                            {connectionStatus === 'video_active' && '🎥 Live Video Call'}
                            {connectionStatus === 'error' && '🔴 Connection Error'}
                        </span>
                    </div>
                </div>
                
                <div className="room-controls">
                    <button 
                        className={`control-btn ${isVideoCallActive ? 'active' : ''}`}
                        onClick={handleVideoCallToggle}
                        title="Toggle Video Call"
                    >
                        {isVideoCallActive ? '📹 End Call' : '📹 Start Video'}
                    </button>
                    
                    <button 
                        className="control-btn"
                        onClick={() => setShowRoomSettings(!showRoomSettings)}
                        title="Room Settings"
                    >
                        ⚙️
                    </button>
                    
                    <button 
                        className="control-btn leave-btn"
                        onClick={handleLeaveRoom}
                        title="Leave Room"
                    >
                        🚪 Leave
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="room-content">
                {/* Video Call Area */}
                <div className="video-area">
                    {isVideoCallActive ? (
                        <ARVideoConsultation
                            roomId={roomId}
                            userToken={userToken}
                            userRole={user.role}
                            onError={(error) => setRoomError(error)}
                            onConnectionChange={handleConnectionChange}
                        />
                    ) : (
                        <div className="video-placeholder">
                            <div className="placeholder-content">
                                <h3>📹 Video Consultation Ready</h3>
                                <p>Click "Start Video" to begin the AR-enabled video consultation with real-time annotation capabilities.</p>
                                
                                <div className="pre-call-controls">
                                    <button 
                                        className={`control-btn ${localVideoEnabled ? 'enabled' : 'disabled'}`}
                                        onClick={handleLocalVideoToggle}
                                    >
                                        {localVideoEnabled ? '📹 Video On' : '📹 Video Off'}
                                    </button>
                                    
                                    <button 
                                        className={`control-btn ${localAudioEnabled ? 'enabled' : 'disabled'}`}
                                        onClick={handleLocalAudioToggle}
                                    >
                                        {localAudioEnabled ? '🎤 Mic On' : '🎤 Mic Off'}
                                    </button>
                                    
                                    <button 
                                        className="control-btn primary start-call-btn"
                                        onClick={handleVideoCallToggle}
                                    >
                                        🚀 Start Video Call
                                    </button>
                                </div>

                                {/* Room Information */}
                                {roomInfo && (
                                    <div className="room-metadata">
                                        <h4>Room Details</h4>
                                        <div className="metadata-grid">
                                            <div className="metadata-item">
                                                <strong>Type:</strong> {roomInfo.type}
                                            </div>
                                            <div className="metadata-item">
                                                <strong>Created:</strong> {new Date(roomInfo.createdAt).toLocaleString()}
                                            </div>
                                            <div className="metadata-item">
                                                <strong>Participants:</strong> {roomInfo.participantCount || 0}/{roomInfo.maxParticipants || 10}
                                            </div>
                                            {roomInfo.metadata?.medicalSpecialty && (
                                                <div className="metadata-item">
                                                    <strong>Specialty:</strong> {roomInfo.metadata.medicalSpecialty}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar with Chat and Participants */}
                <div className="room-sidebar">
                    {/* Participants Panel */}
                    <div className="participants-panel">
                        <h4>👥 Participants ({participants.length})</h4>
                        <div className="participants-list">
                            <div className="participant self">
                                <div className="participant-avatar">{user.name.charAt(0)}</div>
                                <div className="participant-info">
                                    <span className="participant-name">{user.name} (You)</span>
                                    <span className="participant-role">{user.role}</span>
                                </div>
                                <div className="participant-status">🟢</div>
                            </div>
                            
                            {participants.map(participant => (
                                <div key={participant.id} className="participant">
                                    <div className="participant-avatar">{participant.name.charAt(0)}</div>
                                    <div className="participant-info">
                                        <span className="participant-name">{participant.name}</span>
                                        <span className="participant-role">{participant.role}</span>
                                    </div>
                                    <div className="participant-status">
                                        {participant.connected ? '🟢' : '🔴'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Chat Panel */}
                    <div className="chat-panel">
                        <h4>💬 Room Chat</h4>
                        <div className="chat-messages">
                            {chatMessages.map(message => (
                                <div key={message.id} className="chat-message">
                                    <div className="message-header">
                                        <span className="message-user">{message.user}</span>
                                        <span className="message-time">
                                            {new Date(message.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div className="message-text">{message.text}</div>
                                </div>
                            ))}
                        </div>
                        
                        <form onSubmit={handleSendMessage} className="chat-input-form">
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="Type a message..."
                                className="chat-input"
                            />
                            <button type="submit" className="send-btn">Send</button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Room Settings Modal */}
            {showRoomSettings && (
                <div className="room-settings-modal">
                    <div className="modal-overlay" onClick={() => setShowRoomSettings(false)}>
                        <div className="modal-content" onClick={e => e.stopPropagation()}>
                            <h3>Room Settings</h3>
                            <div className="settings-section">
                                <h4>Audio & Video</h4>
                                <div className="setting-item">
                                    <label>
                                        <input 
                                            type="checkbox" 
                                            checked={localVideoEnabled}
                                            onChange={handleLocalVideoToggle}
                                        />
                                        Enable Video
                                    </label>
                                </div>
                                <div className="setting-item">
                                    <label>
                                        <input 
                                            type="checkbox" 
                                            checked={localAudioEnabled}
                                            onChange={handleLocalAudioToggle}
                                        />
                                        Enable Audio
                                    </label>
                                </div>
                            </div>
                            
                            <div className="settings-actions">
                                <button onClick={() => setShowRoomSettings(false)} className="btn-secondary">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoomVideoConsultation;