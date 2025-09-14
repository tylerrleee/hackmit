/**
 * External Configuration Manager
 * Handles dynamic configuration for local vs external (Ngrok) deployments
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

class ExternalConfigManager {
    constructor() {
        this.config = {};
        this.loadConfiguration();
    }

    loadConfiguration() {
        // Load base .env file first
        const baseEnvPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(baseEnvPath)) {
            dotenv.config({ path: baseEnvPath });
        }

        // Check if external mode is enabled
        const externalMode = process.env.EXTERNAL_MODE === 'true' || 
                           process.env.NODE_ENV === 'external';

        if (externalMode) {
            // Load external configuration
            const externalEnvPath = path.join(process.cwd(), '.env.external');
            if (fs.existsSync(externalEnvPath)) {
                dotenv.config({ path: externalEnvPath, override: true });
                console.log('🌐 External configuration loaded');
            } else {
                console.warn('⚠️  External mode enabled but .env.external not found');
            }
        }

        // Build unified configuration
        this.config = {
            // Server Configuration
            port: process.env.PORT || 3001,
            nodeEnv: process.env.NODE_ENV || 'development',
            apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`,
            backendExternalUrl: process.env.BACKEND_EXTERNAL_URL || null,
            
            // External Mode Settings
            externalMode: externalMode,
            frontendUrl: process.env.FRONTEND_EXTERNAL_URL || process.env.CORS_ORIGIN || 'http://localhost:3000',
            
            // Bridge Configuration
            bridgeUrl: process.env.AR_BRIDGE_URL || 'ws://localhost:8765',
            bridgeHttpUrl: process.env.AR_BRIDGE_HTTP_URL || 'http://localhost:8766',
            
            // CORS Configuration
            corsOrigins: this.buildCorsOrigins(),
            
            // WebRTC Configuration
            stunServer: process.env.STUN_SERVER || 'stun:stun.l.google.com:19302',
            turnServer: process.env.TURN_SERVER,
            turnUsername: process.env.TURN_USERNAME,
            turnCredential: process.env.TURN_CREDENTIAL,
            
            // Security
            jwtSecret: process.env.JWT_SECRET,
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || (externalMode ? 200 : 100),
            
            // Database
            mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/surgical_platform',
            redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
            
            // External-specific settings
            externalTimeout: parseInt(process.env.EXTERNAL_TIMEOUT) || 60000,
            connectionRetryAttempts: parseInt(process.env.CONNECTION_RETRY_ATTEMPTS) || 3,
            heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
            
            // Ngrok settings
            ngrokAuthToken: process.env.NGROK_AUTH_TOKEN,
            ngrokRegion: process.env.NGROK_REGION || 'us',
            ngrokBindTls: process.env.NGROK_BIND_TLS === 'true'
        };
    }

    buildCorsOrigins() {
        const origins = [];

        // Base CORS origins
        const baseOrigins = process.env.CORS_ORIGIN ? 
            process.env.CORS_ORIGIN.split(',').map(o => o.trim()) : 
            ['http://localhost:3000'];
        
        origins.push(...baseOrigins);

        // Add external URL if available
        if (process.env.FRONTEND_EXTERNAL_URL) {
            origins.push(process.env.FRONTEND_EXTERNAL_URL);
        }

        // Add deployment-specific origins
        const deploymentTarget = process.env.REACT_APP_DEPLOYMENT_TARGET || 
                                process.env.DEPLOYMENT_TARGET || 
                                'local';

        switch (deploymentTarget) {
            case 'vercel':
                origins.push('https://*.vercel.app');
                origins.push('https://webrtc-surgical-platform.vercel.app');
                break;
            
            case 'railway':
                origins.push('https://*.railway.app');
                break;
                
            case 'render':
                origins.push('https://*.onrender.com');
                break;
                
            case 'ngrok':
            case 'external':
                origins.push('https://*.ngrok-free.app');
                origins.push('https://*.ngrok.io');
                origins.push('https://*.ngrok.app');
                break;
        }

        // Add development origins
        if (this.config?.nodeEnv === 'development') {
            origins.push('http://localhost:3000');
            origins.push('http://localhost:3001');
            origins.push('http://127.0.0.1:3000');
            origins.push('http://127.0.0.1:3001');
        }

        // Add external mode origins
        if (this.config?.externalMode) {
            origins.push('https://*.ngrok-free.app');
            origins.push('https://*.ngrok.io');
            origins.push('https://*.ngrok.app');
        }

        // Remove duplicates and return unique origins
        const uniqueOrigins = [...new Set(origins)];
        console.log('🔧 CORS Origins configured:', uniqueOrigins);
        
        return uniqueOrigins;
    }

    updateExternalUrls(urls) {
        /**
         * Update configuration with dynamically generated Ngrok URLs
         * @param {Object} urls - Object containing the external URLs
         */
        if (urls.backend) {
            this.config.apiBaseUrl = urls.backend;
            this.config.backendExternalUrl = urls.backend;
            process.env.API_BASE_URL = urls.backend;
            process.env.BACKEND_EXTERNAL_URL = urls.backend;
        }

        if (urls.frontend) {
            this.config.frontendUrl = urls.frontend;
            process.env.FRONTEND_EXTERNAL_URL = urls.frontend;
            process.env.CORS_ORIGIN = urls.frontend;
        }

        if (urls.bridge) {
            this.config.bridgeUrl = urls.bridge;
            process.env.AR_BRIDGE_URL = urls.bridge;
        }

        if (urls.bridgeHttp) {
            this.config.bridgeHttpUrl = urls.bridgeHttp;
            process.env.AR_BRIDGE_HTTP_URL = urls.bridgeHttp;
        }

        // Update CORS origins
        this.config.corsOrigins = this.buildCorsOrigins();

        console.log('🔄 External URLs updated:', {
            backend: this.config.apiBaseUrl,
            frontend: this.config.frontendUrl,
            bridge: this.config.bridgeUrl,
            bridgeHttp: this.config.bridgeHttpUrl
        });
    }

    getConfig() {
        return { ...this.config };
    }

    isExternalMode() {
        return this.config.externalMode;
    }

    getDisplayInfo() {
        const mode = this.isExternalMode() ? 'External' : 'Local';
        return {
            mode,
            backend: this.config.apiBaseUrl,
            frontend: this.config.frontendUrl,
            bridge: this.config.bridgeUrl,
            corsOrigins: this.config.corsOrigins
        };
    }
}

// Singleton instance
const externalConfig = new ExternalConfigManager();

module.exports = externalConfig;