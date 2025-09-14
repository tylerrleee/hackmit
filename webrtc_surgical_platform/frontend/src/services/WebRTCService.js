import io from 'socket.io-client';

class WebRTCService {
    constructor() {
        this.socket = null;
        this.peerConnections = new Map(); // userId -> RTCPeerConnection
        this.localStream = null;
        this.remoteStreams = new Map(); // userId -> MediaStream
        this.iceServers = [];
        this.currentRoom = null;
        this.userId = null;
        this.listeners = new Map(); // eventName -> Set of callbacks
        
        // Video call state
        this.isInVideoCall = false;
        this.localVideoEnabled = true;
        this.localAudioEnabled = true;
        this.roomParticipants = new Map(); // userId -> participant info
        
        // WebRTC configuration
        this.rtcConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };

        // Data channel configuration
        this.dataChannelConfig = {
            ordered: true,
            maxRetransmitTime: 3000
        };

        // Call management
        this.activeCalls = new Map(); // callId -> call info
        this.callQueue = [];
        
        // Media constraints
        this.defaultVideoConstraints = {
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 },
            frameRate: { min: 15, ideal: 30, max: 60 }
        };

        this.defaultAudioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100
        };
    }

    // Initialize the WebRTC service
    async initialize(serverUrl, authToken) {
        try {
            // Connect to signaling server
            await this.connectToSignalingServer(serverUrl, authToken);
            
            // Get WebRTC configuration from server
            await this.loadWebRTCConfiguration();
            
            this.setupSocketListeners();
            
            console.log('WebRTC Service initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize WebRTC service:', error);
            this.emit('error', { type: 'initialization_failed', error });
            throw error;
        }
    }

    // Connect to signaling server
    async connectToSignalingServer(serverUrl, authToken) {
        return new Promise((resolve, reject) => {
            this.socket = io(serverUrl, {
                auth: {
                    token: authToken
                },
                transports: ['websocket', 'polling'],
                timeout: 10000
            });

            this.socket.on('connect', () => {
                console.log('Connected to signaling server');
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error('Failed to connect to signaling server:', error);
                reject(error);
            });

            this.socket.on('disconnect', (reason) => {
                console.warn('Disconnected from signaling server:', reason);
                this.emit('disconnected', { reason });
            });

            this.socket.on('error', (error) => {
                console.error('Socket error:', error);
                this.emit('error', { type: 'socket_error', error });
            });
        });
    }

    // Load WebRTC configuration from server
    async loadWebRTCConfiguration() {
        try {
            const response = await fetch('/api/webrtc-config', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load WebRTC configuration');
            }

            const config = await response.json();
            this.rtcConfiguration.iceServers = config.iceServers;
            
        } catch (error) {
            console.warn('Using default ICE servers due to configuration load error:', error);
        }
    }

    // Set up socket event listeners
    setupSocketListeners() {
        // Room events
        this.socket.on('room-joined', this.handleRoomJoined.bind(this));
        this.socket.on('room-left', this.handleRoomLeft.bind(this));
        this.socket.on('user-joined', this.handleUserJoined.bind(this));
        this.socket.on('user-left', this.handleUserLeft.bind(this));

        // WebRTC signaling events
        this.socket.on('offer', this.handleOffer.bind(this));
        this.socket.on('answer', this.handleAnswer.bind(this));
        this.socket.on('ice-candidate', this.handleIceCandidate.bind(this));
        this.socket.on('renegotiate', this.handleRenegotiation.bind(this));

        // Call management events
        this.socket.on('call-started', this.handleCallStarted.bind(this));
        this.socket.on('call-ended', this.handleCallEnded.bind(this));
        this.socket.on('call-status-update', this.handleCallStatusUpdate.bind(this));

        // Chat and file sharing
        this.socket.on('chat-message', this.handleChatMessage.bind(this));
        this.socket.on('file-shared', this.handleFileShared.bind(this));

        // Screen sharing and annotations
        this.socket.on('screen-share-started', this.handleScreenShareStarted.bind(this));
        this.socket.on('screen-share-stopped', this.handleScreenShareStopped.bind(this));
        this.socket.on('annotation', this.handleAnnotation.bind(this));
    }

    // Media management
    async getUserMedia(constraints = {}) {
        try {
            const mediaConstraints = {
                video: {
                    ...this.defaultVideoConstraints,
                    ...constraints.video
                },
                audio: {
                    ...this.defaultAudioConstraints,
                    ...constraints.audio
                }
            };

            this.localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
            
            console.log('Local stream acquired:', {
                video: this.localStream.getVideoTracks().length > 0,
                audio: this.localStream.getAudioTracks().length > 0
            });

            this.emit('localStreamAcquired', { stream: this.localStream });
            return this.localStream;

        } catch (error) {
            console.error('Failed to get user media:', error);
            this.emit('error', { type: 'media_access_failed', error });
            throw error;
        }
    }

    async getDisplayMedia() {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    frameRate: { max: 30 }
                },
                audio: true
            });

            console.log('Screen sharing stream acquired');
            this.emit('screenStreamAcquired', { stream: screenStream });
            return screenStream;

        } catch (error) {
            console.error('Failed to get display media:', error);
            this.emit('error', { type: 'screen_share_failed', error });
            throw error;
        }
    }

    // Room management
    async joinRoom(roomId, metadata = {}) {
        try {
            if (!this.socket?.connected) {
                throw new Error('Not connected to signaling server');
            }

            this.currentRoom = roomId;
            
            this.socket.emit('join-room', {
                roomId,
                roomType: 'consultation',
                metadata
            });

            console.log(`Joining room: ${roomId}`);

        } catch (error) {
            console.error('Failed to join room:', error);
            throw error;
        }
    }

    async leaveRoom() {
        try {
            if (this.currentRoom) {
                // Close all peer connections
                for (const [userId, pc] of this.peerConnections) {
                    await this.closePeerConnection(userId);
                }

                this.socket.emit('leave-room', { roomId: this.currentRoom });
                this.currentRoom = null;
                
                console.log('Left room');
                this.emit('roomLeft');
            }
        } catch (error) {
            console.error('Failed to leave room:', error);
        }
    }

    // Peer connection management
    async createPeerConnection(userId) {
        try {
            if (this.peerConnections.has(userId)) {
                await this.closePeerConnection(userId);
            }

            const pc = new RTCPeerConnection(this.rtcConfiguration);
            
            // Add local stream tracks
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    pc.addTrack(track, this.localStream);
                });
            }

            // Set up event handlers
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('ice-candidate', {
                        targetUserId: userId,
                        candidate: event.candidate
                    });
                }
            };

            pc.ontrack = (event) => {
                console.log('Remote track received from user:', userId);
                this.emit('remoteStreamReceived', {
                    userId,
                    stream: event.streams[0],
                    track: event.track
                });
            };

            pc.oniceconnectionstatechange = () => {
                console.log(`ICE connection state for ${userId}:`, pc.iceConnectionState);
                this.emit('iceConnectionStateChange', {
                    userId,
                    state: pc.iceConnectionState
                });

                if (pc.iceConnectionState === 'failed') {
                    this.handleConnectionFailure(userId);
                }
            };

            pc.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, userId);
            };

            // Create data channel
            const dataChannel = pc.createDataChannel('surgical-guidance', this.dataChannelConfig);
            this.setupDataChannel(dataChannel, userId);

            this.peerConnections.set(userId, pc);
            console.log(`Peer connection created for user: ${userId}`);

            return pc;

        } catch (error) {
            console.error('Failed to create peer connection:', error);
            throw error;
        }
    }

    setupDataChannel(channel, userId) {
        channel.onopen = () => {
            console.log(`Data channel opened with user: ${userId}`);
            this.emit('dataChannelOpened', { userId, channel });
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.emit('dataChannelMessage', { userId, data });
            } catch (error) {
                console.error('Failed to parse data channel message:', error);
            }
        };

        channel.onclose = () => {
            console.log(`Data channel closed with user: ${userId}`);
            this.emit('dataChannelClosed', { userId });
        };

        channel.onerror = (error) => {
            console.error(`Data channel error with user ${userId}:`, error);
        };
    }

    async closePeerConnection(userId) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(userId);
            console.log(`Peer connection closed for user: ${userId}`);
        }
    }

    // Call management
    async makeCall(targetUserId, options = {}) {
        try {
            if (!this.localStream) {
                await this.getUserMedia();
            }

            const pc = await this.createPeerConnection(targetUserId);
            const offer = await pc.createOffer(options);
            await pc.setLocalDescription(offer);

            const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            this.socket.emit('offer', {
                targetUserId,
                offer,
                callId
            });

            console.log(`Call initiated to user: ${targetUserId}`);
            this.emit('callInitiated', { targetUserId, callId });

        } catch (error) {
            console.error('Failed to make call:', error);
            this.emit('error', { type: 'call_failed', error });
            throw error;
        }
    }

    async endCall(callId) {
        try {
            this.socket.emit('end-call', { callId });
            
            // Close relevant peer connections
            for (const [userId, pc] of this.peerConnections) {
                await this.closePeerConnection(userId);
            }

            this.emit('callEnded', { callId });

        } catch (error) {
            console.error('Failed to end call:', error);
        }
    }

    // Socket event handlers
    handleRoomJoined(data) {
        console.log('Room joined:', data);
        this.emit('roomJoined', data);
    }

    handleRoomLeft(data) {
        console.log('Room left:', data);
        this.emit('roomLeft', data);
    }

    handleUserJoined(data) {
        console.log('User joined room:', data);
        this.emit('userJoined', data);
    }

    handleUserLeft(data) {
        console.log('User left room:', data);
        this.closePeerConnection(data.userId);
        this.emit('userLeft', data);
    }

    async handleOffer(data) {
        try {
            const { fromUserId, offer, callId } = data;
            console.log('Received offer from:', fromUserId);

            const pc = await this.createPeerConnection(fromUserId);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            if (!this.localStream) {
                await this.getUserMedia();
                // Re-add tracks to peer connection
                this.localStream.getTracks().forEach(track => {
                    pc.addTrack(track, this.localStream);
                });
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.socket.emit('answer', {
                targetUserId: fromUserId,
                answer,
                callId
            });

            this.emit('callReceived', { fromUserId, callId });

        } catch (error) {
            console.error('Failed to handle offer:', error);
            this.emit('error', { type: 'offer_handling_failed', error });
        }
    }

    async handleAnswer(data) {
        try {
            const { fromUserId, answer } = data;
            console.log('Received answer from:', fromUserId);

            const pc = this.peerConnections.get(fromUserId);
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('Answer processed successfully');
            }

        } catch (error) {
            console.error('Failed to handle answer:', error);
        }
    }

    async handleIceCandidate(data) {
        try {
            const { fromUserId, candidate } = data;
            const pc = this.peerConnections.get(fromUserId);
            
            if (pc && candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }

        } catch (error) {
            console.error('Failed to handle ICE candidate:', error);
        }
    }

    async handleRenegotiation(data) {
        try {
            const { fromUserId, offer } = data;
            console.log('Renegotiation request from:', fromUserId);

            const pc = this.peerConnections.get(fromUserId);
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                this.socket.emit('answer', {
                    targetUserId: fromUserId,
                    answer
                });
            }

        } catch (error) {
            console.error('Failed to handle renegotiation:', error);
        }
    }

    handleCallStarted(data) {
        console.log('Call started:', data);
        this.activeCalls.set(data.callId, data);
        this.emit('callStarted', data);
    }

    handleCallEnded(data) {
        console.log('Call ended:', data);
        this.activeCalls.delete(data.callId);
        this.emit('callEnded', data);
    }

    handleCallStatusUpdate(data) {
        this.emit('callStatusUpdate', data);
    }

    handleChatMessage(data) {
        this.emit('chatMessage', data);
    }

    handleFileShared(data) {
        this.emit('fileShared', data);
    }

    handleScreenShareStarted(data) {
        this.emit('screenShareStarted', data);
    }

    handleScreenShareStopped(data) {
        this.emit('screenShareStopped', data);
    }

    handleAnnotation(data) {
        this.emit('annotation', data);
    }

    // Connection failure handling
    async handleConnectionFailure(userId) {
        console.warn(`Connection failure with user: ${userId}`);
        
        try {
            // Attempt to reconnect
            setTimeout(async () => {
                if (this.currentRoom) {
                    await this.createPeerConnection(userId);
                }
            }, 5000);
        } catch (error) {
            console.error('Failed to recover connection:', error);
        }
    }

    // Utility methods
    sendDataChannelMessage(userId, data) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            const channel = pc.createDataChannel ? 
                pc.createDataChannel('surgical-guidance', this.dataChannelConfig) :
                Array.from(pc.getReceivers()).find(r => r.channel)?.channel;
                
            if (channel && channel.readyState === 'open') {
                channel.send(JSON.stringify(data));
            }
        }
    }

    // Event handling
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        this.listeners.get(eventName).add(callback);
    }

    off(eventName, callback) {
        if (this.listeners.has(eventName)) {
            this.listeners.get(eventName).delete(callback);
        }
    }

    emit(eventName, data) {
        if (this.listeners.has(eventName)) {
            this.listeners.get(eventName).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${eventName}:`, error);
                }
            });
        }
    }

    // Cleanup
    disconnect() {
        // Close all peer connections
        for (const [userId] of this.peerConnections) {
            this.closePeerConnection(userId);
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Disconnect socket
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        // Clear listeners
        this.listeners.clear();

        console.log('WebRTC Service disconnected');
    }

    // Get connection statistics
    async getConnectionStats() {
        const stats = new Map();
        
        for (const [userId, pc] of this.peerConnections) {
            try {
                const peerStats = await pc.getStats();
                stats.set(userId, peerStats);
            } catch (error) {
                console.error(`Failed to get stats for user ${userId}:`, error);
            }
        }

        return stats;
    }

    // === VIDEO CALL MANAGEMENT ===
    
    // Start video call for the room
    async startRoomVideoCall() {
        try {
            console.log('Starting room video call...');
            this.isInVideoCall = true;
            
            // Get local media stream
            await this.getUserMedia({
                video: this.defaultVideoConstraints,
                audio: this.defaultAudioConstraints
            });
            
            // Create peer connections with all current room participants
            for (const [userId] of this.roomParticipants) {
                if (userId !== this.userId) {
                    await this.createPeerConnection(userId);
                    await this.makeCall(userId);
                }
            }
            
            this.emit('video-call-started');
            return { success: true };
            
        } catch (error) {
            console.error('Failed to start room video call:', error);
            this.emit('error', { type: 'video_call_start_failed', error });
            throw error;
        }
    }
    
    // End video call for the room
    async endRoomVideoCall() {
        try {
            console.log('Ending room video call...');
            this.isInVideoCall = false;
            
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            // Close all peer connections
            for (const [userId] of this.peerConnections) {
                this.closePeerConnection(userId);
            }
            
            // Clear remote streams
            this.remoteStreams.clear();
            
            this.emit('video-call-ended');
            return { success: true };
            
        } catch (error) {
            console.error('Failed to end room video call:', error);
            this.emit('error', { type: 'video_call_end_failed', error });
            throw error;
        }
    }
    
    // Toggle local video
    toggleLocalVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.localVideoEnabled = videoTrack.enabled;
                this.emit('local-video-toggled', { enabled: this.localVideoEnabled });
                return this.localVideoEnabled;
            }
        }
        return false;
    }
    
    // Toggle local audio
    toggleLocalAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.localAudioEnabled = audioTrack.enabled;
                this.emit('local-audio-toggled', { enabled: this.localAudioEnabled });
                return this.localAudioEnabled;
            }
        }
        return false;
    }
    
    // Get local stream for video element
    getLocalStream() {
        return this.localStream;
    }
    
    // Get remote stream by user ID
    getRemoteStream(userId) {
        return this.remoteStreams.get(userId);
    }
    
    // Get all remote streams
    getAllRemoteStreams() {
        return new Map(this.remoteStreams);
    }
    
    // Handle new user joining room during video call
    async handleUserJoinedDuringCall(userId, userInfo) {
        if (this.isInVideoCall && userId !== this.userId) {
            this.roomParticipants.set(userId, userInfo);
            
            // Create peer connection and initiate call
            await this.createPeerConnection(userId);
            await this.makeCall(userId);
        }
    }
    
    // Enhanced handleUserJoined for video calls
    handleUserJoined(data) {
        const { user } = data;
        console.log(`User joined room: ${user.name}`);
        
        this.roomParticipants.set(user.id, user);
        
        // If we're in a video call, establish peer connection
        if (this.isInVideoCall) {
            this.handleUserJoinedDuringCall(user.id, user);
        }
        
        this.emit('user-joined', data);
    }
    
    // Enhanced handleUserLeft for video calls  
    handleUserLeft(data) {
        const { userId } = data;
        console.log(`User left room: ${userId}`);
        
        this.roomParticipants.delete(userId);
        
        // Clean up peer connection and remote stream
        if (this.peerConnections.has(userId)) {
            this.closePeerConnection(userId);
        }
        
        if (this.remoteStreams.has(userId)) {
            const stream = this.remoteStreams.get(userId);
            stream.getTracks().forEach(track => track.stop());
            this.remoteStreams.delete(userId);
        }
        
        this.emit('user-left', data);
    }
    
    // Enhanced createPeerConnection to handle remote streams
    async createPeerConnection(userId) {
        try {
            if (this.peerConnections.has(userId)) {
                console.log(`Peer connection already exists for user: ${userId}`);
                return this.peerConnections.get(userId);
            }

            const peerConnection = new RTCPeerConnection(this.rtcConfiguration);
            
            // Add local stream tracks if available
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, this.localStream);
                });
            }

            // Handle incoming remote stream
            peerConnection.ontrack = (event) => {
                console.log('Received remote stream from user:', userId);
                const [remoteStream] = event.streams;
                this.remoteStreams.set(userId, remoteStream);
                this.emit('remote-stream-added', { userId, stream: remoteStream });
            };

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('ice-candidate', {
                        candidate: event.candidate,
                        targetUserId: userId
                    });
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                console.log(`Connection state with ${userId}:`, peerConnection.connectionState);
                this.emit('connection-state-changed', { 
                    userId, 
                    state: peerConnection.connectionState 
                });
                
                if (peerConnection.connectionState === 'failed') {
                    this.closePeerConnection(userId);
                }
            };

            this.peerConnections.set(userId, peerConnection);
            console.log(`Created peer connection for user: ${userId}`);
            
            return peerConnection;
            
        } catch (error) {
            console.error(`Failed to create peer connection for user ${userId}:`, error);
            this.emit('error', { type: 'peer_connection_failed', userId, error });
            throw error;
        }
    }
}

export default WebRTCService;