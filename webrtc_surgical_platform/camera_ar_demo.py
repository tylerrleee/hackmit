#!/usr/bin/env python3
"""
Medical AR Camera Demo - Field Medic System
WebRTC-enabled camera system for field medics with AR annotation support
"""

import cv2
import asyncio
import websockets
import json
import numpy as np
import argparse
import threading
import time
from typing import Optional, Dict, List, Tuple
import base64
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MedicalARCamera:
    def __init__(self, bridge_url: str, room_id: str, webrtc_enabled: bool = False):
        self.bridge_url = bridge_url
        self.room_id = room_id
        self.webrtc_enabled = webrtc_enabled
        self.websocket = None
        self.camera = None
        
        # Camera settings
        self.camera_width = 1280
        self.camera_height = 720
        self.fps = 30
        
        # AR annotation state
        self.annotations = []
        self.current_annotation = None
        self.annotation_color = (0, 255, 0)  # Green
        self.annotation_thickness = 3
        
        # Connection state
        self.is_connected = False
        self.is_streaming = False
        self.frame_count = 0
        
        # WebRTC simulation state
        self.surgeon_connected = False
        self.video_call_active = False
        
        # Drawing state
        self.drawing_mode = False
        self.current_drawing_path = []
        self.is_drawing = False
        self.drawing_color = (0, 255, 0)  # Green
        
    async def connect_to_bridge(self):
        """Connect to the WebRTC-AR bridge"""
        try:
            logger.info(f"Connecting to AR bridge at {self.bridge_url}")
            self.websocket = await websockets.connect(self.bridge_url)
            self.is_connected = True
            
            # Register as field medic
            registration_message = {
                "type": "join_room",
                "roomId": self.room_id,
                "clientType": "ar_field_medic",
                "userInfo": {
                    "name": "Field Medic",
                    "location": "Emergency Site",
                    "capabilities": ["camera", "audio", "ar_display"]
                }
            }
            
            await self.websocket.send(json.dumps(registration_message))
            logger.info(f"Registered as field medic in room: {self.room_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to bridge: {e}")
            self.is_connected = False
            return False
    
    def initialize_camera(self):
        """Initialize camera capture"""
        try:
            self.camera = cv2.VideoCapture(0)  # Use default camera
            if not self.camera.isOpened():
                raise Exception("Failed to open camera")
                
            # Set camera properties
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, self.camera_width)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, self.camera_height)
            self.camera.set(cv2.CAP_PROP_FPS, self.fps)
            
            logger.info(f"Camera initialized: {self.camera_width}x{self.camera_height} @ {self.fps}fps")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize camera: {e}")
            return False
    
    async def handle_bridge_messages(self):
        """Handle messages from the bridge"""
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    await self.process_message(data)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON received: {e}")
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info("Connection to bridge closed")
        except Exception as e:
            logger.error(f"Bridge message handler error: {e}")
        finally:
            self.is_connected = False
    
    async def process_message(self, data: Dict):
        """Process incoming messages from bridge"""
        message_type = data.get("type")
        
        if message_type == "start_video_call":
            await self.handle_start_video_call(data)
        elif message_type == "end_video_call":
            await self.handle_end_video_call(data)
        elif message_type == "ar_annotation":
            await self.handle_ar_annotation(data)
        elif message_type == "surgeon_connected":
            self.surgeon_connected = True
            logger.info("✅ Surgeon connected to video call")
        elif message_type == "surgeon_disconnected":
            self.surgeon_connected = False
            logger.info("❌ Surgeon disconnected from video call")
        else:
            logger.debug(f"Unknown message type: {message_type}")
    
    async def handle_start_video_call(self, data: Dict):
        """Handle request to start video call"""
        logger.info("🎥 Starting video call with surgeon")
        self.video_call_active = True
        self.is_streaming = True
        
        # Send confirmation back to bridge
        response = {
            "type": "video_call_started",
            "roomId": self.room_id,
            "status": "success",
            "fieldMedicReady": True
        }
        
        if self.websocket:
            await self.websocket.send(json.dumps(response))
    
    async def handle_end_video_call(self, data: Dict):
        """Handle request to end video call"""
        logger.info("📵 Ending video call with surgeon")
        self.video_call_active = False
        self.is_streaming = False
        self.surgeon_connected = False
        
        # Clear annotations
        self.annotations.clear()
        
        # Send confirmation back to bridge
        response = {
            "type": "video_call_ended",
            "roomId": self.room_id,
            "status": "success"
        }
        
        if self.websocket:
            await self.websocket.send(json.dumps(response))
    
    async def handle_ar_annotation(self, data: Dict):
        """Handle AR annotations from surgeon"""
        annotation = data.get("annotation", {})
        
        if annotation.get("type") == "arrow":
            self.add_arrow_annotation(annotation)
        elif annotation.get("type") == "circle":
            self.add_circle_annotation(annotation)
        elif annotation.get("type") == "text":
            self.add_text_annotation(annotation)
        
        logger.info(f"📍 Received AR annotation: {annotation.get('type', 'unknown')}")
    
    def add_arrow_annotation(self, annotation: Dict):
        """Add arrow annotation to display"""
        position = annotation.get("position", {})
        x, y = int(position.get("x", 0)), int(position.get("y", 0))
        
        # Convert relative coordinates to absolute if needed
        if x <= 1 and y <= 1:  # Assume relative coordinates
            x = int(x * self.camera_width)
            y = int(y * self.camera_height)
        
        color_name = annotation.get("color", "green")
        color_map = {
            "red": (0, 0, 255),
            "green": (0, 255, 0),
            "blue": (255, 0, 0),
            "yellow": (0, 255, 255),
            "white": (255, 255, 255)
        }
        color = color_map.get(color_name, (0, 255, 0))
        
        arrow_annotation = {
            "type": "arrow",
            "position": (x, y),
            "color": color,
            "size": annotation.get("size", 8),
            "text": annotation.get("text", ""),
            "timestamp": time.time()
        }
        
        self.annotations.append(arrow_annotation)
    
    def add_circle_annotation(self, annotation: Dict):
        """Add circle annotation to display"""
        position = annotation.get("position", {})
        x, y = int(position.get("x", 0)), int(position.get("y", 0))
        
        if x <= 1 and y <= 1:
            x = int(x * self.camera_width)
            y = int(y * self.camera_height)
        
        circle_annotation = {
            "type": "circle",
            "center": (x, y),
            "radius": annotation.get("radius", 30),
            "color": (0, 255, 255),  # Yellow
            "thickness": 3,
            "timestamp": time.time()
        }
        
        self.annotations.append(circle_annotation)
    
    def add_text_annotation(self, annotation: Dict):
        """Add text annotation to display"""
        position = annotation.get("position", {})
        x, y = int(position.get("x", 0)), int(position.get("y", 0))
        
        if x <= 1 and y <= 1:
            x = int(x * self.camera_width)
            y = int(y * self.camera_height)
        
        text_annotation = {
            "type": "text",
            "position": (x, y),
            "text": annotation.get("text", "Note"),
            "color": (255, 255, 255),  # White
            "font_scale": 1.0,
            "thickness": 2,
            "timestamp": time.time()
        }
        
        self.annotations.append(text_annotation)
    
    def mouse_callback(self, event, x, y, flags, param):
        """Handle mouse events for drawing"""
        if not self.drawing_mode:
            return
            
        if event == cv2.EVENT_LBUTTONDOWN:
            # Start drawing
            self.is_drawing = True
            self.current_drawing_path = [(x, y)]
            print(f"🖊️ Started drawing at ({x}, {y})")
            
        elif event == cv2.EVENT_MOUSEMOVE and self.is_drawing:
            # Continue drawing
            self.current_drawing_path.append((x, y))
            
        elif event == cv2.EVENT_LBUTTONUP and self.is_drawing:
            # Finish drawing
            self.is_drawing = False
            if len(self.current_drawing_path) > 1:
                # Create drawing annotation
                drawing_annotation = {
                    "type": "drawing",
                    "path": self.current_drawing_path.copy(),
                    "color": self.drawing_color,
                    "thickness": 3,
                    "timestamp": time.time()
                }
                self.annotations.append(drawing_annotation)
                print(f"✅ Drawing completed with {len(self.current_drawing_path)} points")
                
                # Send to bridge if connected
                if self.websocket and self.is_connected:
                    asyncio.create_task(self.send_drawing_to_bridge(drawing_annotation))
                    
            self.current_drawing_path = []
    
    async def send_drawing_to_bridge(self, drawing_annotation):
        """Send drawing annotation to the WebRTC bridge"""
        try:
            message = {
                "type": "annotation",
                "roomId": self.room_id,
                "annotation": {
                    "type": "draw",
                    "data": {
                        "points": [{"x": p[0]/self.camera_width, "y": p[1]/self.camera_height} 
                                 for p in drawing_annotation["path"]],
                        "color": "#00FF00",  # Green
                        "thickness": drawing_annotation["thickness"]
                    },
                    "timestamp": drawing_annotation["timestamp"],
                    "source": "field_medic"
                },
                "timestamp": time.time()
            }
            await self.websocket.send(json.dumps(message))
            print("📡 Drawing sent to bridge")
        except Exception as e:
            print(f"❌ Failed to send drawing: {e}")
    
    def render_annotations(self, frame: np.ndarray) -> np.ndarray:
        """Render AR annotations on the frame"""
        for annotation in self.annotations:
            try:
                if annotation["type"] == "arrow":
                    self.draw_arrow(frame, annotation)
                elif annotation["type"] == "circle":
                    self.draw_circle(frame, annotation)
                elif annotation["type"] == "text":
                    self.draw_text(frame, annotation)
                elif annotation["type"] == "drawing":
                    self.draw_path(frame, annotation)
            except Exception as e:
                logger.error(f"Error rendering annotation: {e}")
        
        # Draw current path being drawn
        if self.is_drawing and len(self.current_drawing_path) > 1:
            self.draw_current_path(frame)
        
        return frame
    
    def draw_arrow(self, frame: np.ndarray, annotation: Dict):
        """Draw arrow annotation"""
        x, y = annotation["position"]
        color = annotation["color"]
        size = annotation.get("size", 8)
        text = annotation.get("text", "")
        
        # Draw arrow pointing down and right
        cv2.arrowedLine(frame, (x, y), (x + size * 10, y + size * 10), 
                       color, annotation.get("thickness", 3), tipLength=0.3)
        
        # Draw text if provided
        if text:
            cv2.putText(frame, text, (x + 20, y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    
    def draw_circle(self, frame: np.ndarray, annotation: Dict):
        """Draw circle annotation"""
        center = annotation["center"]
        radius = annotation["radius"]
        color = annotation["color"]
        thickness = annotation["thickness"]
        
        cv2.circle(frame, center, radius, color, thickness)
    
    def draw_text(self, frame: np.ndarray, annotation: Dict):
        """Draw text annotation"""
        position = annotation["position"]
        text = annotation["text"]
        color = annotation["color"]
        font_scale = annotation.get("font_scale", 1.0)
        thickness = annotation.get("thickness", 2)
        
        cv2.putText(frame, text, position, cv2.FONT_HERSHEY_SIMPLEX, 
                   font_scale, color, thickness)
    
    def draw_path(self, frame: np.ndarray, annotation: Dict):
        """Draw path/drawing annotation"""
        path = annotation["path"]
        color = annotation["color"]
        thickness = annotation.get("thickness", 3)
        
        if len(path) < 2:
            return
            
        # Draw lines connecting all points in the path
        for i in range(1, len(path)):
            pt1 = path[i-1]
            pt2 = path[i]
            cv2.line(frame, pt1, pt2, color, thickness)
    
    def draw_current_path(self, frame: np.ndarray):
        """Draw the path currently being drawn (preview)"""
        if len(self.current_drawing_path) < 2:
            return
            
        # Draw with semi-transparent green
        color = (0, 255, 0)  # Green
        thickness = 3
        
        for i in range(1, len(self.current_drawing_path)):
            pt1 = self.current_drawing_path[i-1]
            pt2 = self.current_drawing_path[i]
            cv2.line(frame, pt1, pt2, color, thickness)
    
    def add_ui_overlay(self, frame: np.ndarray) -> np.ndarray:
        """Add UI elements to the frame"""
        # Status indicators
        height, width = frame.shape[:2]
        
        # Connection status
        status_color = (0, 255, 0) if self.is_connected else (0, 0, 255)
        status_text = "CONNECTED" if self.is_connected else "DISCONNECTED"
        cv2.putText(frame, f"Bridge: {status_text}", (10, 30), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2)
        
        # Video call status
        if self.video_call_active:
            cv2.putText(frame, "🎥 LIVE CALL", (10, 60), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        
        # Surgeon connection status
        if self.surgeon_connected:
            cv2.putText(frame, "👨‍⚕️ Surgeon Online", (10, 90), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        
        # Room ID
        cv2.putText(frame, f"Room: {self.room_id[:8]}...", (10, height - 20), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        # Frame counter
        cv2.putText(frame, f"Frame: {self.frame_count}", (width - 150, 30), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        # Drawing mode indicator
        if self.drawing_mode:
            cv2.putText(frame, "✏️ DRAWING MODE", (10, 120), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            if self.is_drawing:
                cv2.putText(frame, "Drawing...", (10, 150), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
        
        return frame
    
    async def stream_video_frame(self, frame: np.ndarray):
        """Stream video frame to surgeon (WebRTC simulation)"""
        if not self.is_streaming or not self.websocket:
            return
        
        try:
            # Convert frame to base64 for transmission (simplified WebRTC simulation)
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frame_data = base64.b64encode(buffer).decode('utf-8')
            
            # Send frame data to bridge
            message = {
                "type": "video_frame",
                "roomId": self.room_id,
                "frameData": frame_data,
                "timestamp": time.time(),
                "frameNumber": self.frame_count
            }
            
            await self.websocket.send(json.dumps(message))
            
        except Exception as e:
            logger.error(f"Error streaming frame: {e}")
    
    async def run_camera_loop(self):
        """Main camera capture and display loop"""
        if not self.initialize_camera():
            logger.error("Failed to initialize camera")
            return
        
        logger.info("🎬 Starting camera loop...")
        
        # Set up mouse callback for drawing
        cv2.namedWindow('Medical AR - Field Medic Camera')
        cv2.setMouseCallback('Medical AR - Field Medic Camera', self.mouse_callback)
        
        try:
            while True:
                ret, frame = self.camera.read()
                if not ret:
                    logger.error("Failed to read frame from camera")
                    break
                
                self.frame_count += 1
                
                # Render AR annotations
                frame = self.render_annotations(frame)
                
                # Add UI overlay
                frame = self.add_ui_overlay(frame)
                
                # Stream frame to surgeon if video call is active
                if self.video_call_active:
                    await self.stream_video_frame(frame)
                
                # Display frame locally
                cv2.imshow('Medical AR - Field Medic Camera', frame)
                
                # Handle key presses
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    logger.info("User requested quit")
                    break
                elif key == ord('c'):
                    # Clear annotations
                    self.annotations.clear()
                    logger.info("Annotations cleared")
                elif key == ord('s'):
                    # Toggle streaming
                    self.is_streaming = not self.is_streaming
                    logger.info(f"Streaming: {'ON' if self.is_streaming else 'OFF'}")
                elif key == ord('d'):
                    # Toggle drawing mode
                    self.drawing_mode = not self.drawing_mode
                    logger.info(f"Drawing mode: {'ON' if self.drawing_mode else 'OFF'}")
                    if not self.drawing_mode:
                        # Stop any current drawing
                        self.is_drawing = False
                        self.current_drawing_path = []
                
                # Control frame rate
                await asyncio.sleep(1.0 / self.fps)
                
        except KeyboardInterrupt:
            logger.info("Camera loop interrupted by user")
        except Exception as e:
            logger.error(f"Camera loop error: {e}")
        finally:
            self.cleanup()
    
    def cleanup(self):
        """Clean up resources"""
        if self.camera:
            self.camera.release()
            logger.info("Camera released")
        
        cv2.destroyAllWindows()
        logger.info("OpenCV windows closed")

async def main():
    parser = argparse.ArgumentParser(description='Medical AR Camera Demo - Field Medic System')
    parser.add_argument('--room-id', default='test-room-123', 
                       help='Room ID for WebRTC connection')
    parser.add_argument('--bridge-url', default='ws://localhost:8765',
                       help='WebRTC-AR Bridge URL')
    parser.add_argument('--webrtc-enabled', action='store_true',
                       help='Enable WebRTC features')
    parser.add_argument('--threading', type=int, choices=[1, 2], default=1,
                       help='Threading mode (1=multi-threaded, 2=single-threaded)')
    
    args = parser.parse_args()
    
    print("🏥 Medical AR Camera Demo - Field Medic System")
    print("=" * 50)
    print(f"Room ID: {args.room_id}")
    print(f"Bridge URL: {args.bridge_url}")
    print(f"WebRTC Enabled: {args.webrtc_enabled}")
    print("-" * 50)
    print("Controls:")
    print("  Q - Quit")
    print("  C - Clear annotations")
    print("  S - Toggle streaming")
    print("  D - Toggle drawing mode")
    print("  Mouse - Click and drag to draw (when drawing mode is ON)")
    print("=" * 50)
    
    # Create AR camera system
    ar_camera = MedicalARCamera(args.bridge_url, args.room_id, args.webrtc_enabled)
    
    try:
        # Connect to bridge
        if args.webrtc_enabled:
            connected = await ar_camera.connect_to_bridge()
            if not connected:
                logger.error("Failed to connect to bridge. Starting in offline mode.")
        
        # Start async tasks
        tasks = []
        
        if ar_camera.is_connected:
            # Handle bridge messages
            tasks.append(asyncio.create_task(ar_camera.handle_bridge_messages()))
        
        # Run camera loop
        tasks.append(asyncio.create_task(ar_camera.run_camera_loop()))
        
        # Wait for all tasks
        await asyncio.gather(*tasks)
        
    except KeyboardInterrupt:
        logger.info("Application interrupted by user")
    except Exception as e:
        logger.error(f"Application error: {e}")
    finally:
        ar_camera.cleanup()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nApplication terminated by user")
    except Exception as e:
        print(f"Fatal error: {e}")