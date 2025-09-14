// WebRTC utility functions and configurations

export const WebRTCConfig = {
    // Default ICE servers configuration
    DEFAULT_ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ],

    // Default media constraints for different use cases
    MEDIA_CONSTRAINTS: {
        HIGH_QUALITY: {
            video: {
                width: { min: 1280, ideal: 1920, max: 1920 },
                height: { min: 720, ideal: 1080, max: 1080 },
                frameRate: { min: 24, ideal: 30, max: 60 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        },

        STANDARD: {
            video: {
                width: { min: 640, ideal: 1280, max: 1280 },
                height: { min: 480, ideal: 720, max: 720 },
                frameRate: { min: 15, ideal: 30, max: 30 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100
            }
        },

        LOW_BANDWIDTH: {
            video: {
                width: { min: 320, ideal: 640, max: 640 },
                height: { min: 240, ideal: 480, max: 480 },
                frameRate: { min: 10, ideal: 15, max: 20 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 22050
            }
        },

        SURGICAL_CAMERA: {
            video: {
                width: { min: 1920, ideal: 4096, max: 4096 },
                height: { min: 1080, ideal: 2160, max: 2160 },
                frameRate: { min: 30, ideal: 60, max: 60 },
                facingMode: 'environment'
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000
            }
        }
    },

    // Screen sharing constraints
    SCREEN_SHARE_CONSTRAINTS: {
        video: {
            cursor: 'always',
            frameRate: { max: 30 },
            width: { max: 1920 },
            height: { max: 1080 }
        },
        audio: {
            echoCancellation: true,
            noiseSuppression: true
        }
    },

    // Data channel configurations
    DATA_CHANNEL_CONFIG: {
        RELIABLE: {
            ordered: true,
            maxRetransmitTime: 3000
        },
        UNRELIABLE: {
            ordered: false,
            maxRetransmits: 0
        },
        PARTIALLY_RELIABLE: {
            ordered: true,
            maxRetransmits: 3
        }
    }
};

// Adaptive quality management based on network conditions
export class AdaptiveQualityManager {
    constructor() {
        this.currentQuality = 'STANDARD';
        this.networkMetrics = {
            rtt: 0,
            packetLoss: 0,
            bandwidth: 0,
            jitter: 0
        };
        this.qualityHistory = [];
        this.lastAdjustment = Date.now();
        this.adjustmentCooldown = 10000; // 10 seconds
    }

    updateNetworkMetrics(stats) {
        try {
            // Extract relevant metrics from WebRTC stats
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    this.networkMetrics.rtt = report.currentRoundTripTime * 1000 || 0;
                }
                
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                    this.networkMetrics.packetLoss = report.packetsLost || 0;
                    this.networkMetrics.jitter = report.jitter || 0;
                }

                if (report.type === 'transport') {
                    this.networkMetrics.bandwidth = report.availableOutgoingBitrate || 0;
                }
            });

            return this.adjustQualityIfNeeded();
        } catch (error) {
            console.error('Error updating network metrics:', error);
            return null;
        }
    }

    adjustQualityIfNeeded() {
        const now = Date.now();
        if (now - this.lastAdjustment < this.adjustmentCooldown) {
            return null;
        }

        const qualityLevels = ['LOW_BANDWIDTH', 'STANDARD', 'HIGH_QUALITY'];
        const currentIndex = qualityLevels.indexOf(this.currentQuality);
        let newQuality = this.currentQuality;

        // Determine if we should upgrade or downgrade quality
        const shouldDowngrade = this.shouldDowngradeQuality();
        const shouldUpgrade = this.shouldUpgradeQuality();

        if (shouldDowngrade && currentIndex > 0) {
            newQuality = qualityLevels[currentIndex - 1];
        } else if (shouldUpgrade && currentIndex < qualityLevels.length - 1) {
            newQuality = qualityLevels[currentIndex + 1];
        }

        if (newQuality !== this.currentQuality) {
            this.currentQuality = newQuality;
            this.lastAdjustment = now;
            this.qualityHistory.push({
                quality: newQuality,
                timestamp: now,
                metrics: { ...this.networkMetrics }
            });

            console.log(`Quality adjusted to ${newQuality}`, this.networkMetrics);
            return {
                quality: newQuality,
                constraints: WebRTCConfig.MEDIA_CONSTRAINTS[newQuality],
                reason: shouldDowngrade ? 'network_degradation' : 'network_improvement'
            };
        }

        return null;
    }

    shouldDowngradeQuality() {
        return (
            this.networkMetrics.rtt > 200 ||
            this.networkMetrics.packetLoss > 5 ||
            this.networkMetrics.bandwidth < 500000 // 500 kbps
        );
    }

    shouldUpgradeQuality() {
        return (
            this.networkMetrics.rtt < 50 &&
            this.networkMetrics.packetLoss < 1 &&
            this.networkMetrics.bandwidth > 2000000 // 2 Mbps
        );
    }

    getCurrentConstraints() {
        return WebRTCConfig.MEDIA_CONSTRAINTS[this.currentQuality];
    }

    getQualityHistory() {
        return this.qualityHistory;
    }
}

// Network connectivity testing
export class ConnectivityTester {
    static async testConnectivity() {
        const results = {
            stun: false,
            turn: false,
            bandwidth: 0,
            latency: 0
        };

        try {
            // Test STUN server connectivity
            results.stun = await this.testSTUNConnectivity();
            
            // Test bandwidth (simplified)
            results.bandwidth = await this.estimateBandwidth();
            
            // Test latency
            results.latency = await this.measureLatency();

        } catch (error) {
            console.error('Connectivity test failed:', error);
        }

        return results;
    }

    static async testSTUNConnectivity() {
        return new Promise((resolve) => {
            const pc = new RTCPeerConnection({
                iceServers: WebRTCConfig.DEFAULT_ICE_SERVERS
            });

            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    pc.close();
                    resolve(false);
                }
            }, 10000);

            pc.onicecandidate = (event) => {
                if (event.candidate && event.candidate.type === 'srflx') {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        pc.close();
                        resolve(true);
                    }
                }
            };

            // Create a data channel to trigger ICE gathering
            pc.createDataChannel('test');
            pc.createOffer().then(offer => pc.setLocalDescription(offer));
        });
    }

    static async estimateBandwidth() {
        try {
            const startTime = performance.now();
            const response = await fetch('/api/health', { cache: 'no-cache' });
            const endTime = performance.now();
            
            const bytes = JSON.stringify(await response.json()).length;
            const duration = (endTime - startTime) / 1000;
            const bandwidth = (bytes * 8) / duration; // bits per second

            return bandwidth;
        } catch (error) {
            console.error('Bandwidth estimation failed:', error);
            return 0;
        }
    }

    static async measureLatency() {
        try {
            const startTime = performance.now();
            await fetch('/api/health', { cache: 'no-cache' });
            const endTime = performance.now();
            
            return endTime - startTime;
        } catch (error) {
            console.error('Latency measurement failed:', error);
            return 0;
        }
    }
}

// Error handling and recovery utilities
export class WebRTCErrorHandler {
    static handleMediaError(error) {
        const errorMappings = {
            'NotAllowedError': 'Camera/microphone access denied. Please allow access and try again.',
            'NotFoundError': 'Camera or microphone not found. Please check your devices.',
            'NotReadableError': 'Camera or microphone is already in use by another application.',
            'OverconstrainedError': 'Camera/microphone constraints cannot be satisfied.',
            'AbortError': 'Media access was aborted.',
            'TypeError': 'Invalid media constraints provided.'
        };

        const userMessage = errorMappings[error.name] || `Media access error: ${error.message}`;
        
        console.error('Media error:', error);
        
        return {
            type: 'media_error',
            name: error.name,
            message: error.message,
            userMessage,
            suggestions: this.getErrorSuggestions(error.name)
        };
    }

    static getErrorSuggestions(errorName) {
        switch (errorName) {
            case 'NotAllowedError':
                return [
                    'Click the camera icon in your browser address bar to allow access',
                    'Check browser settings for camera/microphone permissions',
                    'Refresh the page and try again'
                ];
            case 'NotFoundError':
                return [
                    'Connect a camera or microphone to your device',
                    'Check if your devices are properly connected',
                    'Try refreshing the page'
                ];
            case 'NotReadableError':
                return [
                    'Close other applications that might be using your camera/microphone',
                    'Restart your browser',
                    'Check if another tab is using the camera'
                ];
            default:
                return ['Try refreshing the page', 'Check your device connections'];
        }
    }

    static handlePeerConnectionError(error, userId) {
        console.error(`Peer connection error with user ${userId}:`, error);
        
        return {
            type: 'peer_connection_error',
            userId,
            error: error.message,
            timestamp: new Date().toISOString(),
            suggestions: [
                'Check your internet connection',
                'Try rejoining the call',
                'Contact support if the issue persists'
            ]
        };
    }
}

// Device management utilities
export class DeviceManager {
    static async getAvailableDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            return {
                audioInputs: devices.filter(d => d.kind === 'audioinput'),
                audioOutputs: devices.filter(d => d.kind === 'audiooutput'),
                videoInputs: devices.filter(d => d.kind === 'videoinput')
            };
        } catch (error) {
            console.error('Failed to enumerate devices:', error);
            return { audioInputs: [], audioOutputs: [], videoInputs: [] };
        }
    }

    static async switchCamera(stream, deviceId) {
        try {
            const videoTrack = stream.getVideoTracks()[0];
            
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: deviceId } },
                audio: stream.getAudioTracks().length > 0
            });

            // Replace the video track
            const newVideoTrack = newStream.getVideoTracks()[0];
            if (videoTrack) {
                await this.replaceTrack(videoTrack, newVideoTrack);
                videoTrack.stop();
            }

            return newStream;
        } catch (error) {
            console.error('Failed to switch camera:', error);
            throw error;
        }
    }

    static async switchMicrophone(stream, deviceId) {
        try {
            const audioTrack = stream.getAudioTracks()[0];
            
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: deviceId } },
                video: stream.getVideoTracks().length > 0
            });

            // Replace the audio track
            const newAudioTrack = newStream.getAudioTracks()[0];
            if (audioTrack) {
                await this.replaceTrack(audioTrack, newAudioTrack);
                audioTrack.stop();
            }

            return newStream;
        } catch (error) {
            console.error('Failed to switch microphone:', error);
            throw error;
        }
    }

    static async replaceTrack(oldTrack, newTrack) {
        // This would need reference to peer connections to replace tracks
        // Implementation would depend on the specific WebRTC service instance
        console.log('Track replacement requested:', { oldTrack, newTrack });
    }
}

// Performance monitoring utilities
export class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.listeners = new Set();
    }

    startMonitoring(peerConnections) {
        this.monitoringInterval = setInterval(async () => {
            const stats = await this.collectStats(peerConnections);
            this.updateMetrics(stats);
            this.notifyListeners(stats);
        }, 5000); // Collect stats every 5 seconds
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    async collectStats(peerConnections) {
        const allStats = new Map();
        
        for (const [userId, pc] of peerConnections) {
            try {
                const stats = await pc.getStats();
                allStats.set(userId, this.processStats(stats));
            } catch (error) {
                console.error(`Failed to collect stats for user ${userId}:`, error);
            }
        }

        return allStats;
    }

    processStats(rawStats) {
        const processed = {
            video: { inbound: {}, outbound: {} },
            audio: { inbound: {}, outbound: {} },
            connection: {}
        };

        rawStats.forEach(report => {
            switch (report.type) {
                case 'inbound-rtp':
                    if (report.mediaType === 'video') {
                        processed.video.inbound = {
                            packetsReceived: report.packetsReceived || 0,
                            packetsLost: report.packetsLost || 0,
                            bytesReceived: report.bytesReceived || 0,
                            frameWidth: report.frameWidth || 0,
                            frameHeight: report.frameHeight || 0,
                            framesReceived: report.framesReceived || 0,
                            framesDropped: report.framesDropped || 0
                        };
                    } else if (report.mediaType === 'audio') {
                        processed.audio.inbound = {
                            packetsReceived: report.packetsReceived || 0,
                            packetsLost: report.packetsLost || 0,
                            bytesReceived: report.bytesReceived || 0
                        };
                    }
                    break;

                case 'outbound-rtp':
                    if (report.mediaType === 'video') {
                        processed.video.outbound = {
                            packetsSent: report.packetsSent || 0,
                            bytesSent: report.bytesSent || 0,
                            framesSent: report.framesSent || 0,
                            frameWidth: report.frameWidth || 0,
                            frameHeight: report.frameHeight || 0
                        };
                    } else if (report.mediaType === 'audio') {
                        processed.audio.outbound = {
                            packetsSent: report.packetsSent || 0,
                            bytesSent: report.bytesSent || 0
                        };
                    }
                    break;

                case 'candidate-pair':
                    if (report.state === 'succeeded') {
                        processed.connection = {
                            currentRoundTripTime: report.currentRoundTripTime || 0,
                            availableOutgoingBitrate: report.availableOutgoingBitrate || 0,
                            availableIncomingBitrate: report.availableIncomingBitrate || 0
                        };
                    }
                    break;
            }
        });

        return processed;
    }

    updateMetrics(stats) {
        stats.forEach((userStats, userId) => {
            this.metrics.set(userId, {
                ...userStats,
                timestamp: Date.now()
            });
        });
    }

    addListener(callback) {
        this.listeners.add(callback);
    }

    removeListener(callback) {
        this.listeners.delete(callback);
    }

    notifyListeners(stats) {
        this.listeners.forEach(callback => {
            try {
                callback(stats);
            } catch (error) {
                console.error('Performance monitor listener error:', error);
            }
        });
    }

    getMetrics() {
        return new Map(this.metrics);
    }
}

// Export all utilities
export {
    WebRTCConfig,
    AdaptiveQualityManager,
    ConnectivityTester,
    WebRTCErrorHandler,
    DeviceManager,
    PerformanceMonitor
};