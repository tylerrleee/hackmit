#!/usr/bin/env python3
"""
WebRTC-AR Bridge Service
Connects WebRTC web platform with AR field medic systems
"""

import asyncio
import websockets
import json
import requests
import logging
import argparse
from typing import Dict, Set
import threading
import time
from aiohttp import web
import aiohttp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WebRTCARBridge:
    def __init__(self, webrtc_url: str, ar_port: int = 8765, http_port: int = 8766):
        self.webrtc_url = webrtc_url
        self.ar_port = ar_port
        self.http_port = http_port
        self.ar_clients: Set[websockets.WebSocketServerProtocol] = set()
        self.room_connections: Dict[str, Set[websockets.WebSocketServerProtocol]] = {}
        self.active_video_calls: Dict[str, Dict] = {}
        
    async def register_ar_client(self, websocket, path):
        """Handle AR client connections"""
        try:
            logger.info(f"AR client connected from {websocket.remote_address}")
            self.ar_clients.add(websocket)
            
            async for message in websocket:
                try:
                    data = json.loads(message)
                    await self.handle_ar_message(websocket, data)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON from AR client: {e}")
                except Exception as e:
                    logger.error(f"Error handling AR message: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info("AR client disconnected")
        except Exception as e:
            logger.error(f"AR client error: {e}")
        finally:
            self.ar_clients.discard(websocket)
            # Remove from room connections
            for room_id, clients in self.room_connections.items():
                clients.discard(websocket)
    
    async def handle_ar_message(self, websocket, data):
        """Process messages from AR clients"""
        message_type = data.get('type')
        
        if message_type == 'join_room':
            room_id = data.get('roomId')
            if room_id:
                if room_id not in self.room_connections:
                    self.room_connections[room_id] = set()
                self.room_connections[room_id].add(websocket)
                
                # Notify WebRTC platform of AR client joining
                await self.notify_webrtc_platform('ar_client_joined', {
                    'roomId': room_id,
                    'clientType': 'ar_field_medic'
                })
                
                logger.info(f"AR client joined room {room_id}")
                
        elif message_type == 'annotation':
            room_id = data.get('roomId')
            if room_id and room_id in self.room_connections:
                # Forward annotation to WebRTC platform
                await self.notify_webrtc_platform('ar_annotation', {
                    'roomId': room_id,
                    'annotation': data.get('annotation'),
                    'timestamp': data.get('timestamp'),
                    'source': 'ar_field_medic'
                })
                
                # Forward to other AR clients in the same room
                for client in self.room_connections[room_id]:
                    if client != websocket:
                        try:
                            await client.send(json.dumps({
                                'type': 'annotation_received',
                                'annotation': data.get('annotation'),
                                'source': 'peer'
                            }))
                        except:
                            pass
        
        elif message_type == 'video_call_started':
            # AR client confirmed video call start
            room_id = data.get('roomId')
            if room_id and room_id in self.active_video_calls:
                self.active_video_calls[room_id]['ar_ready'] = True
                logger.info(f"AR client ready for video call in room {room_id}")
        
        elif message_type == 'video_call_ended':
            # AR client confirmed video call end
            room_id = data.get('roomId')
            if room_id and room_id in self.active_video_calls:
                del self.active_video_calls[room_id]
                logger.info(f"Video call ended in room {room_id}")
        
        elif message_type == 'video_frame':
            # Forward video frame to WebRTC platform (if needed)
            room_id = data.get('roomId')
            if room_id and room_id in self.active_video_calls:
                await self.notify_webrtc_platform('video_frame', {
                    'roomId': room_id,
                    'frameData': data.get('frameData'),
                    'timestamp': data.get('timestamp')
                })
    
    async def notify_webrtc_platform(self, event_type: str, data: dict):
        """Send events to WebRTC platform"""
        try:
            # Use HTTP POST to notify the WebRTC platform
            payload = {
                'type': event_type,
                'data': data
            }
            
            # For now, just log the notification
            # In a full implementation, this would send to the WebRTC signaling server
            logger.info(f"Notifying WebRTC platform: {event_type} - {data}")
            
        except Exception as e:
            logger.error(f"Error notifying WebRTC platform: {e}")
    
    async def start_ar_websocket_server(self):
        """Start WebSocket server for AR clients"""
        logger.info(f"Starting AR WebSocket server on port {self.ar_port}")
        
        # Create a wrapper function that provides the path parameter
        async def websocket_handler(websocket):
            await self.register_ar_client(websocket, "/")
        
        server = await websockets.serve(
            websocket_handler,
            "0.0.0.0",
            self.ar_port,
            ping_interval=20,
            ping_timeout=10
        )
        
        logger.info(f"AR WebSocket server started on ws://localhost:{self.ar_port}")
        return server
    
    async def setup_http_server(self):
        """Setup HTTP server for receiving commands from backend"""
        app = web.Application()
        
        # Add routes for video call control
        app.router.add_post('/video-call/start', self.handle_start_video_call_http)
        app.router.add_post('/video-call/end', self.handle_end_video_call_http)
        app.router.add_get('/video-call/status/{room_id}', self.handle_video_call_status)
        app.router.add_get('/health', self.handle_health_check)
        
        # Enable CORS
        app.router.add_options('/{path:.*}', self.handle_cors_preflight)
        
        return app
    
    async def handle_cors_preflight(self, request):
        """Handle CORS preflight requests"""
        return web.Response(
            headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        )
    
    async def handle_start_video_call_http(self, request):
        """HTTP endpoint to start video call"""
        try:
            data = await request.json()
            room_id = data.get('roomId')
            surgeon_id = data.get('surgeonId')
            
            if not room_id:
                return web.json_response(
                    {'success': False, 'error': 'Room ID required'}, 
                    status=400
                )
            
            # Track video call
            self.active_video_calls[room_id] = {
                'surgeon_id': surgeon_id,
                'start_time': time.time(),
                'ar_ready': False,
                'status': 'starting'
            }
            
            # Send start command to AR clients in the room
            if room_id in self.room_connections:
                message = {
                    'type': 'start_video_call',
                    'roomId': room_id,
                    'surgeonId': surgeon_id,
                    'timestamp': time.time()
                }
                
                for client in self.room_connections[room_id]:
                    try:
                        await client.send(json.dumps(message))
                        logger.info(f"Sent start video call command to AR client in room {room_id}")
                    except Exception as e:
                        logger.error(f"Failed to send start command to AR client: {e}")
            
            return web.json_response({
                'success': True,
                'message': 'Video call start command sent',
                'roomId': room_id,
                'status': 'starting'
            }, headers={'Access-Control-Allow-Origin': '*'})
            
        except Exception as e:
            logger.error(f"Error starting video call: {e}")
            return web.json_response(
                {'success': False, 'error': str(e)},
                status=500,
                headers={'Access-Control-Allow-Origin': '*'}
            )
    
    async def handle_end_video_call_http(self, request):
        """HTTP endpoint to end video call"""
        try:
            data = await request.json()
            room_id = data.get('roomId')
            surgeon_id = data.get('surgeonId')
            
            if not room_id:
                return web.json_response(
                    {'success': False, 'error': 'Room ID required'},
                    status=400
                )
            
            # Send end command to AR clients in the room
            if room_id in self.room_connections:
                message = {
                    'type': 'end_video_call',
                    'roomId': room_id,
                    'surgeonId': surgeon_id,
                    'timestamp': time.time()
                }
                
                for client in self.room_connections[room_id]:
                    try:
                        await client.send(json.dumps(message))
                        logger.info(f"Sent end video call command to AR client in room {room_id}")
                    except Exception as e:
                        logger.error(f"Failed to send end command to AR client: {e}")
            
            # Remove from active calls
            if room_id in self.active_video_calls:
                call_info = self.active_video_calls[room_id]
                del self.active_video_calls[room_id]
                
                return web.json_response({
                    'success': True,
                    'message': 'Video call ended',
                    'roomId': room_id,
                    'duration': time.time() - call_info.get('start_time', 0)
                }, headers={'Access-Control-Allow-Origin': '*'})
            else:
                return web.json_response({
                    'success': True,
                    'message': 'No active video call found for room',
                    'roomId': room_id
                }, headers={'Access-Control-Allow-Origin': '*'})
            
        except Exception as e:
            logger.error(f"Error ending video call: {e}")
            return web.json_response(
                {'success': False, 'error': str(e)},
                status=500,
                headers={'Access-Control-Allow-Origin': '*'}
            )
    
    async def handle_video_call_status(self, request):
        """HTTP endpoint to get video call status"""
        try:
            room_id = request.match_info['room_id']
            
            if room_id in self.active_video_calls:
                call_info = self.active_video_calls[room_id]
                return web.json_response({
                    'success': True,
                    'roomId': room_id,
                    'status': call_info.get('status', 'active'),
                    'isActive': True,
                    'arReady': call_info.get('ar_ready', False),
                    'duration': time.time() - call_info.get('start_time', 0)
                }, headers={'Access-Control-Allow-Origin': '*'})
            else:
                return web.json_response({
                    'success': True,
                    'roomId': room_id,
                    'status': 'inactive',
                    'isActive': False
                }, headers={'Access-Control-Allow-Origin': '*'})
                
        except Exception as e:
            logger.error(f"Error getting video call status: {e}")
            return web.json_response(
                {'success': False, 'error': str(e)},
                status=500,
                headers={'Access-Control-Allow-Origin': '*'}
            )
    
    async def handle_health_check(self, request):
        """Health check endpoint"""
        return web.json_response({
            'success': True,
            'status': 'operational',
            'arClients': len(self.ar_clients),
            'activeRooms': len(self.room_connections),
            'activeCalls': len(self.active_video_calls),
            'timestamp': time.time()
        }, headers={'Access-Control-Allow-Origin': '*'})
    
    def test_webrtc_connection(self, room_id: str):
        """Test connection to WebRTC platform"""
        try:
            # Test room exists
            response = requests.get(f"{self.webrtc_url}/api/rooms/{room_id}")
            if response.status_code == 200:
                logger.info(f"✅ Room {room_id} exists and is accessible")
                return True
            else:
                logger.warning(f"❌ Room {room_id} not found or inaccessible")
                return False
        except Exception as e:
            logger.error(f"❌ Error testing WebRTC connection: {e}")
            return False
    
    async def run(self, test_room_id: str = None):
        """Start the bridge service"""
        logger.info("🚀 Starting WebRTC-AR Bridge Service")
        
        # Test WebRTC platform connection if room provided
        if test_room_id:
            if self.test_webrtc_connection(test_room_id):
                logger.info(f"✅ Bridge ready for room: {test_room_id}")
            else:
                logger.warning("⚠️  WebRTC platform test failed, but continuing...")
        
        # Start HTTP server for backend communication
        app = await self.setup_http_server()
        http_runner = web.AppRunner(app)
        await http_runner.setup()
        http_site = web.TCPSite(http_runner, '0.0.0.0', self.http_port)
        await http_site.start()
        
        # Start AR WebSocket server
        websocket_server = await self.start_ar_websocket_server()
        
        logger.info("🔄 Bridge service running - waiting for connections...")
        logger.info(f"   AR clients can connect to: ws://localhost:{self.ar_port}")
        logger.info(f"   HTTP API available at: http://localhost:{self.http_port}")
        logger.info(f"   WebRTC platform at: {self.webrtc_url}")
        
        try:
            # Keep both servers running
            await websocket_server.wait_closed()
        except KeyboardInterrupt:
            logger.info("🛑 Bridge service shutting down...")
            websocket_server.close()
            await websocket_server.wait_closed()
            await http_runner.cleanup()

async def main():
    parser = argparse.ArgumentParser(description='WebRTC-AR Bridge Service')
    parser.add_argument('--room-id', help='Test room ID to connect to')
    parser.add_argument('--webrtc-url', default='http://localhost:3001', help='WebRTC platform URL')
    parser.add_argument('--ar-port', type=int, default=8765, help='AR WebSocket port')
    parser.add_argument('--http-port', type=int, default=8766, help='HTTP API port')
    
    args = parser.parse_args()
    
    bridge = WebRTCARBridge(
        webrtc_url=args.webrtc_url,
        ar_port=args.ar_port,
        http_port=args.http_port
    )
    
    await bridge.run(test_room_id=args.room_id)

if __name__ == "__main__":
    asyncio.run(main())