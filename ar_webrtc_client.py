#!/usr/bin/env python3
"""
AR WebRTC Client Integration
Enhances the camera AR system with WebSocket connectivity to the WebRTC-AR Bridge
Enables field medics to see doctor's annotations in real-time on their AR view
"""

import asyncio
import websockets
import json
import logging
import threading
import time
import queue
import cv2
import numpy as np
from typing import Dict, List, Optional, Callable, Any, Tuple
from collections import deque

# Configure logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

class ARWebRTCClient:
    """WebRTC client integration for AR camera system"""
    
    def __init__(self, 
                 bridge_url: str = 'ws://localhost:8765',
                 room_id: str = None,
                 enable_bidirectional: bool = True):
        
        self.bridge_url = bridge_url
        self.room_id = room_id
        self.enable_bidirectional = enable_bidirectional
        self.logger = logging.getLogger(__name__)
        
        # Connection management
        self.websocket = None
        self.is_connected = False
        self.client_id = None
        self.session_id = None
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
        # Annotation management
        self.incoming_annotations = deque(maxlen=1000)  # From doctor
        self.outgoing_annotations = queue.Queue()      # To doctor
        self.active_annotations = {}  # annotation_id -> annotation_data
        self.annotation_callbacks = []  # Functions to call when annotations arrive
        
        # Performance tracking
        self.stats = {
            'annotations_received': 0,
            'annotations_sent': 0,
            'connection_uptime': 0,
            'last_ping_time': 0,
            'ping_latency': 0,
            'start_time': time.time()
        }
        
        # Threading
        self.websocket_thread = None
        self.annotation_thread = None
        self.should_stop = threading.Event()
        
        # AR overlay settings
        self.overlay_settings = {
            'show_doctor_annotations': True,
            'annotation_opacity': 0.8,
            'line_thickness_scale': 2.0,
            'text_scale': 1.2,
            'fade_time': 10.0,  # seconds
            'max_visible_annotations': 50
        }
    
    def start(self, room_id: str = None):
        """Start the AR WebRTC client"""
        if room_id:
            self.room_id = room_id
        
        if not self.room_id:
            raise ValueError("Room ID is required")
        
        self.logger.info(f"Starting AR WebRTC Client for room: {self.room_id}")
        self.stats['start_time'] = time.time()
        
        # Start WebSocket connection in separate thread
        self.websocket_thread = threading.Thread(
            target=self._run_websocket_client,
            daemon=True
        )
        self.websocket_thread.start()
        
        # Start annotation processing thread
        self.annotation_thread = threading.Thread(
            target=self._process_annotation_queue,
            daemon=True
        )
        self.annotation_thread.start()
        
        self.logger.info("AR WebRTC Client started")
    
    def stop(self):
        """Stop the AR WebRTC client"""
        self.logger.info("Stopping AR WebRTC Client...")
        self.should_stop.set()
        
        # Close WebSocket connection
        if self.websocket:
            asyncio.run_coroutine_threadsafe(
                self.websocket.close(),
                self.websocket_thread._loop if hasattr(self.websocket_thread, '_loop') else None
            )
        
        # Wait for threads to finish
        if self.websocket_thread and self.websocket_thread.is_alive():
            self.websocket_thread.join(timeout=2)
        
        if self.annotation_thread and self.annotation_thread.is_alive():
            self.annotation_thread.join(timeout=2)
        
        self.logger.info("AR WebRTC Client stopped")
    
    def _run_websocket_client(self):
        """Run WebSocket client in asyncio event loop"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            loop.run_until_complete(self._websocket_client_loop())
        except Exception as e:
            self.logger.error(f"WebSocket client error: {e}")
        finally:
            loop.close()
    
    async def _websocket_client_loop(self):
        """Main WebSocket client loop with reconnection logic"""
        while not self.should_stop.is_set():
            try:
                await self._connect_and_handle_messages()
            except Exception as e:
                self.logger.error(f"WebSocket connection error: {e}")
                
                if self.reconnect_attempts < self.max_reconnect_attempts:
                    self.reconnect_attempts += 1
                    wait_time = min(2 ** self.reconnect_attempts, 30)  # Exponential backoff
                    self.logger.info(f"Reconnecting in {wait_time} seconds... (attempt {self.reconnect_attempts})")
                    await asyncio.sleep(wait_time)
                else:
                    self.logger.error("Max reconnection attempts reached. Stopping.")
                    break
    
    async def _connect_and_handle_messages(self):
        """Connect to WebSocket and handle messages"""
        self.logger.info(f"Connecting to WebRTC bridge: {self.bridge_url}")
        
        async with websockets.connect(
            self.bridge_url,
            timeout=10,
            ping_interval=20,
            ping_timeout=10
        ) as websocket:
            
            self.websocket = websocket
            self.is_connected = True
            self.reconnect_attempts = 0
            
            self.logger.info("Connected to WebRTC bridge")
            
            # Start ping task
            ping_task = asyncio.create_task(self._ping_loop())
            
            try:
                # Handle incoming messages
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        await self._handle_message(data)
                    except json.JSONDecodeError:
                        self.logger.error("Received invalid JSON message")
                    except Exception as e:
                        self.logger.error(f"Error handling message: {e}")
            
            finally:
                ping_task.cancel()
                self.is_connected = False
                self.websocket = None
    
    async def _handle_message(self, data: Dict[str, Any]):
        """Handle incoming WebSocket message"""
        message_type = data.get('type')
        
        if message_type == 'connected':
            self.client_id = data.get('client_id')
            self.logger.info(f"Assigned client ID: {self.client_id}")
            
        elif message_type == 'session_created' or message_type == 'session_available':
            self.session_id = data.get('session_id')
            self.logger.info(f"AR session {message_type}: {self.session_id}")
            
        elif message_type == 'annotation':
            await self._handle_incoming_annotation(data)
            
        elif message_type == 'annotations_cleared':
            await self._handle_annotations_cleared(data)
            
        elif message_type == 'pong':
            # Handle ping response
            current_time = time.time()
            if self.stats['last_ping_time'] > 0:
                self.stats['ping_latency'] = current_time - self.stats['last_ping_time']
            
        else:
            self.logger.debug(f"Unknown message type: {message_type}")
    
    async def _handle_incoming_annotation(self, data: Dict[str, Any]):
        """Handle incoming annotation from doctor"""
        annotation_data = data.get('data', {})
        source = data.get('source', 'unknown')
        
        if source == 'doctor':
            # Add to incoming annotations queue
            annotation = {
                'id': f"ann_{int(time.time() * 1000)}",
                'type': annotation_data.get('type', 'draw'),
                'data': annotation_data.get('data', {}),
                'timestamp': data.get('timestamp', time.time()),
                'source': source,
                'received_at': time.time()
            }
            
            self.incoming_annotations.append(annotation)
            self.active_annotations[annotation['id']] = annotation
            self.stats['annotations_received'] += 1
            
            # Call annotation callbacks
            for callback in self.annotation_callbacks:
                try:
                    callback(annotation)
                except Exception as e:
                    self.logger.error(f"Error in annotation callback: {e}")
            
            self.logger.debug(f"Received annotation from doctor: {annotation['type']}")
    
    async def _handle_annotations_cleared(self, data: Dict[str, Any]):
        """Handle annotation clearing"""
        clear_type = data.get('clear_type', 'all')
        cleared_by = data.get('cleared_by', 'unknown')
        
        if clear_type == 'all':
            self.incoming_annotations.clear()
            self.active_annotations.clear()
        
        self.logger.info(f"Annotations cleared by {cleared_by} (type: {clear_type})")
        
        # Notify callbacks about clearing
        for callback in self.annotation_callbacks:
            try:
                callback({'type': 'clear', 'clear_type': clear_type})
            except Exception as e:
                self.logger.error(f"Error in annotation callback: {e}")
    
    async def _ping_loop(self):
        """Send periodic ping messages"""
        while not self.should_stop.is_set():
            try:
                if self.websocket and not self.websocket.closed:
                    self.stats['last_ping_time'] = time.time()
                    await self.websocket.send(json.dumps({
                        'type': 'ping',
                        'timestamp': self.stats['last_ping_time']
                    }))
                
                await asyncio.sleep(30)  # Ping every 30 seconds
                
            except Exception as e:
                self.logger.error(f"Ping error: {e}")
                break
    
    def _process_annotation_queue(self):
        """Process outgoing annotation queue"""
        while not self.should_stop.is_set():
            try:
                # Process outgoing annotations
                if not self.outgoing_annotations.empty() and self.is_connected:
                    annotation = self.outgoing_annotations.get(timeout=1)
                    
                    # Send to WebSocket (need to use asyncio from this thread)
                    if self.websocket and not self.websocket.closed:
                        message = json.dumps({
                            'type': 'annotation',
                            'data': annotation
                        })
                        
                        # Send message asynchronously
                        future = asyncio.run_coroutine_threadsafe(
                            self.websocket.send(message),
                            self.websocket_thread._loop
                        )
                        
                        try:
                            future.result(timeout=1)
                            self.stats['annotations_sent'] += 1
                            self.logger.debug(f"Sent annotation: {annotation.get('type')}")
                        except Exception as e:
                            self.logger.error(f"Failed to send annotation: {e}")
                
                else:
                    time.sleep(0.1)  # Small delay when queue is empty
                    
            except queue.Empty:
                continue
            except Exception as e:
                self.logger.error(f"Error processing annotation queue: {e}")
                time.sleep(1)
    
    def send_annotation(self, annotation_type: str, annotation_data: Dict[str, Any]):
        """Send annotation to doctor"""
        if not self.is_connected or not self.enable_bidirectional:
            self.logger.warning("Cannot send annotation: not connected or bidirectional disabled")
            return False
        
        annotation = {
            'type': annotation_type,
            'data': annotation_data,
            'metadata': {
                'source': 'field_medic',
                'timestamp': time.time(),
                'client_id': self.client_id
            }
        }
        
        try:
            self.outgoing_annotations.put(annotation, timeout=1)
            return True
        except queue.Full:
            self.logger.warning("Annotation queue full, dropping annotation")
            return False
    
    def add_annotation_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """Add callback function for incoming annotations"""
        self.annotation_callbacks.append(callback)
    
    def remove_annotation_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """Remove annotation callback"""
        if callback in self.annotation_callbacks:
            self.annotation_callbacks.remove(callback)
    
    def get_recent_annotations(self, max_age_seconds: float = 60.0) -> List[Dict[str, Any]]:
        """Get recent annotations within specified age"""
        current_time = time.time()
        recent_annotations = []
        
        for annotation in list(self.incoming_annotations):
            age = current_time - annotation.get('received_at', 0)
            if age <= max_age_seconds:
                recent_annotations.append(annotation)
        
        return recent_annotations
    
    def overlay_annotations_on_frame(self, frame: np.ndarray) -> np.ndarray:
        """Overlay doctor's annotations on camera frame"""
        if not self.overlay_settings['show_doctor_annotations']:
            return frame
        
        # Get recent annotations
        recent_annotations = self.get_recent_annotations(self.overlay_settings['fade_time'])
        
        if not recent_annotations:
            return frame
        
        # Create overlay
        overlay = frame.copy()
        current_time = time.time()
        
        for annotation in recent_annotations[-self.overlay_settings['max_visible_annotations']:]:
            try:
                self._draw_annotation_on_frame(overlay, annotation, current_time)
            except Exception as e:
                self.logger.error(f"Error drawing annotation: {e}")
        
        # Blend overlay with original frame
        alpha = self.overlay_settings['annotation_opacity']
        result = cv2.addWeighted(frame, 1 - alpha, overlay, alpha, 0)
        
        return result
    
    def _draw_annotation_on_frame(self, frame: np.ndarray, annotation: Dict[str, Any], current_time: float):
        """Draw individual annotation on frame"""
        annotation_type = annotation.get('type')
        data = annotation.get('data', {})
        age = current_time - annotation.get('received_at', current_time)
        
        # Calculate fade factor
        fade_factor = max(0, 1 - (age / self.overlay_settings['fade_time']))
        if fade_factor <= 0:
            return
        
        height, width = frame.shape[:2]
        
        if annotation_type == 'draw' and 'points' in data:
            self._draw_path_annotation(frame, data, fade_factor, width, height)
        elif annotation_type == 'arrow':
            self._draw_arrow_annotation(frame, data, fade_factor, width, height)
        elif annotation_type == 'circle':
            self._draw_circle_annotation(frame, data, fade_factor, width, height)
        elif annotation_type == 'rectangle':
            self._draw_rectangle_annotation(frame, data, fade_factor, width, height)
        elif annotation_type == 'text':
            self._draw_text_annotation(frame, data, fade_factor, width, height)
    
    def _draw_path_annotation(self, frame: np.ndarray, data: Dict[str, Any], fade_factor: float, width: int, height: int):
        """Draw path/drawing annotation"""
        points = data.get('points', [])
        if len(points) < 2:
            return
        
        color = self._hex_to_bgr(data.get('color', '#FF0000'))
        thickness = int(data.get('thickness', 3) * self.overlay_settings['line_thickness_scale'])
        
        # Apply fade
        color = tuple(int(c * fade_factor) for c in color)
        
        # Convert normalized points to pixel coordinates
        pixel_points = []
        for point in points:
            x = int(point['x'] * width)
            y = int(point['y'] * height)
            pixel_points.append((x, y))
        
        # Draw path
        for i in range(1, len(pixel_points)):
            cv2.line(frame, pixel_points[i-1], pixel_points[i], color, thickness)
    
    def _draw_arrow_annotation(self, frame: np.ndarray, data: Dict[str, Any], fade_factor: float, width: int, height: int):
        """Draw arrow annotation"""
        start = data.get('start', {})
        end = data.get('end', {})
        
        if not start or not end:
            return
        
        color = self._hex_to_bgr(data.get('color', '#FF0000'))
        thickness = int(data.get('thickness', 3) * self.overlay_settings['line_thickness_scale'])
        
        # Apply fade
        color = tuple(int(c * fade_factor) for c in color)
        
        # Convert to pixel coordinates
        start_point = (int(start['x'] * width), int(start['y'] * height))
        end_point = (int(end['x'] * width), int(end['y'] * height))
        
        # Draw arrow
        cv2.arrowedLine(frame, start_point, end_point, color, thickness, tipLength=0.3)
    
    def _draw_text_annotation(self, frame: np.ndarray, data: Dict[str, Any], fade_factor: float, width: int, height: int):
        """Draw text annotation"""
        text = data.get('text', '')
        position = data.get('position', {})
        
        if not text or not position:
            return
        
        color = self._hex_to_bgr(data.get('color', '#FFFFFF'))
        scale = data.get('scale', 1.0) * self.overlay_settings['text_scale']
        
        # Apply fade
        color = tuple(int(c * fade_factor) for c in color)
        
        # Convert to pixel coordinates
        pos = (int(position['x'] * width), int(position['y'] * height))
        
        # Draw text with background
        font = cv2.FONT_HERSHEY_SIMPLEX
        thickness = 2
        
        # Get text size for background
        (text_width, text_height), baseline = cv2.getTextSize(text, font, scale, thickness)
        
        # Draw background rectangle
        bg_color = (0, 0, 0)  # Black background
        cv2.rectangle(frame, 
                     (pos[0] - 5, pos[1] - text_height - 5),
                     (pos[0] + text_width + 5, pos[1] + baseline + 5),
                     bg_color, -1)
        
        # Draw text
        cv2.putText(frame, text, pos, font, scale, color, thickness)
    
    def _hex_to_bgr(self, hex_color: str) -> Tuple[int, int, int]:
        """Convert hex color to BGR tuple"""
        hex_color = hex_color.lstrip('#')
        if len(hex_color) != 6:
            return (0, 0, 255)  # Default red
        
        try:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return (b, g, r)  # OpenCV uses BGR
        except ValueError:
            return (0, 0, 255)  # Default red
    
    def clear_annotations(self):
        """Clear all annotations"""
        if self.is_connected:
            asyncio.run_coroutine_threadsafe(
                self.websocket.send(json.dumps({
                    'type': 'clear_annotations',
                    'clear_type': 'all'
                })),
                self.websocket_thread._loop
            )
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics"""
        uptime = time.time() - self.stats['start_time']
        
        return {
            **self.stats,
            'connection_uptime': uptime,
            'is_connected': self.is_connected,
            'client_id': self.client_id,
            'session_id': self.session_id,
            'room_id': self.room_id,
            'active_annotations_count': len(self.active_annotations),
            'recent_annotations_count': len(self.get_recent_annotations()),
            'ping_latency_ms': self.stats['ping_latency'] * 1000
        }


# Example usage and integration with existing camera AR system
def integrate_with_camera_ar(camera_ar_system, room_id: str, bridge_url: str = 'ws://localhost:8765'):
    """Integrate AR WebRTC client with existing camera AR system"""
    
    # Create AR WebRTC client
    ar_client = ARWebRTCClient(bridge_url=bridge_url, room_id=room_id)
    
    # Add annotation callback to handle incoming annotations
    def handle_doctor_annotation(annotation):
        print(f"📥 Received doctor annotation: {annotation['type']}")
        # You can add logic here to integrate with the existing AR system
    
    ar_client.add_annotation_callback(handle_doctor_annotation)
    
    # Start the client
    ar_client.start(room_id)
    
    # Modify the camera AR system's frame processing to include annotations
    original_process_frame = getattr(camera_ar_system, 'process_frame', None)
    
    if original_process_frame:
        def enhanced_process_frame(frame):
            # Process frame with original AR system
            processed_frame = original_process_frame(frame)
            
            # Overlay doctor annotations
            annotated_frame = ar_client.overlay_annotations_on_frame(processed_frame)
            
            return annotated_frame
        
        # Replace the original method
        camera_ar_system.process_frame = enhanced_process_frame
    
    return ar_client


if __name__ == '__main__':
    # Test the AR WebRTC client
    import argparse
    
    parser = argparse.ArgumentParser(description='AR WebRTC Client Test')
    parser.add_argument('--room-id', required=True, help='Room ID to join')
    parser.add_argument('--bridge-url', default='ws://localhost:8765', help='Bridge WebSocket URL')
    
    args = parser.parse_args()
    
    # Create and start client
    client = ARWebRTCClient(bridge_url=args.bridge_url, room_id=args.room_id)
    
    def test_callback(annotation):
        print(f"Received annotation: {annotation}")
    
    client.add_annotation_callback(test_callback)
    client.start(args.room_id)
    
    try:
        print("AR WebRTC Client running. Press Ctrl+C to stop.")
        while True:
            time.sleep(1)
            stats = client.get_stats()
            if stats['is_connected']:
                print(f"Stats: {stats['annotations_received']} received, {stats['ping_latency_ms']:.1f}ms ping")
    except KeyboardInterrupt:
        print("Stopping...")
    finally:
        client.stop()