#!/usr/bin/env python3
"""
External Configuration Manager for WebRTC Bridge
Handles dynamic configuration for local vs external (Ngrok) deployments
"""

import os
import json
from typing import Dict, Optional
from dotenv import load_dotenv


class ExternalConfigManager:
    """Manages external configuration for WebRTC bridge service"""
    
    def __init__(self):
        self.config = {}
        self.load_configuration()
    
    def load_configuration(self):
        """Load configuration from environment files"""
        # Load base .env file first
        base_env_path = '.env'
        if os.path.exists(base_env_path):
            load_dotenv(base_env_path)
        
        # Check if external mode is enabled
        external_mode = (
            os.getenv('EXTERNAL_MODE', 'false').lower() == 'true' or 
            os.getenv('NODE_ENV') == 'external'
        )
        
        if external_mode:
            # Load external configuration
            external_env_path = '.env.external'
            if os.path.exists(external_env_path):
                load_dotenv(external_env_path, override=True)
                print('🌐 Python external configuration loaded')
            else:
                print('⚠️  External mode enabled but .env.external not found')
        
        # Build unified configuration
        self.config = {
            # External Mode Settings
            'external_mode': external_mode,
            'is_external': external_mode,
            
            # Server Configuration
            'webrtc_backend_url': os.getenv('API_BASE_URL', 'http://localhost:3001'),
            'backend_external_url': os.getenv('BACKEND_EXTERNAL_URL', None),
            
            # Bridge Configuration  
            'bridge_websocket_url': os.getenv('AR_BRIDGE_URL', 'ws://localhost:8765'),
            'bridge_http_url': os.getenv('AR_BRIDGE_HTTP_URL', 'http://localhost:8766'),
            'bridge_ws_port': int(os.getenv('AR_BRIDGE_WS_PORT', '8765')),
            'bridge_http_port': int(os.getenv('AR_BRIDGE_HTTP_PORT', '8766')),
            
            # Frontend Configuration
            'frontend_url': os.getenv('FRONTEND_EXTERNAL_URL', 'http://localhost:3000'),
            'cors_origins': self._build_cors_origins(),
            
            # External-specific settings
            'external_timeout': int(os.getenv('EXTERNAL_TIMEOUT', '60000')),
            'connection_retry_attempts': int(os.getenv('CONNECTION_RETRY_ATTEMPTS', '3')),
            'heartbeat_interval': int(os.getenv('HEARTBEAT_INTERVAL', '30000')),
            
            # Ngrok settings
            'ngrok_auth_token': os.getenv('NGROK_AUTH_TOKEN'),
            'ngrok_region': os.getenv('NGROK_REGION', 'us'),
        }
    
    def _build_cors_origins(self) -> list:
        """Build CORS origins list"""
        origins = [
            os.getenv('CORS_ORIGIN', 'http://localhost:3000')
        ]
        
        # Add external URL if available
        if os.getenv('FRONTEND_EXTERNAL_URL'):
            origins.append(os.getenv('FRONTEND_EXTERNAL_URL'))
        
        # Add Ngrok patterns for external mode
        if self.config.get('external_mode', False):
            origins.extend([
                'https://*.ngrok-free.app',
                'https://*.ngrok.io',
                'https://*.ngrok.app'
            ])
        
        return list(set(origins))  # Remove duplicates
    
    def update_external_urls(self, urls: Dict[str, str]):
        """
        Update configuration with dynamically generated Ngrok URLs
        
        Args:
            urls: Dictionary containing external URLs
                  {
                      'backend': 'https://abc.ngrok-free.app',
                      'frontend': 'https://def.ngrok-free.app', 
                      'bridge': 'wss://ghi.ngrok-free.app',
                      'bridge_http': 'https://jkl.ngrok-free.app'
                  }
        """
        if 'backend' in urls:
            self.config['webrtc_backend_url'] = urls['backend']
            self.config['backend_external_url'] = urls['backend']
            os.environ['API_BASE_URL'] = urls['backend']
            os.environ['BACKEND_EXTERNAL_URL'] = urls['backend']
        
        if 'frontend' in urls:
            self.config['frontend_url'] = urls['frontend']
            os.environ['FRONTEND_EXTERNAL_URL'] = urls['frontend']
            os.environ['CORS_ORIGIN'] = urls['frontend']
        
        if 'bridge' in urls:
            self.config['bridge_websocket_url'] = urls['bridge']
            os.environ['AR_BRIDGE_URL'] = urls['bridge']
        
        if 'bridge_http' in urls:
            self.config['bridge_http_url'] = urls['bridge_http']
            os.environ['AR_BRIDGE_HTTP_URL'] = urls['bridge_http']
        
        # Update CORS origins
        self.config['cors_origins'] = self._build_cors_origins()
        
        print('🔄 Python external URLs updated:', {
            'backend': self.config['webrtc_backend_url'],
            'frontend': self.config['frontend_url'],
            'bridge_ws': self.config['bridge_websocket_url'],
            'bridge_http': self.config['bridge_http_url']
        })
    
    def get_config(self) -> Dict:
        """Get current configuration"""
        return self.config.copy()
    
    def is_external_mode(self) -> bool:
        """Check if running in external mode"""
        return self.config.get('external_mode', False)
    
    def get_webrtc_backend_url(self) -> str:
        """Get WebRTC backend URL"""
        return self.config['webrtc_backend_url']
    
    def get_bridge_websocket_url(self) -> str:
        """Get bridge WebSocket URL"""
        return self.config['bridge_websocket_url']
    
    def get_bridge_http_url(self) -> str:
        """Get bridge HTTP URL"""
        return self.config['bridge_http_url']
    
    def get_frontend_url(self) -> str:
        """Get frontend URL"""
        return self.config['frontend_url']
    
    def get_cors_origins(self) -> list:
        """Get CORS origins"""
        return self.config['cors_origins']
    
    def get_display_info(self) -> Dict:
        """Get configuration display info"""
        mode = 'External' if self.is_external_mode() else 'Local'
        return {
            'mode': mode,
            'backend': self.config['webrtc_backend_url'],
            'frontend': self.config['frontend_url'],
            'bridge_ws': self.config['bridge_websocket_url'],
            'bridge_http': self.config['bridge_http_url'],
            'cors_origins': self.config['cors_origins']
        }
    
    def log_configuration(self):
        """Log current configuration"""
        config_info = self.get_display_info()
        print('🔧 Python Bridge Configuration:', json.dumps(config_info, indent=2))
        
        if self.is_external_mode():
            print('🌐 Python bridge running in EXTERNAL mode - ready for Ngrok tunnels')
        else:
            print('🏠 Python bridge running in LOCAL mode')


# Create singleton instance
external_config = ExternalConfigManager()

# Log configuration on import
external_config.log_configuration()