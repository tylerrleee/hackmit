#!/usr/bin/env python3
"""
Simple AR Demo with WebRTC Integration
Bypasses numpy dependency issues for testing
"""

import cv2
import json
import time
import asyncio
import websockets
import threading
import argparse
import numpy as np
from typing import List, Tuple, Optional

class SimpleARDemo:
    """Simple AR demo with WebRTC integration"""
    
    def __init__(self, room_id: str = None, bridge_url: str = "ws://localhost:8765", 
                 webrtc_enabled: bool = False, camera_id: int = 0):
        self.room_id = room_id
        self.bridge_url = bridge_url
        self.webrtc_enabled = webrtc_enabled
        self.camera_id = camera_id
        
        # Camera
        self.camera = None
        
        # WebRTC integration
        self.websocket_connection = None
        self.websocket_thread = None
        self.websocket_loop = None
        self.connected_to_bridge = False
        
        # Drawing system
        self.drawing_lines = []
        self.current_line = []
        self.mouse_drawing = False
        self.last_mouse_pos = None
        self.drawing_color = (0, 255, 0)  # Green
        self.drawing_thickness = 3
        self.drawing_colors = [
            (0, 255, 0),    # Green
            (255, 0, 0),    # Blue  
            (0, 0, 255),    # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
            (255, 255, 255) # White
        ]
        self.current_color_index = 0
        
        # Performance
        self.fps_counter = 0
        self.fps_start_time = time.time()
        self.current_fps = 0.0
    
    def initialize_camera(self):
        """Initialize camera"""
        try:
            self.camera = cv2.VideoCapture(self.camera_id)
            if not self.camera.isOpened():
                print(f"❌ Could not open camera {self.camera_id}")
                return False
            
            # Set camera properties
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self.camera.set(cv2.CAP_PROP_FPS, 30)
            
            print(f"✅ Camera {self.camera_id} initialized")
            return True
            
        except Exception as e:
            print(f"❌ Camera initialization failed: {e}")
            return False
    
    def initialize_webrtc_connection(self):
        """Initialize WebRTC bridge connection"""
        if not self.webrtc_enabled or not self.room_id:
            return False
        
        try:
            print(f"🌐 Connecting to WebRTC bridge at {self.bridge_url}")
            
            # Start WebSocket connection in a separate thread
            self.websocket_thread = threading.Thread(
                target=self._run_websocket_connection, 
                daemon=True
            )
            self.websocket_thread.start()
            
            # Wait briefly for connection
            time.sleep(1)
            
            if self.connected_to_bridge:
                print("✅ Connected to WebRTC bridge")
                return True
            else:
                print("⚠️  WebRTC bridge connection pending...")
                return True  # Still try to continue
                
        except Exception as e:
            print(f"❌ WebRTC connection failed: {e}")
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
            
            print(f"📥 Received annotation from {source}")
            
        elif message_type == 'ar_annotations_clear':
            # Clear all annotations command from platform
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
    
    def mouse_callback(self, event, x, y, flags, param):
        """Handle mouse events for drawing"""
        if event == cv2.EVENT_LBUTTONDOWN:
            # Start drawing
            self.mouse_drawing = True
            self.current_line = [(x, y)]
            self.last_mouse_pos = (x, y)
            
        elif event == cv2.EVENT_MOUSEMOVE:
            # Continue drawing
            if self.mouse_drawing:
                self.current_line.append((x, y))
                self.last_mouse_pos = (x, y)
                
        elif event == cv2.EVENT_LBUTTONUP:
            # Finish drawing
            self.mouse_drawing = False
            if len(self.current_line) > 1:
                # Save the completed line
                line_data = {
                    'type': 'line_drawing',
                    'points': self.current_line.copy(),
                    'color': self.drawing_color,
                    'thickness': self.drawing_thickness,
                    'drawing_mode': 'field_medic_ar'
                }
                
                self.drawing_lines.append(line_data)
                
                # Send annotation to WebRTC platform if connected
                if self.webrtc_enabled and self.connected_to_bridge:
                    if self.send_annotation_to_platform(line_data):
                        print(f"📤 Sent drawing annotation to platform")
                
            self.current_line = []
            self.last_mouse_pos = None
    
    def cycle_drawing_color(self):
        """Cycle through available drawing colors"""
        self.current_color_index = (self.current_color_index + 1) % len(self.drawing_colors)
        self.drawing_color = self.drawing_colors[self.current_color_index]
    
    def clear_drawings(self):
        """Clear all drawings"""
        self.drawing_lines.clear()
        self.current_line.clear()
    
    def update_fps(self):
        """Update FPS counter"""
        self.fps_counter += 1
        current_time = time.time()
        
        if current_time - self.fps_start_time >= 1.0:
            self.current_fps = self.fps_counter / (current_time - self.fps_start_time)
            self.fps_counter = 0
            self.fps_start_time = current_time
    
    def draw_overlay(self, frame):
        """Draw the interactive overlay on the frame"""
        overlay_frame = frame.copy()
        
        # Draw completed lines
        for line_data in self.drawing_lines:
            points = line_data['points']
            color = line_data['color']
            thickness = line_data['thickness']
            
            for i in range(1, len(points)):
                cv2.line(overlay_frame, points[i-1], points[i], color, thickness)
        
        # Draw current line being drawn
        if len(self.current_line) > 1:
            for i in range(1, len(self.current_line)):
                cv2.line(overlay_frame, self.current_line[i-1], self.current_line[i], 
                        self.drawing_color, self.drawing_thickness)
        
        # Draw crosshair at last mouse position when drawing
        if self.mouse_drawing and self.last_mouse_pos:
            x, y = self.last_mouse_pos
            cv2.drawMarker(overlay_frame, (x, y), self.drawing_color, 
                          cv2.MARKER_CROSS, 10, 2)
        
        return overlay_frame
    
    def display_results(self, frame):
        """Display frame with overlays"""
        # Apply drawing overlay
        display_frame = self.draw_overlay(frame)
        
        # Add FPS counter
        cv2.putText(display_frame, f'FPS: {self.current_fps:.1f}', 
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        # WebRTC connection status
        if self.webrtc_enabled:
            webrtc_status = "CONNECTED" if self.connected_to_bridge else "DISCONNECTED"
            webrtc_color = (0, 255, 0) if self.connected_to_bridge else (0, 0, 255)
            cv2.putText(display_frame, f'WebRTC: {webrtc_status}', 
                       (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.6, webrtc_color, 1)
            
            if self.room_id:
                cv2.putText(display_frame, f'Room: {self.room_id}', 
                           (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        # Drawing info
        color_names = ['GREEN', 'BLUE', 'RED', 'CYAN', 'MAGENTA', 'YELLOW', 'WHITE']
        current_color_name = color_names[self.current_color_index]
        cv2.putText(display_frame, f'Color: {current_color_name} (T:{self.drawing_thickness})', 
                   (10, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.6, self.drawing_color, 2)
        
        # Drawing statistics
        total_lines = len(self.drawing_lines)
        if total_lines > 0:
            cv2.putText(display_frame, f'Lines: {total_lines}', 
                       (10, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        
        # Show frame
        cv2.imshow('Simple AR Demo - WebRTC Integration', display_frame)
        
        # Set mouse callback
        cv2.setMouseCallback('Simple AR Demo - WebRTC Integration', self.mouse_callback)
    
    def run(self):
        """Main processing loop"""
        print("🔬 Starting Simple AR Demo with WebRTC Integration")
        print("=" * 50)
        
        if not self.initialize_camera():
            return False
        
        # Initialize WebRTC connection if enabled
        if self.webrtc_enabled:
            self.initialize_webrtc_connection()
        
        print("\n📹 Simple AR Demo is running!")
        if self.webrtc_enabled:
            print(f"🌐 WebRTC Integration: ENABLED (Room: {self.room_id})")
        else:
            print("🌐 WebRTC Integration: DISABLED")
            
        print("\nControls:")
        print("  - Left click and drag to draw on the camera feed")
        print("  - Press 'q' to quit")
        print("  - Press 'c' to cycle drawing colors")
        print("  - Press 'x' to clear all drawings")
        print("  - Press '+/-' to increase/decrease line thickness")
        print("\nProcessing frames...")
        
        frame_count = 0
        
        try:
            while True:
                # Get camera frame
                ret, frame = self.camera.read()
                
                if not ret:
                    print("❌ Failed to capture frame")
                    break
                
                # Update FPS
                self.update_fps()
                
                # Display results
                self.display_results(frame)
                
                frame_count += 1
                
                # Print periodic updates
                if frame_count % 90 == 0:
                    print(f"Frame {frame_count}: FPS={self.current_fps:.1f}, Lines={len(self.drawing_lines)}")
                
                # Handle keyboard input
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q'):
                    print("\n⏹️  Stopping AR demo...")
                    break
                elif key == ord('c'):
                    self.cycle_drawing_color()
                    color_names = ['GREEN', 'BLUE', 'RED', 'CYAN', 'MAGENTA', 'YELLOW', 'WHITE']
                    print(f"🎨 Drawing color: {color_names[self.current_color_index]}")
                elif key == ord('x'):
                    self.clear_drawings()
                    print("🗑️  All drawings cleared")
                elif key == ord('+') or key == ord('='):
                    self.drawing_thickness = min(10, self.drawing_thickness + 1)
                    print(f"📏 Line thickness: {self.drawing_thickness}")
                elif key == ord('-') or key == ord('_'):
                    self.drawing_thickness = max(1, self.drawing_thickness - 1)
                    print(f"📏 Line thickness: {self.drawing_thickness}")
        
        except KeyboardInterrupt:
            print("\n⏹️  Interrupted by user")
        
        except Exception as e:
            print(f"\n❌ Error during processing: {e}")
        
        finally:
            self.cleanup()
            print("👋 AR demo stopped")
            return True
    
    def cleanup(self):
        """Clean up resources"""
        if self.camera:
            self.camera.release()
        cv2.destroyAllWindows()

def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Simple AR Demo with WebRTC Integration")
    parser.add_argument('--webrtc-enabled', action='store_true', 
                       help='Enable WebRTC integration for annotation sharing')
    parser.add_argument('--room-id', type=str, 
                       help='WebRTC room ID for annotation sharing')
    parser.add_argument('--bridge-url', type=str, default='ws://localhost:8765',
                       help='WebSocket URL for WebRTC bridge connection')
    parser.add_argument('--camera-id', type=int, default=0, 
                       help='Camera ID')
    args = parser.parse_args()
    
    demo = SimpleARDemo(
        room_id=args.room_id,
        bridge_url=args.bridge_url,
        webrtc_enabled=args.webrtc_enabled,
        camera_id=args.camera_id
    )
    
    demo.run()

if __name__ == "__main__":
    main()