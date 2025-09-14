/**
 * Deployment-Aware Configuration Service
 * Handles configuration for multiple deployment targets (Local, Vercel, Railway, Render)
 */

class DeploymentConfig {
    constructor() {
        this.deploymentTarget = process.env.REACT_APP_DEPLOYMENT_TARGET || this.detectDeploymentTarget();
        this.environment = process.env.NODE_ENV || 'development';
        this.config = this.buildConfiguration();
        
        console.log(`🎯 Deployment Target: ${this.deploymentTarget}`);
        console.log(`🌍 Environment: ${this.environment}`);
    }

    detectDeploymentTarget() {
        if (typeof window === 'undefined') return 'local';
        
        const hostname = window.location.hostname;
        
        if (hostname.includes('vercel.app')) return 'vercel';
        if (hostname.includes('railway.app')) return 'railway';
        if (hostname.includes('render.com')) return 'render';
        if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) return 'local';
        if (hostname.includes('ngrok')) return 'ngrok';
        
        return 'custom';
    }

    buildConfiguration() {
        const baseConfig = {
            deploymentTarget: this.deploymentTarget,
            environment: this.environment,
            isProduction: this.environment === 'production',
            isDevelopment: this.environment === 'development',
            version: process.env.REACT_APP_VERSION || '1.0.0'
        };

        // Configuration per deployment target
        const deploymentConfigs = {
            local: {
                apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3001',
                wsUrl: process.env.REACT_APP_WS_URL || 'ws://localhost:3001',
                arBridgeUrl: process.env.REACT_APP_AR_BRIDGE_URL || 'ws://localhost:8765',
                allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'],
                enableDevTools: true,
                enableServiceWorker: false
            },
            
            vercel: {
                apiUrl: process.env.REACT_APP_API_URL || this.getVercelApiUrl(),
                wsUrl: process.env.REACT_APP_WS_URL || this.getVercelWsUrl(),
                arBridgeUrl: process.env.REACT_APP_AR_BRIDGE_URL || this.getVercelArBridgeUrl(),
                allowedOrigins: this.getVercelAllowedOrigins(),
                enableDevTools: false,
                enableServiceWorker: true,
                enableOfflineMode: true,
                corsMode: 'cors'
            },

            railway: {
                apiUrl: process.env.REACT_APP_API_URL || 'https://webrtc-surgical-backend.railway.app',
                wsUrl: process.env.REACT_APP_WS_URL || 'wss://webrtc-surgical-backend.railway.app',
                arBridgeUrl: process.env.REACT_APP_AR_BRIDGE_URL || 'wss://webrtc-surgical-bridge.railway.app',
                allowedOrigins: ['https://*.railway.app'],
                enableDevTools: false,
                enableServiceWorker: true
            },

            render: {
                apiUrl: process.env.REACT_APP_API_URL || 'https://webrtc-surgical-backend.onrender.com',
                wsUrl: process.env.REACT_APP_WS_URL || 'wss://webrtc-surgical-backend.onrender.com',
                arBridgeUrl: process.env.REACT_APP_AR_BRIDGE_URL || 'wss://webrtc-surgical-bridge.onrender.com',
                allowedOrigins: ['https://*.onrender.com'],
                enableDevTools: false,
                enableServiceWorker: true
            },

            ngrok: {
                apiUrl: process.env.REACT_APP_API_URL || this.getNgrokApiUrl(),
                wsUrl: process.env.REACT_APP_WS_URL || this.getNgrokWsUrl(),
                arBridgeUrl: process.env.REACT_APP_AR_BRIDGE_URL || this.getNgrokArBridgeUrl(),
                allowedOrigins: ['https://*.ngrok-free.app'],
                enableDevTools: true,
                enableServiceWorker: false
            },

            custom: {
                apiUrl: process.env.REACT_APP_API_URL || window.location.origin,
                wsUrl: process.env.REACT_APP_WS_URL || `wss://${window.location.host}`,
                arBridgeUrl: process.env.REACT_APP_AR_BRIDGE_URL || `wss://${window.location.host}:8765`,
                allowedOrigins: [window.location.origin],
                enableDevTools: false,
                enableServiceWorker: true
            }
        };

        return {
            ...baseConfig,
            ...deploymentConfigs[this.deploymentTarget],
            // Add connection retry configuration
            connectionRetry: {
                maxAttempts: this.deploymentTarget === 'local' ? 3 : 10,
                retryDelay: this.deploymentTarget === 'local' ? 1000 : 3000,
                backoffFactor: 1.5
            },
            // Add feature flags
            features: {
                enableVideoChat: true,
                enableARAnnotations: true,
                enableTranslation: process.env.REACT_APP_ENABLE_TRANSLATION === 'true',
                enableOfflineMode: process.env.REACT_APP_ENABLE_OFFLINE_MODE === 'true' || this.deploymentTarget === 'vercel',
                enablePWA: process.env.REACT_APP_PWA_ENABLED === 'true',
                enableAnalytics: this.environment === 'production'
            }
        };
    }

    // Vercel-specific URL resolution
    getVercelApiUrl() {
        if (typeof window === 'undefined') return '';
        
        // Try to read from runtime config if available
        if (window.__RUNTIME_CONFIG__?.apiUrl) {
            return window.__RUNTIME_CONFIG__.apiUrl;
        }
        
        // Fallback to environment or default
        return process.env.REACT_APP_API_URL || 'https://your-backend-service.railway.app';
    }

    getVercelWsUrl() {
        const apiUrl = this.getVercelApiUrl();
        return apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    }

    getVercelArBridgeUrl() {
        if (window.__RUNTIME_CONFIG__?.arBridgeUrl) {
            return window.__RUNTIME_CONFIG__.arBridgeUrl;
        }
        return process.env.REACT_APP_AR_BRIDGE_URL || 'wss://your-bridge-service.railway.app';
    }

    getVercelAllowedOrigins() {
        const origins = ['https://*.vercel.app'];
        if (this.config?.apiUrl) {
            const apiDomain = new URL(this.config.apiUrl).origin;
            origins.push(apiDomain);
        }
        return origins;
    }

    // Ngrok-specific URL resolution
    getNgrokApiUrl() {
        // For ngrok, try to detect from existing external config
        if (window.__EXTERNAL_CONFIG__?.apiUrl) {
            return window.__EXTERNAL_CONFIG__.apiUrl;
        }
        return process.env.REACT_APP_API_URL || 'https://your-backend.ngrok-free.app';
    }

    getNgrokWsUrl() {
        const apiUrl = this.getNgrokApiUrl();
        return apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    }

    getNgrokArBridgeUrl() {
        if (window.__EXTERNAL_CONFIG__?.arBridgeUrl) {
            return window.__EXTERNAL_CONFIG__.arBridgeUrl;
        }
        return process.env.REACT_APP_AR_BRIDGE_URL || 'wss://your-bridge.ngrok-free.app';
    }

    // Configuration getters
    getApiUrl() {
        return this.config.apiUrl;
    }

    getWsUrl() {
        return this.config.wsUrl;
    }

    getArBridgeUrl() {
        return this.config.arBridgeUrl;
    }

    getAllowedOrigins() {
        return this.config.allowedOrigins;
    }

    getConnectionRetryConfig() {
        return this.config.connectionRetry;
    }

    getFeatures() {
        return this.config.features;
    }

    isFeatureEnabled(featureName) {
        return this.config.features[featureName] || false;
    }

    // Health check for external services
    async healthCheck() {
        try {
            const response = await fetch(`${this.getApiUrl()}/api/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });
            
            return {
                healthy: response.ok,
                status: response.status,
                deploymentTarget: this.deploymentTarget
            };
        } catch (error) {
            console.warn('Health check failed:', error.message);
            return {
                healthy: false,
                error: error.message,
                deploymentTarget: this.deploymentTarget
            };
        }
    }

    // Development helpers
    logConfiguration() {
        if (this.config.enableDevTools) {
            console.group('🔧 Deployment Configuration');
            console.log('Target:', this.deploymentTarget);
            console.log('Environment:', this.environment);
            console.log('API URL:', this.getApiUrl());
            console.log('WebSocket URL:', this.getWsUrl());
            console.log('AR Bridge URL:', this.getArBridgeUrl());
            console.log('Features:', this.getFeatures());
            console.groupEnd();
        }
    }
}

// Create singleton instance
const deploymentConfig = new DeploymentConfig();

// Log configuration in development
if (deploymentConfig.config.enableDevTools) {
    deploymentConfig.logConfiguration();
}

export default deploymentConfig;