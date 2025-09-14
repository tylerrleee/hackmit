#!/usr/bin/env python3
"""
WebRTC-AR Bridge Service
Connects the Camera AR System with the WebRTC Surgical Platform
Enables real-time annotation synchronization between doctor (web) and field medic (AR)
"""

import asyncio
import websockets
import json
import logging
import threading
import time
import queue
import numpy as np
from typing import Dict, List, Optional, Callable, Any
import socketio

# Configure logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

class WebRTCARBridge:
    """Bridge service connecting Camera AR system with WebRTC platform"""
    
    def __init__(self, 
                 webrtc_server_url: str = 'http://localhost:3001',
                 ar_ws_port: int = 8765,
                 auth_token: str = None):
        
        self.webrtc_server_url = webrtc_server_url
        self.ar_ws_port = ar_ws_port
        self.auth_token = auth_token
        self.logger = logging.getLogger(__name__)
        
        # Connection management
        self.webrtc_client = None
        self.ar_websocket_server = None
        self.ar_clients = {}  # client_id -> websocket
        self.is_running = False
        
        # Room and session management
        self.current_room_id = None
        self.ar_session_id = None
        self.field_medic_connected = False
        self.doctor_connected = False
        
        # Annotation queues for bidirectional sync
        self.incoming_annotations = queue.Queue()  # From WebRTC to AR
        self.outgoing_annotations = queue.Queue()  # From AR to WebRTC
        
        # Performance tracking
        self.stats = {
            'annotations_sent': 0,
            'annotations_received': 0,
            'frames_processed': 0,
            'connection_uptime': 0,
            'start_time': time.time()
        }
        
        # Initialize WebRTC client
        self.setup_webrtc_client()
    
    def setup_webrtc_client(self):
        """Initialize WebRTC Socket.IO client"""
        self.webrtc_client = socketio.AsyncClient(
            logger=False,
            engineio_logger=False
        )
        
        # Setup WebRTC event handlers
        @self.webrtc_client.event
        async def connect():
            self.logger.info("Connected to WebRTC signaling server")
            self.doctor_connected = True
            await self.join_consultation_room()
        
        @self.webrtc_client.event
        async def disconnect():
            self.logger.info("Disconnected from WebRTC signaling server")
            self.doctor_connected = False
        
        @self.webrtc_client.event
        async def ar_annotation(data):
            """Handle incoming annotations from doctor"""
            self.logger.debug(f"Received annotation from doctor: {data['annotation']['type']}")
            self.stats['annotations_received'] += 1
            
            # Forward to AR system
            await self.send_to_ar_clients({
                'type': 'annotation',
                'data': data['annotation'],
                'source': 'doctor',
                'timestamp': time.time()
            })
        
        @self.webrtc_client.event
        async def ar_session_created(data):
            """Handle AR session creation"""
            self.logger.info(f"AR session created: {data['sessionId']}")
            self.ar_session_id = data['sessionId']
            
            # Notify AR clients
            await self.send_to_ar_clients({
                'type': 'session_created',
                'session_id': data['sessionId'],
                'config': data['config']
            })
        
        @self.webrtc_client.event
        async def ar_session_available(data):
            """Handle AR session availability"""
            self.logger.info(f"AR session available: {data['sessionId']}")
            self.ar_session_id = data['sessionId']
            
            # Notify AR clients
            await self.send_to_ar_clients({
                'type': 'session_available',
                'session_id': data['sessionId'],
                'created_by': data['createdBy'],
                'config': data['config']
            })
        
        @self.webrtc_client.event
        async def ar_annotations_cleared(data):
            """Handle annotation clearing"""
            self.logger.info("Annotations cleared by doctor")
            
            # Forward to AR clients
            await self.send_to_ar_clients({
                'type': 'annotations_cleared',
                'cleared_by': data.get('clearedBy'),
                'clear_type': data.get('clearType', 'all')
            })
        
        @self.webrtc_client.event
        async def ar_error(data):
            """Handle AR errors from WebRTC platform"""
            self.logger.error(f"AR Error from WebRTC platform: {data['message']}")
    
    async def start(self, room_id: str):
        """Start the bridge service"""
        self.current_room_id = room_id
        self.is_running = True
        self.stats['start_time'] = time.time()
        
        self.logger.info(f"Starting WebRTC-AR Bridge for room: {room_id}")
        
        try:
            # Start WebSocket server for AR clients
            ar_server_task = asyncio.create_task(
                self.start_ar_websocket_server()
            )
            
            # Connect to WebRTC platform
            webrtc_task = asyncio.create_task(
                self.connect_to_webrtc()
            )
            
            # Start annotation processing
            annotation_task = asyncio.create_task(
                self.process_annotation_queues()
            )
            
            # Start performance monitoring
            stats_task = asyncio.create_task(
                self.monitor_performance()
            )
            
            # Wait for all tasks
            await asyncio.gather(
                ar_server_task,
                webrtc_task,
                annotation_task,
                stats_task,
                return_exceptions=True
            )
            
        except Exception as e:
            self.logger.error(f"Bridge service error: {e}")
        finally:
            self.is_running = False
    
    async def start_ar_websocket_server(self):
        """Start WebSocket server for AR clients"""
        self.logger.info(f"Starting AR WebSocket server on port {self.ar_ws_port}")
        
        async def handle_ar_client(websocket, path):
            client_id = f"ar_client_{int(time.time())}_{id(websocket)}"
            self.ar_clients[client_id] = websocket
            self.field_medic_connected = True
            
            self.logger.info(f"AR client connected: {client_id}")
            
            try:
                # Send welcome message
                await websocket.send(json.dumps({
                    'type': 'connected',
                    'client_id': client_id,
                    'room_id': self.current_room_id,
                    'session_id': self.ar_session_id
                }))
                
                # Handle messages from AR client
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        await self.handle_ar_message(client_id, data)
                    except json.JSONDecodeError:
                        self.logger.error(f"Invalid JSON from AR client {client_id}")
            
            except websockets.exceptions.ConnectionClosed:
                self.logger.info(f"AR client disconnected: {client_id}")
            except Exception as e:
                self.logger.error(f"Error handling AR client {client_id}: {e}")
            finally:
                self.ar_clients.pop(client_id, None)
                if not self.ar_clients:
                    self.field_medic_connected = False
        
        # Start WebSocket server
        server = await websockets.serve(
            handle_ar_client, 
            'localhost', 
            self.ar_ws_port
        )
        
        self.logger.info(f"AR WebSocket server started on ws://localhost:{self.ar_ws_port}")
        await server.wait_closed()
    
    async def connect_to_webrtc(self):
        """Connect to WebRTC signaling server"""
        try:
            await self.webrtc_client.connect(
                self.webrtc_server_url,
                auth={'token': self.auth_token} if self.auth_token else None,
                transports=['websocket', 'polling']
            )
            
            # Keep connection alive
            while self.is_running:
                await asyncio.sleep(1)
                
        except Exception as e:
            self.logger.error(f"WebRTC connection error: {e}")
    
    async def join_consultation_room(self):
        """Join the consultation room"""
        if self.current_room_id:
            self.logger.info(f"Joining room: {self.current_room_id}")
            
            await self.webrtc_client.emit('join-room', {
                'roomId': self.current_room_id,
                'roomType': 'ar-consultation',
                'metadata': {
                    'userRole': 'field_medic',
                    'capabilities': ['video', 'ar-annotations'],
                    'bridge_client': True
                }
            })
    
    async def handle_ar_message(self, client_id: str, data: Dict[str, Any]):
        """Handle messages from AR client"""
        message_type = data.get('type')
        
        if message_type == 'annotation':
            # Forward annotation to WebRTC platform
            await self.send_annotation_to_webrtc(data['data'])
            
        elif message_type == 'video_frame':
            # Handle video frame data (for future video streaming)
            self.stats['frames_processed'] += 1
            
        elif message_type == 'ping':
            # Respond to ping
            await self.send_to_ar_client(client_id, {
                'type': 'pong',
                'timestamp': time.time()
            })
            
        elif message_type == 'clear_annotations':
            # Forward clear request to WebRTC
            if self.ar_session_id:
                await self.webrtc_client.emit('ar-annotations-clear', {
                    'clearType': data.get('clear_type', 'all')
                })
        
        else:
            self.logger.warning(f"Unknown message type from AR client: {message_type}")
    
    async def send_annotation_to_webrtc(self, annotation_data: Dict[str, Any]):
        """Send annotation from AR to WebRTC platform"""
        if not self.doctor_connected or not self.ar_session_id:
            self.logger.warning("Cannot send annotation: not connected to WebRTC or no AR session")
            return
        
        try:
            await self.webrtc_client.emit('ar-annotation-add', {
                'type': annotation_data.get('type', 'draw'),
                'data': annotation_data.get('data', {}),
                'metadata': {
                    'source': 'field_medic',
                    'timestamp': time.time(),
                    **annotation_data.get('metadata', {})
                }
            })
            
            self.stats['annotations_sent'] += 1
            self.logger.debug(f"Sent annotation to WebRTC: {annotation_data.get('type')}")
            
        except Exception as e:
            self.logger.error(f"Failed to send annotation to WebRTC: {e}")
    
    async def send_to_ar_clients(self, data: Dict[str, Any]):
        """Send message to all connected AR clients"""
        if not self.ar_clients:
            return
        
        message = json.dumps(data)
        disconnected_clients = []
        
        for client_id, websocket in self.ar_clients.items():
            try:
                await websocket.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected_clients.append(client_id)
            except Exception as e:
                self.logger.error(f"Failed to send to AR client {client_id}: {e}")
                disconnected_clients.append(client_id)
        
        # Clean up disconnected clients
        for client_id in disconnected_clients:
            self.ar_clients.pop(client_id, None)
        
        if disconnected_clients:
            self.logger.info(f"Removed {len(disconnected_clients)} disconnected AR clients")
    
    async def send_to_ar_client(self, client_id: str, data: Dict[str, Any]):
        """Send message to specific AR client"""
        websocket = self.ar_clients.get(client_id)
        if websocket:
            try:
                await websocket.send(json.dumps(data))
            except websockets.exceptions.ConnectionClosed:
                self.ar_clients.pop(client_id, None)
                self.logger.info(f"Removed disconnected AR client: {client_id}")
            except Exception as e:
                self.logger.error(f"Failed to send to AR client {client_id}: {e}")
    
    async def process_annotation_queues(self):
        """Process annotation queues for bidirectional sync"""
        while self.is_running:
            try:
                # Process outgoing annotations (AR -> WebRTC)
                while not self.outgoing_annotations.empty():
                    annotation = self.outgoing_annotations.get()
                    await self.send_annotation_to_webrtc(annotation)
                
                # Small delay to prevent excessive CPU usage
                await asyncio.sleep(0.01)  # 10ms
                
            except Exception as e:
                self.logger.error(f"Error processing annotation queues: {e}")
                await asyncio.sleep(1)
    
    async def monitor_performance(self):
        """Monitor and log performance statistics"""
        while self.is_running:
            await asyncio.sleep(30)  # Log stats every 30 seconds
            
            uptime = time.time() - self.stats['start_time']
            self.stats['connection_uptime'] = uptime
            
            self.logger.info(
                f"Bridge Stats: "
                f"Uptime={uptime:.1f}s, "
                f"Sent={self.stats['annotations_sent']}, "
                f"Received={self.stats['annotations_received']}, "
                f"AR_Clients={len(self.ar_clients)}, "
                f"Doctor={self.doctor_connected}, "
                f"FieldMedic={self.field_medic_connected}"
            )
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics"""
        uptime = time.time() - self.stats['start_time']
        
        return {
            **self.stats,
            'connection_uptime': uptime,
            'ar_clients_count': len(self.ar_clients),
            'doctor_connected': self.doctor_connected,
            'field_medic_connected': self.field_medic_connected,
            'room_id': self.current_room_id,
            'ar_session_id': self.ar_session_id,
            'is_running': self.is_running
        }
    
    async def stop(self):
        """Stop the bridge service"""
        self.logger.info("Stopping WebRTC-AR Bridge...")
        self.is_running = False
        
        # Disconnect from WebRTC
        if self.webrtc_client:
            await self.webrtc_client.disconnect()
        
        # Close AR WebSocket connections
        for client_id, websocket in list(self.ar_clients.items()):
            try:
                await websocket.close()
            except:
                pass
        
        self.ar_clients.clear()
        self.logger.info("Bridge service stopped")


# Standalone script functionality
async def main():
    """Main function for running the bridge as a standalone service"""
    import argparse
    
    parser = argparse.ArgumentParser(description='WebRTC-AR Bridge Service')
    parser.add_argument('--room-id', required=True, help='Consultation room ID')
    parser.add_argument('--auth-token', help='Authentication token for WebRTC platform')
    parser.add_argument('--webrtc-url', default='http://localhost:3001', 
                       help='WebRTC server URL')
    parser.add_argument('--ar-port', type=int, default=8765, 
                       help='WebSocket port for AR clients')
    parser.add_argument('--log-level', default='INFO', 
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                       help='Logging level')
    
    args = parser.parse_args()
    
    # Configure logging level
    logging.getLogger().setLevel(getattr(logging, args.log_level))
    
    # Create and start bridge
    bridge = WebRTCARBridge(
        webrtc_server_url=args.webrtc_url,
        ar_ws_port=args.ar_port,
        auth_token=args.auth_token
    )
    
    try:
        print(f"🌉 Starting WebRTC-AR Bridge")
        print(f"📡 WebRTC Server: {args.webrtc_url}")
        print(f"🔌 AR WebSocket Port: {args.ar_port}")
        print(f"🏠 Room ID: {args.room_id}")
        print(f"🔑 Auth Token: {'Yes' if args.auth_token else 'No'}")
        print("=" * 50)
        
        await bridge.start(args.room_id)
        
    except KeyboardInterrupt:
        print("\n🛑 Bridge service interrupted by user")
    except Exception as e:
        print(f"❌ Bridge service error: {e}")
    finally:
        await bridge.stop()


if __name__ == '__main__':
    # Run the bridge service
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bridge service stopped")