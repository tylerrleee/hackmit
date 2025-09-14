/**
 * Frontend External Configuration Manager (Legacy)
 * Handles dynamic API URLs for local vs external (Ngrok) deployments
 * 
 * @deprecated Use deploymentConfig.js for new implementations
 * This class is maintained for backward compatibility with existing components
 */

import deploymentConfig from './deploymentConfig';

class FrontendExternalConfig {
    constructor() {
        this.config = this.initializeConfig();
        this.loadFromEnvironment();
        this.detectExternalMode();
    }

    initializeConfig() {
        return {
            // Default local configuration
            apiBaseUrl: 'http://localhost:3001',
            websocketUrl: 'ws://localhost:8765',
            
            // External mode settings
            externalMode: false,
            externalApiUrl: null,
            externalWebsocketUrl: null,
            
            // Runtime configuration
            isExternal: false,
            currentApiUrl: null,
            currentWebsocketUrl: null
        };
    }

    loadFromEnvironment() {
        // Check for React environment variables
        if (process.env.REACT_APP_API_URL) {
            this.config.apiBaseUrl = process.env.REACT_APP_API_URL;
            this.config.externalApiUrl = process.env.REACT_APP_API_URL;
        }

        if (process.env.REACT_APP_WEBSOCKET_URL) {
            this.config.websocketUrl = process.env.REACT_APP_WEBSOCKET_URL;
            this.config.externalWebsocketUrl = process.env.REACT_APP_WEBSOCKET_URL;
        }

        if (process.env.REACT_APP_EXTERNAL_MODE === 'true') {
            this.config.externalMode = true;
        }
    }

    detectExternalMode() {
        // Auto-detect if running with external URLs
        const hostname = window.location.hostname;
        const isNgrok = hostname.includes('ngrok-free.app') || 
                       hostname.includes('ngrok.io') || 
                       hostname.includes('ngrok.app');
        
        if (isNgrok || this.config.externalMode) {
            this.config.isExternal = true;
            this.setExternalMode();
        } else {
            this.setLocalMode();
        }
    }

    setLocalMode() {
        this.config.isExternal = false;
        this.config.currentApiUrl = this.config.apiBaseUrl;
        this.config.currentWebsocketUrl = this.config.websocketUrl;
        
        console.log('🏠 Frontend running in LOCAL mode');
    }

    setExternalMode() {
        this.config.isExternal = true;
        this.config.currentApiUrl = this.config.externalApiUrl || this.config.apiBaseUrl;
        this.config.currentWebsocketUrl = this.config.externalWebsocketUrl || this.config.websocketUrl;
        
        console.log('🌐 Frontend running in EXTERNAL mode');
    }

    updateExternalUrls(urls) {
        /**
         * Update configuration with dynamically generated external URLs
         * @param {Object} urls - Object containing external URLs
         */
        if (urls.api || urls.backend) {
            this.config.externalApiUrl = urls.api || urls.backend;
            this.config.currentApiUrl = this.config.externalApiUrl;
        }

        if (urls.websocket || urls.bridge) {
            this.config.externalWebsocketUrl = urls.websocket || urls.bridge;
            this.config.currentWebsocketUrl = this.config.externalWebsocketUrl;
        }

        console.log('🔄 Frontend external URLs updated:', {
            api: this.config.currentApiUrl,
            websocket: this.config.currentWebsocketUrl
        });
    }

    getApiUrl() {
        // Fallback to new deployment config for better compatibility
        return this.config.currentApiUrl || deploymentConfig.getApiUrl();
    }

    getWebSocketUrl() {
        // Fallback to new deployment config for better compatibility  
        return this.config.currentWebsocketUrl || deploymentConfig.getWsUrl();
    }

    getArBridgeUrl() {
        // New method for AR bridge URL support
        return deploymentConfig.getArBridgeUrl();
    }

    isExternalMode() {
        return this.config.isExternal;
    }

    getConfig() {
        return { ...this.config };
    }

    // Utility methods for making API calls
    async fetch(endpoint, options = {}) {
        const url = `${this.getApiUrl()}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
        
        const defaultOptions = {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...(options)
        };

        try {
            const response = await fetch(url, defaultOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return response;
        } catch (error) {
            console.error('🚨 API request failed:', { url, error: error.message });
            throw error;
        }
    }

    // WebSocket connection helper
    createWebSocket() {
        const wsUrl = this.getWebSocketUrl();
        console.log('🔌 Connecting WebSocket to:', wsUrl);
        
        try {
            return new WebSocket(wsUrl);
        } catch (error) {
            console.error('🚨 WebSocket connection failed:', { url: wsUrl, error: error.message });
            throw error;
        }
    }

    // Health check for external connectivity
    async testConnectivity() {
        try {
            const response = await this.fetch('/api/health');
            const data = await response.json();
            
            console.log('✅ Connectivity test passed:', data);
            return { success: true, data };
        } catch (error) {
            console.error('❌ Connectivity test failed:', error);
            return { success: false, error: error.message };
        }
    }

    // Display current configuration info
    logConfiguration() {
        console.log('🔧 Frontend Configuration:', {
            mode: this.config.isExternal ? 'External' : 'Local',
            apiUrl: this.config.currentApiUrl,
            websocketUrl: this.config.currentWebsocketUrl,
            hostname: window.location.hostname,
            externalMode: this.config.externalMode
        });
    }
}

// Create singleton instance
const frontendExternalConfig = new FrontendExternalConfig();

// Log configuration on startup
frontendExternalConfig.logConfiguration();

// Export as default
export default frontendExternalConfig;