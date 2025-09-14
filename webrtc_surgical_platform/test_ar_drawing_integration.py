#!/usr/bin/env python3
"""
Test AR Drawing Integration with WebRTC Platform
Demonstrates the drawing functionality connected to the WebRTC bridge
"""

import json
import time
import asyncio
import websockets
import threading
from typing import List, Tuple

class DrawingAnnotationDemo:
    """Demo class showing drawing annotation integration"""
    
    def __init__(self, room_id: str, bridge_url: str = "ws://localhost:8765"):
        self.room_id = room_id
        self.bridge_url = bridge_url
        self.websocket_connection = None
        self.connected_to_bridge = False
        self.websocket_loop = None
        self.websocket_thread = None
        
        # Mock drawing data
        self.drawing_lines = []
        self.current_color = (0, 255, 0)  # Green
        
    def connect_to_bridge(self):
        """Connect to WebRTC bridge"""
        print(f"🌐 Connecting to WebRTC bridge at {self.bridge_url}")
        
        # Start WebSocket connection in a separate thread
        self.websocket_thread = threading.Thread(
            target=self._run_websocket_connection, 
            daemon=True
        )
        self.websocket_thread.start()
        
        # Wait briefly for connection
        time.sleep(2)
        
        if self.connected_to_bridge:
            print("✅ Connected to WebRTC bridge")
            return True
        else:
            print("⚠️  WebRTC bridge connection pending...")
            return False
    
    def _run_websocket_connection(self):
        """Run WebSocket connection in separate thread"""
        # Create a new event loop for this thread
        self.websocket_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.websocket_loop)
        
        try:
            self.websocket_loop.run_until_complete(self._websocket_client())
        except Exception as e:
            print(f"WebSocket thread error: {e}")
        finally:
            if self.websocket_loop:
                self.websocket_loop.close()
    
    async def _websocket_client(self):
        """WebSocket client for bridge communication"""
        try:
            async with websockets.connect(self.bridge_url) as websocket:
                self.websocket_connection = websocket
                self.connected_to_bridge = True
                
                # Join the room
                await websocket.send(json.dumps({
                    'type': 'join_room',
                    'roomId': self.room_id,
                    'clientType': 'ar_field_medic'
                }))
                
                print(f"📱 AR client joined room {self.room_id}")
                
                # Listen for messages
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        await self._handle_bridge_message(data)
                    except json.JSONDecodeError:
                        print(f"Invalid JSON from bridge: {message}")
                        
        except websockets.exceptions.ConnectionClosed:
            print("🔌 WebRTC bridge connection closed")
            self.connected_to_bridge = False
        except Exception as e:
            print(f"WebSocket client error: {e}")
            self.connected_to_bridge = False
    
    async def _handle_bridge_message(self, data):
        """Handle messages from WebRTC bridge"""
        message_type = data.get('type')
        
        if message_type == 'annotation_received':
            # Received annotation from doctor via WebRTC platform
            annotation = data.get('annotation', {})
            source = data.get('source', 'unknown')
            
            print(f"📥 Received annotation from {source}: {annotation.get('type', 'unknown')}")
            
            if annotation.get('type') == 'clear_annotations':
                self.drawing_lines.clear()
                print("🗑️  All annotations cleared by platform")
    
    def send_annotation_to_platform(self, annotation_data):
        """Send drawing annotation to WebRTC platform"""
        if not self.connected_to_bridge or not self.websocket_connection:
            return False
        
        try:
            message = {
                'type': 'annotation',
                'roomId': self.room_id,
                'annotation': annotation_data,
                'timestamp': time.time(),
                'source': 'ar_field_medic'
            }
            
            # Send via WebSocket (non-blocking)
            if self.websocket_loop and not self.websocket_loop.is_closed():
                asyncio.run_coroutine_threadsafe(
                    self.websocket_connection.send(json.dumps(message)),
                    self.websocket_loop
                )
                return True
                
        except Exception as e:
            print(f"Error sending annotation: {e}")
            
        return False
    
    def create_sample_drawing(self):
        """Create a sample drawing annotation"""
        # Mock drawing line
        sample_line = {
            'type': 'line_drawing',
            'points': [(100, 100), (200, 150), (300, 200), (400, 180)],
            'color': self.current_color,
            'thickness': 3,
            'is_3d_anchored': False,
            'is_object_anchored': False,
            'drawing_mode': 'field_medic_ar',
            'description': 'Sample AR annotation from field medic'
        }
        
        self.drawing_lines.append(sample_line)
        return sample_line
    
    def run_demo(self):
        """Run the drawing integration demo"""
        print("🔬 AR Drawing Integration Demo")
        print("=" * 50)
        print(f"Room ID: {self.room_id}")
        print("Bridge URL: {self.bridge_url}")
        print()
        
        # Connect to bridge
        if not self.connect_to_bridge():
            print("❌ Failed to connect to WebRTC bridge")
            print("Make sure the WebRTC bridge is running:")
            print("  python webrtc_bridge.py")
            return False
        
        print("✅ Drawing integration demo ready!")
        print()
        print("Demo commands:")
        print("  1 - Send sample drawing annotation")
        print("  2 - Send circle annotation")
        print("  3 - Send urgent marker")
        print("  s - Show connection status")
        print("  q - Quit")
        print()
        
        # Interactive demo loop
        try:
            while True:
                command = input("Enter command: ").strip().lower()
                
                if command == 'q':
                    break
                elif command == '1':
                    # Send line drawing
                    drawing = self.create_sample_drawing()
                    if self.send_annotation_to_platform(drawing):
                        print("📤 Sent line drawing annotation to platform")
                    else:
                        print("❌ Failed to send annotation")
                        
                elif command == '2':
                    # Send circle annotation
                    circle_annotation = {
                        'type': 'circle_drawing',
                        'center': (250, 250),
                        'radius': 50,
                        'color': (255, 0, 0),  # Red
                        'thickness': 2,
                        'drawing_mode': 'field_medic_ar',
                        'description': 'Circle annotation - attention area'
                    }
                    if self.send_annotation_to_platform(circle_annotation):
                        print("📤 Sent circle annotation to platform")
                    else:
                        print("❌ Failed to send annotation")
                
                elif command == '3':
                    # Send urgent marker
                    urgent_marker = {
                        'type': 'urgent_marker',
                        'position': (300, 100),
                        'color': (0, 0, 255),  # Red
                        'size': 20,
                        'priority': 'high',
                        'drawing_mode': 'field_medic_ar',
                        'description': 'URGENT: Medical attention required'
                    }
                    if self.send_annotation_to_platform(urgent_marker):
                        print("📤 Sent urgent marker to platform")
                    else:
                        print("❌ Failed to send annotation")
                
                elif command == 's':
                    # Show status
                    status = "CONNECTED" if self.connected_to_bridge else "DISCONNECTED"
                    print(f"Connection Status: {status}")
                    print(f"Total Drawings: {len(self.drawing_lines)}")
                    
                else:
                    print("Unknown command. Try 1, 2, 3, s, or q")
        
        except KeyboardInterrupt:
            print("\n⏹️  Demo interrupted by user")
        
        print("\n👋 Drawing integration demo completed")
        return True

def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Test AR Drawing Integration")
    parser.add_argument('--room-id', type=str, required=True,
                       help='WebRTC room ID for testing')
    parser.add_argument('--bridge-url', type=str, default='ws://localhost:8765',
                       help='WebSocket URL for WebRTC bridge connection')
    args = parser.parse_args()
    
    demo = DrawingAnnotationDemo(args.room_id, args.bridge_url)
    demo.run_demo()

if __name__ == "__main__":
    main()