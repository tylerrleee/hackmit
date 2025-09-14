import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebRTCService from '../services/WebRTCService';
import './ARVideoConsultation.css';

const ARVideoConsultation = ({ 
    roomId, 
    userToken, 
    user,
    userRole = 'doctor',
    onError = () => {},
    onConnectionChange = () => {} 
}) => {
    // State management
    const [isConnected, setIsConnected] = useState(false);
    const [participants, setParticipants] = useState(new Map());
    const [arSession, setArSession] = useState(null);
    const [drawingMode, setDrawingMode] = useState(true);
    const [currentColor, setCurrentColor] = useState('#00FF00');
    const [lineThickness, setLineThickness] = useState(3);
    const [annotations, setAnnotations] = useState([]);
    
    // Drawing state
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState([]);
    
    // Video call state
    const [localStream, setLocalStream] = useState(null);
    const [remoteStreams, setRemoteStreams] = useState(new Map());
    const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
    const [localAudioEnabled, setLocalAudioEnabled] = useState(true);
    
    // Bridge connection state
    const [bridgeConnected, setBridgeConnected] = useState(false);
    
    // Refs
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const webrtcServiceRef = useRef(null);
    const remoteVideoRefs = useRef(new Map());
    const bridgeSocketRef = useRef(null);
    
    // Simple drawing colors
    const drawingColors = ['#00FF00', '#FF0000', '#0000FF', '#FFFF00'];
    
    // Initialize WebRTC service
    const initializeWebRTCService = async () => {
        try {
            // Create WebRTC service instance
            webrtcServiceRef.current = new WebRTCService();
            
            // Setup event listeners
            setupWebRTCListeners();
            
            // Initialize and connect
            await webrtcServiceRef.current.initialize('http://localhost:3001', userToken);
            
            // Join room
            await webrtcServiceRef.current.joinRoom(roomId, {
                userRole,
                capabilities: ['video', 'audio', 'ar-annotations']
            });
            
            // Start video call
            await webrtcServiceRef.current.startRoomVideoCall();
            
            setIsConnected(true);
            onConnectionChange('connected');
            
        } catch (error) {
            console.error('Failed to initialize WebRTC service:', error);
            onError('Failed to connect to consultation service');
            onConnectionChange('error');
        }
    };
    
    // Setup WebRTC event listeners
    const setupWebRTCListeners = () => {
        const service = webrtcServiceRef.current;
        
        // Connection events
        service.on('initialized', () => {
            console.log('WebRTC service initialized');
        });
        
        service.on('disconnected', (data) => {
            setIsConnected(false);
            onConnectionChange('disconnected');
        });
        
        // Video call events
        service.on('video-call-started', () => {
            console.log('Video call started');
            const stream = service.getLocalStream();
            setLocalStream(stream);
            if (videoRef.current && stream) {
                videoRef.current.srcObject = stream;
            }
            
            // Create AR session when video call starts
            createARSession();
        });
        
        service.on('video-call-ended', () => {
            console.log('Video call ended');
            setLocalStream(null);
            setRemoteStreams(new Map());
        });
        
        // Stream events
        service.on('remote-stream-added', ({ userId, stream }) => {
            console.log('Remote stream added from user:', userId);
            setRemoteStreams(prev => {
                const newStreams = new Map(prev);
                newStreams.set(userId, stream);
                return newStreams;
            });
        });
        
        // Media control events
        service.on('local-video-toggled', ({ enabled }) => {
            setLocalVideoEnabled(enabled);
        });
        
        service.on('local-audio-toggled', ({ enabled }) => {
            setLocalAudioEnabled(enabled);
        });
        
        // Room events
        service.on('user-joined', (data) => {
            setParticipants(prev => {
                const newParticipants = new Map(prev);
                newParticipants.set(data.user.id, data.user);
                return newParticipants;
            });
        });
        
        service.on('user-left', (data) => {
            setParticipants(prev => {
                const newParticipants = new Map(prev);
                newParticipants.delete(data.userId);
                return newParticipants;
            });
            
            setRemoteStreams(prev => {
                const newStreams = new Map(prev);
                newStreams.delete(data.userId);
                return newStreams;
            });
        });
        
        // AR annotation events (keeping the existing AR functionality)
        service.on('ar-annotation', handleIncomingAnnotation);
        service.on('ar-annotations-cleared', handleAnnotationsCleared);
        service.on('ar-error', handleARError);
        
        // Error handling
        service.on('error', ({ type, error }) => {
            console.error('WebRTC error:', type, error);
            onError(`WebRTC error: ${error.message || error}`);
        });
    };
    
    // Audio/Video control functions
    const toggleLocalVideo = () => {
        if (webrtcServiceRef.current) {
            const newState = webrtcServiceRef.current.toggleLocalVideo();
            setLocalVideoEnabled(newState);
            return newState;
        }
        return false;
    };
    
    const toggleLocalAudio = () => {
        if (webrtcServiceRef.current) {
            const newState = webrtcServiceRef.current.toggleLocalAudio();
            setLocalAudioEnabled(newState);
            return newState;
        }
        return false;
    };
    
    // AR Session Management
    const createARSession = async () => {
        try {
            console.log('Creating AR session for room:', roomId);
            
            // Mock AR session creation for now (can be enhanced with real AR backend)
            const mockARSession = {
                id: `ar-session-${roomId}`,
                roomId: roomId,
                createdAt: new Date().toISOString(),
                participants: [],
                annotations: []
            };
            
            setArSession(mockARSession);
            
            // Initialize annotation canvas
            initializeAnnotationCanvas();
            
            console.log('AR session created successfully');
            
        } catch (error) {
            console.error('Failed to create AR session:', error);
            onError('Failed to initialize AR session');
        }
    };
    
    // Initialize annotation canvas for drawing
    const initializeAnnotationCanvas = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalAlpha = 0.8;
            
            // Clear any existing annotations
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            console.log('Annotation canvas initialized');
        }
    };
    

    // Connect to AR Bridge for annotation synchronization
    const connectToBridge = async () => {
        try {
            const bridgeWs = new WebSocket('ws://localhost:8765');
            
            bridgeWs.onopen = () => {
                console.log('🔗 Connected to AR Bridge');
                setBridgeConnected(true);
                
                // Register with bridge as surgeon
                bridgeWs.send(JSON.stringify({
                    type: 'join_room',
                    roomId: roomId,
                    clientType: 'web_surgeon',
                    userInfo: {
                        name: user?.name || 'Surgeon',
                        role: userRole,
                        capabilities: ['annotation', 'video_call']
                    }
                }));
            };
            
            bridgeWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleBridgeMessage(data);
                } catch (error) {
                    console.error('Error parsing bridge message:', error);
                }
            };
            
            bridgeWs.onclose = () => {
                console.log('🔗 Disconnected from AR Bridge');
                setBridgeConnected(false);
                // Try to reconnect after delay
                setTimeout(() => {
                    if (roomId && userToken) {
                        connectToBridge();
                    }
                }, 5000);
            };
            
            bridgeWs.onerror = (error) => {
                console.error('🔗 AR Bridge connection error:', error);
                setBridgeConnected(false);
            };
            
            bridgeSocketRef.current = bridgeWs;
            
        } catch (error) {
            console.error('Failed to connect to AR bridge:', error);
            setBridgeConnected(false);
        }
    };

    // Handle messages from AR Bridge
    const handleBridgeMessage = (data) => {
        const messageType = data.type;
        
        if (messageType === 'annotation_received') {
            // Receive annotation from field medic
            const annotation = data.annotation;
            console.log('📍 Received annotation from field medic:', annotation);
            
            // Add to annotations array (will be rendered on canvas)
            setAnnotations(prev => [...prev, {
                ...annotation,
                source: 'field_medic',
                timestamp: Date.now(),
                id: `field_${Date.now()}`
            }]);
            
        } else if (messageType === 'video_frame') {
            // Receive video frame from field medic - this would be handled by WebRTC
            console.log('📹 Received video frame from field medic');
            
        } else if (messageType === 'ar_client_joined') {
            console.log('👥 AR client joined room:', data.roomId);
            
        } else if (messageType === 'surgeon_connected') {
            console.log('👨‍⚕️ Surgeon connected notification');
        }
    };

    // Send annotation to AR Bridge for field medic
    const sendAnnotationToBridge = (annotation) => {
        if (bridgeSocketRef.current && bridgeConnected) {
            const message = {
                type: 'annotation',
                roomId: roomId,
                annotation: {
                    ...annotation,
                    timestamp: Date.now(),
                    source: 'web_surgeon'
                },
                timestamp: Date.now()
            };
            
            bridgeSocketRef.current.send(JSON.stringify(message));
            console.log('📍 Sent annotation to bridge:', annotation);
        }
    };
    
    
    
    
    
    
    
    
    // Drawing event handlers
    const handleMouseDown = useCallback((e) => {
        if (!drawingMode || userRole !== 'doctor') return;
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const x = ((e.clientX - rect.left) * scaleX) / canvas.width;
        const y = ((e.clientY - rect.top) * scaleY) / canvas.height;
        
        setIsDrawing(true);
        setCurrentPath([{ x, y, timestamp: Date.now() }]);
        
        console.log('🖊️ Starting to draw at:', x, y);
    }, [drawingMode, userRole]);
    
    const handleMouseMove = useCallback((e) => {
        if (!isDrawing || !drawingMode || userRole !== 'doctor') return;
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const x = ((e.clientX - rect.left) * scaleX) / canvas.width;
        const y = ((e.clientY - rect.top) * scaleY) / canvas.height;
        
        const newPath = [...currentPath, { x, y, timestamp: Date.now() }];
        setCurrentPath(newPath);
        
        // Draw immediately for instant feedback
        const ctx = canvas.getContext('2d');
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = lineThickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (newPath.length >= 2) {
            const prevPoint = newPath[newPath.length - 2];
            const currPoint = newPath[newPath.length - 1];
            
            ctx.beginPath();
            ctx.moveTo(prevPoint.x * canvas.width, prevPoint.y * canvas.height);
            ctx.lineTo(currPoint.x * canvas.width, currPoint.y * canvas.height);
            ctx.stroke();
        }
    }, [isDrawing, drawingMode, userRole, currentPath, currentColor, lineThickness]);
    
    const handleMouseUp = useCallback(() => {
        if (!isDrawing || !drawingMode || userRole !== 'doctor') return;
        
        setIsDrawing(false);
        
        if (currentPath.length > 1) {
            // Create simple annotation object
            const annotation = {
                id: Date.now(),
                type: 'draw',
                data: {
                    points: currentPath,
                    color: currentColor,
                    thickness: lineThickness
                },
                timestamp: Date.now(),
                userId: user?.id || 'current-user'
            };
            
            // Add to local annotations immediately (always works)
            setAnnotations(prev => [...prev, annotation]);
            console.log('✅ Drawing saved:', annotation);
            
            // Try to sync with others (non-blocking)
            try {
                if (bridgeSocketRef.current && bridgeConnected) {
                    sendAnnotationToBridge(annotation);
                    console.log('📡 Sent to AR bridge');
                }
                
                if (webrtcServiceRef.current) {
                    webrtcServiceRef.current.emit('ar-annotation', {
                        roomId: roomId,
                        annotation: annotation,
                        userId: user?.id
                    });
                    console.log('📡 Sent to WebRTC participants');
                }
            } catch (error) {
                console.warn('⚠️ Sync failed (drawing still saved locally):', error);
            }
        }
        
        setCurrentPath([]);
    }, [isDrawing, drawingMode, userRole, currentPath, currentColor, lineThickness, user?.id, roomId, bridgeConnected, sendAnnotationToBridge]);
    
    // Draw path on canvas
    const drawPath = (path, color, thickness, isPreview = false) => {
        const canvas = canvasRef.current;
        if (!canvas || path.length < 2) return;
        
        const ctx = canvas.getContext('2d');
        ctx.globalAlpha = isPreview ? 0.7 : 1.0;
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(path[0].x * canvas.width, path[0].y * canvas.height);
        
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x * canvas.width, path[i].y * canvas.height);
        }
        
        ctx.stroke();
    };
    
    // Handle incoming annotation
    const handleIncomingAnnotation = (data) => {
        console.log('Received annotation:', data);
        
        const annotation = data.annotation;
        setAnnotations(prev => [...prev, annotation]);
        
        // Draw annotation on canvas
        if (annotation.type === 'draw' && annotation.data.points) {
            drawPath(annotation.data.points, annotation.data.color, annotation.data.thickness);
        }
    };
    
    
    // Handle annotations cleared
    const handleAnnotationsCleared = (data) => {
        console.log('Annotations cleared:', data);
        setAnnotations([]);
        clearCanvas();
    };
    
    // Handle AR errors
    const handleARError = (data) => {
        console.error('AR Error:', data);
        onError(`AR Error: ${data.message}`);
    };
    
    // Undo last annotation
    const undoLastAnnotation = () => {
        if (annotations.length > 0) {
            const newAnnotations = annotations.slice(0, -1);
            setAnnotations(newAnnotations);
            
            // Redraw canvas with remaining annotations
            clearCanvas();
            redrawAnnotations(newAnnotations);
            
            console.log('↩️ Undid last annotation');
            
            // Try to sync undo with others (non-blocking)
            try {
                if (webrtcServiceRef.current) {
                    webrtcServiceRef.current.emit('ar-annotation-undo', {
                        roomId: roomId,
                        userId: user?.id
                    });
                }
            } catch (error) {
                console.warn('⚠️ Undo sync failed:', error);
            }
        }
    };
    
    // Clear all annotations
    const clearAllAnnotations = () => {
        setAnnotations([]);
        clearCanvas();
        console.log('🗑️ Cleared all annotations');
        
        // Try to sync clear with others (non-blocking)
        try {
            if (webrtcServiceRef.current) {
                webrtcServiceRef.current.emit('ar-annotations-clear', { 
                    roomId: roomId,
                    clearType: 'all',
                    userId: user?.id
                });
            }
        } catch (error) {
            console.warn('⚠️ Clear sync failed:', error);
        }
    };
    
    // Clear canvas
    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };
    
    // Redraw all annotations
    const redrawAnnotations = (annotationsToRedraw) => {
        clearCanvas();
        
        annotationsToRedraw.forEach(annotation => {
            if (annotation.type === 'draw' && annotation.data.points) {
                drawPath(annotation.data.points, annotation.data.color, annotation.data.thickness);
            }
        });
    };
    
    // WebRTC peer connections are handled by the centralized WebRTC service
    
    // Initialize component
    useEffect(() => {
        if (roomId && userToken) {
            initializeWebRTCService();
            connectToBridge();
        }
        
        return () => {
            // Cleanup WebRTC service
            if (webrtcServiceRef.current) {
                webrtcServiceRef.current.disconnect();
            }
            
            // Close bridge connection
            if (bridgeSocketRef.current) {
                bridgeSocketRef.current.close();
                bridgeSocketRef.current = null;
                setBridgeConnected(false);
            }
        };
    }, [roomId, userToken]);
    
    return (
        <div className={'ar-video-consultation'}>
            {/* Header */}
            <div className="consultation-header">
                <h2>🏥 AR Video Consultation</h2>
                <div className="status-indicators">
                    <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
                        {isConnected ? '🟢' : '🔴 '}
                    </span>
                    <span className={`status-indicator ${bridgeConnected ? 'connected' : 'disconnected'}`}>
                        {bridgeConnected ? '🔗' : '🔗 '}
                    </span>
                    <span className="participant-count">
                        👥 {participants.size + 1} participants
                    </span>
                    {arSession && (
                        <span className="ar-status">
                            ✨ AR Session Active
                        </span>
                    )}
                </div>
            </div>
            
            {/* Main video and annotation area */}
            <div className="video-annotation-container">
                <div className="video-wrapper">
                    {/* Main Video Stream */}
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted={userRole === 'field_medic'}
                        className="consultation-video"
                    />
                    
                    {/* AR Annotation Canvas Overlay */}
                    <canvas
                        ref={canvasRef}
                        className="annotation-canvas"
                        width={1280}
                        height={720}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        style={{ 
                            cursor: drawingMode ? 'crosshair' : 'default',
                            pointerEvents: userRole === 'doctor' ? 'auto' : 'none'
                        }}
                    />
                    
                    {/* Live Stream Status Indicator */}
                    <div className="video-stream-status">
                        {localStream && (
                            <div className="stream-indicator local">
                                <span className="indicator-dot"></span>
                                Live: {userRole === 'doctor' ? 'Doctor' : 'Field Medic'}
                            </div>
                        )}
                        {remoteStreams.size > 0 && (
                            <div className="stream-indicator remote">
                                <span className="indicator-dot"></span>
                                Remote: {remoteStreams.size} connected
                            </div>
                        )}
                    </div>
                    
                    {/* AR Session Status */}
                    {arSession && (
                        <div className="ar-session-indicator">
                            <span className="ar-indicator">✨</span>
                            AR Session Active
                        </div>
                    )}
                    
                    {/* Simplified Drawing Tools (only for doctors) */}
                    {userRole === 'doctor' && (
                        <div className="floating-drawing-tools">
                            <div className="drawing-toolbar">
                                {/* Drawing Mode Toggle */}
                                <button 
                                    className={`tool-toggle ${drawingMode ? 'drawing' : 'viewing'}`}
                                    onClick={() => {
                                        setDrawingMode(!drawingMode);
                                        console.log('🖊️ Drawing mode:', !drawingMode ? 'ON' : 'OFF');
                                    }}
                                    title={drawingMode ? 'Switch to viewing mode' : 'Switch to drawing mode'}
                                >
                                    {drawingMode ? '✏️' : '👆'}
                                </button>
                                
                                {drawingMode && (
                                    <>
                                        <div className="tool-separator"></div>
                                        
                                        {/* Color Selection */}
                                        <div className="quick-colors">
                                            {drawingColors.map(color => (
                                                <button
                                                    key={color}
                                                    className={`color-dot ${currentColor === color ? 'active' : ''}`}
                                                    style={{ backgroundColor: color }}
                                                    onClick={() => {
                                                        setCurrentColor(color);
                                                        console.log('🎨 Color changed to:', color);
                                                    }}
                                                    title={`Use ${color} color`}
                                                />
                                            ))}
                                        </div>
                                        
                                        <div className="tool-separator"></div>
                                        
                                        {/* Thickness Control */}
                                        <div className="thickness-control">
                                            <button 
                                                onClick={() => {
                                                    const newThickness = Math.max(1, lineThickness - 1);
                                                    setLineThickness(newThickness);
                                                    console.log('📏 Thickness:', newThickness);
                                                }}
                                                className="thickness-btn"
                                                title="Decrease thickness"
                                            >
                                                ➖
                                            </button>
                                            <span className="thickness-value">{lineThickness}</span>
                                            <button 
                                                onClick={() => {
                                                    const newThickness = Math.min(10, lineThickness + 1);
                                                    setLineThickness(newThickness);
                                                    console.log('📏 Thickness:', newThickness);
                                                }}
                                                className="thickness-btn"
                                                title="Increase thickness"
                                            >
                                                ➕
                                            </button>
                                        </div>
                                        
                                        <div className="tool-separator"></div>
                                        
                                        {/* Undo Button */}
                                        <button 
                                            className="undo-btn"
                                            onClick={undoLastAnnotation}
                                            disabled={annotations.length === 0}
                                            title="Undo last drawing"
                                            style={{
                                                background: annotations.length > 0 
                                                    ? 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)'
                                                    : 'rgba(255, 255, 255, 0.1)',
                                                opacity: annotations.length > 0 ? 1 : 0.5
                                            }}
                                        >
                                            ↩️
                                        </button>
                                        
                                        {/* Clear Button */}
                                        <button 
                                            className="clear-btn"
                                            onClick={clearAllAnnotations}
                                            disabled={annotations.length === 0}
                                            title="Clear all drawings"
                                            style={{
                                                opacity: annotations.length > 0 ? 1 : 0.5
                                            }}
                                        >
                                            🗑️
                                        </button>
                                    </>
                                )}
                            </div>
                            
                            {/* Drawing Status */}
                            {drawingMode && (
                                <div className="drawing-status">
                                    <span>✏️ Drawing Mode</span>
                                    <span>🎨 {currentColor}</span>
                                    <span>📏 {lineThickness}px</span>
                                    {annotations.length > 0 && <span>📝 {annotations.length} drawings</span>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            
            {/* Video Controls */}
            <div className="video-controls">
                <button 
                    onClick={toggleLocalVideo}
                    className={`control-btn ${localVideoEnabled ? 'enabled' : 'disabled'}`}
                    title={localVideoEnabled ? 'Turn off video' : 'Turn on video'}
                >
                    {localVideoEnabled ? '📹 Video On' : '📹 Video Off'}
                </button>
                <button 
                    onClick={toggleLocalAudio}
                    className={`control-btn ${localAudioEnabled ? 'enabled' : 'disabled'}`}
                    title={localAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                >
                    {localAudioEnabled ? '🎤 Mic On' : '🎤 Mic Off'}
                </button>
            </div>

            {/* Compact Remote Video Streams - Picture in Picture Style */}
            {remoteStreams.size > 0 && (
                <div className="remote-videos-pip">
                    {Array.from(remoteStreams.entries()).map(([userId, stream]) => {
                        const participant = participants.get(userId);
                        return (
                            <div key={userId} className="pip-video-container">
                                <video
                                    ref={(el) => {
                                        if (el && stream) {
                                            el.srcObject = stream;
                                            remoteVideoRefs.current.set(userId, el);
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="pip-video"
                                />
                                <div className="pip-video-label">
                                    {participant?.name || `User ${userId}`}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            
            {/* Annotation info */}
            {annotations.length > 0 && (
                <div className="annotation-info">
                    <span>📝 {annotations.length} annotations active</span>
                </div>
            )}
        </div>
    );
};

export default ARVideoConsultation;