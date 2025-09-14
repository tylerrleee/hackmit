"""
Threaded camera capture and AR processing system
Optimized for high frame rate medical AR applications
"""

import threading
import time
import cv2
import numpy as np
from typing import Optional, Dict, Any, Callable, Tuple
import logging
from threading_utils import (
    FrameData, ARProcessingResult, CircularFrameBuffer, 
    ThreadSafeDict, PerformanceMonitor, AdaptiveFrameProcessor,
    ThreadCoordinator
)

# Import AR components
try:
    from ar_core import EnhancedMedicalARProcessor
    AR_AVAILABLE = True
except ImportError:
    AR_AVAILABLE = False
    print("Warning: AR components not available. Running in camera-only mode.")

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("Warning: OpenCV not available. Camera capture disabled.")


class ThreadedCameraCapture:
    """High-performance threaded camera capture with circular buffering"""
    
    def __init__(self, camera_index=0, buffer_size=10, target_fps=30):
        self.camera_index = camera_index
        self.buffer_size = buffer_size
        self.target_fps = target_fps
        self.frame_interval = 1.0 / target_fps
        
        # Threading components
        self.capture_thread = None
        self.running = False
        self.frame_buffer = CircularFrameBuffer(buffer_size)
        self.performance_monitor = PerformanceMonitor()
        self.coordinator = ThreadCoordinator()
        
        # Camera components
        self.cap = None
        self.frame_id_counter = 0
        self.last_capture_time = 0
        
        # Camera settings
        self.camera_settings = {
            'width': 640,
            'height': 480,
            'fps': target_fps
        }
        
        # Statistics
        self.stats = ThreadSafeDict()
        self._init_stats()
    
    def _init_stats(self):
        """Initialize statistics tracking"""
        self.stats.update({
            'frames_captured': 0,
            'frames_dropped': 0,
            'capture_errors': 0,
            'average_fps': 0.0,
            'camera_connected': False
        })
    
    def initialize_camera(self) -> bool:
        """Initialize camera connection"""
        if not CV2_AVAILABLE:
            logging.error("OpenCV not available for camera capture")
            return False
        
        try:
            self.cap = cv2.VideoCapture(self.camera_index)
            
            if not self.cap.isOpened():
                logging.error(f"Failed to open camera {self.camera_index}")
                return False
            
            # Configure camera settings
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.camera_settings['width'])
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.camera_settings['height'])
            self.cap.set(cv2.CAP_PROP_FPS, self.camera_settings['fps'])
            
            # Enable camera buffering for better performance
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            self.stats['camera_connected'] = True
            logging.info(f"Camera {self.camera_index} initialized successfully")
            return True
            
        except Exception as e:
            logging.error(f"Camera initialization failed: {e}")
            self.coordinator.report_error('capture', e)
            return False
    
    def start_capture(self):
        """Start the camera capture thread"""
        if not self.initialize_camera():
            return False
        
        self.running = True
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.capture_thread.start()
        
        logging.info("Camera capture thread started")
        return True
    
    def stop_capture(self):
        """Stop the camera capture thread"""
        self.running = False
        self.coordinator.signal_shutdown()
        
        if self.capture_thread and self.capture_thread.is_alive():
            self.capture_thread.join(timeout=2.0)
        
        if self.cap:
            self.cap.release()
            self.cap = None
        
        self.stats['camera_connected'] = False
        logging.info("Camera capture stopped")
    
    def _capture_loop(self):
        """Main camera capture loop running in separate thread"""
        last_fps_time = time.time()
        fps_frame_count = 0
        
        while self.running and not self.coordinator.is_shutdown_requested():
            try:
                # Check if paused
                if self.coordinator.is_paused():
                    time.sleep(0.1)
                    continue
                
                # Heartbeat signal
                self.coordinator.heartbeat('capture')
                
                # Performance timing
                self.performance_monitor.start_timer('capture')
                
                # Capture frame
                ret, frame = self.cap.read()
                
                if not ret:
                    self.stats['capture_errors'] += 1
                    logging.warning("Failed to capture frame")
                    time.sleep(0.01)
                    continue
                
                # Create frame data
                current_time = time.time()
                frame_data = FrameData(
                    frame=frame,
                    timestamp=current_time,
                    frame_id=self.frame_id_counter,
                    metadata={
                        'camera_index': self.camera_index,
                        'capture_time': current_time
                    }
                )
                
                # Add to buffer (non-blocking)
                try:
                    self.frame_buffer.put(frame_data, block=False)
                    self.stats['frames_captured'] += 1
                    self.frame_id_counter += 1
                except:
                    self.stats['frames_dropped'] += 1
                
                # Record performance metrics
                self.performance_monitor.end_timer('capture')
                self.performance_monitor.record_fps('capture')
                
                # Update FPS statistics
                fps_frame_count += 1
                if current_time - last_fps_time >= 1.0:
                    self.stats['average_fps'] = fps_frame_count / (current_time - last_fps_time)
                    fps_frame_count = 0
                    last_fps_time = current_time
                
                # Frame rate limiting
                if self.frame_interval > 0:
                    elapsed = time.time() - current_time
                    sleep_time = max(0, self.frame_interval - elapsed)
                    if sleep_time > 0:
                        time.sleep(sleep_time)
                
            except Exception as e:
                self.coordinator.report_error('capture', e)
                logging.error(f"Capture loop error: {e}")
                time.sleep(0.1)
    
    def get_latest_frame(self) -> Optional[FrameData]:
        """Get the most recent frame without blocking"""
        return self.frame_buffer.get_latest()
    
    def get_frame(self, timeout=None) -> Optional[FrameData]:
        """Get next frame from buffer"""
        try:
            return self.frame_buffer.get(block=True, timeout=timeout)
        except:
            return None
    
    def get_stats(self) -> Dict[str, Any]:
        """Get capture statistics"""
        buffer_stats = self.frame_buffer.get_stats()
        
        return {
            **self.stats.copy(),
            **buffer_stats,
            'thread_health': self.coordinator.get_thread_health().get('capture', {}),
            'performance': self.performance_monitor.get_stats()
        }
    
    def set_camera_settings(self, **settings):
        """Update camera settings"""
        if self.cap and self.cap.isOpened():
            for prop, value in settings.items():
                if prop == 'width':
                    self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, value)
                elif prop == 'height':
                    self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, value)
                elif prop == 'fps':
                    self.cap.set(cv2.CAP_PROP_FPS, value)
                    self.target_fps = value
                    self.frame_interval = 1.0 / value
        
        self.camera_settings.update(settings)


class ARProcessingWorker:
    """Background AR processing worker with adaptive quality control"""
    
    def __init__(self, camera_capture: ThreadedCameraCapture, target_fps=20):
        self.camera_capture = camera_capture
        self.target_fps = target_fps
        
        # Threading components
        self.processing_thread = None
        self.running = False
        self.coordinator = camera_capture.coordinator
        self.performance_monitor = camera_capture.performance_monitor
        
        # AR components
        self.ar_processor = None
        self.ar_available = AR_AVAILABLE
        
        # Processing components
        self.adaptive_processor = AdaptiveFrameProcessor(target_fps)
        self.results_buffer = ThreadSafeDict()
        self.last_process_time = 0
        
        # Statistics
        self.stats = ThreadSafeDict()
        self._init_stats()
        
        self._initialize_ar_processor()
    
    def _init_stats(self):
        """Initialize processing statistics"""
        self.stats.update({
            'frames_processed': 0,
            'frames_skipped': 0,
            'processing_errors': 0,
            'average_processing_time': 0.0,
            'ar_tracking_active': False
        })
    
    def _initialize_ar_processor(self):
        """Initialize AR processing components"""
        if not self.ar_available:
            logging.warning("AR processing not available")
            return
        
        try:
            self.ar_processor = EnhancedMedicalARProcessor(
                medical_precision_mode=True
            )
            self.stats['ar_tracking_active'] = True
            logging.info("AR processor initialized")
            
        except Exception as e:
            logging.error(f"AR processor initialization failed: {e}")
            self.coordinator.report_error('processing', e)
            self.ar_available = False
    
    def start_processing(self):
        """Start the AR processing thread"""
        self.running = True
        self.processing_thread = threading.Thread(target=self._processing_loop, daemon=True)
        self.processing_thread.start()
        
        logging.info("AR processing thread started")
    
    def stop_processing(self):
        """Stop the AR processing thread"""
        self.running = False
        
        if self.processing_thread and self.processing_thread.is_alive():
            self.processing_thread.join(timeout=2.0)
        
        logging.info("AR processing stopped")
    
    def _processing_loop(self):
        """Main AR processing loop"""
        while self.running and not self.coordinator.is_shutdown_requested():
            try:
                # Check if paused
                if self.coordinator.is_paused():
                    time.sleep(0.1)
                    continue
                
                # Heartbeat signal
                self.coordinator.heartbeat('processing')
                
                # Get frame for processing
                frame_data = self.camera_capture.get_frame(timeout=0.1)
                if not frame_data:
                    continue
                
                current_time = time.time()
                
                # Adaptive frame processing - skip frames if needed
                if not self.adaptive_processor.should_process_frame(current_time, self.last_process_time):
                    self.stats['frames_skipped'] += 1
                    continue
                
                # Start processing timer
                self.performance_monitor.start_timer('processing')
                
                # Process frame through AR pipeline
                results = self._process_frame(frame_data)
                
                # Record processing time and adapt quality
                processing_time = self.performance_monitor.end_timer('processing')
                quality_settings = self.adaptive_processor.adapt_quality(processing_time)
                
                # Store results
                self.results_buffer[frame_data.frame_id] = ARProcessingResult(
                    frame_id=frame_data.frame_id,
                    timestamp=frame_data.timestamp,
                    processing_time=processing_time,
                    ar_data=results,
                    tracking_results=results.get('tracked_objects', {}),
                    anchors=results.get('anchor_positions', {}),
                    overlay_data=results.get('overlay_data', {})
                )
                
                # Update statistics
                self.stats['frames_processed'] += 1
                self.performance_monitor.record_fps('processing')
                self.last_process_time = current_time
                
                # Cleanup old results (keep last 50)
                result_keys = list(self.results_buffer.keys())
                if len(result_keys) > 50:
                    for old_key in result_keys[:-50]:
                        del self.results_buffer.data[old_key]
                
            except Exception as e:
                self.coordinator.report_error('processing', e)
                logging.error(f"Processing loop error: {e}")
                self.stats['processing_errors'] += 1
                time.sleep(0.1)
    
    def _process_frame(self, frame_data: FrameData) -> Dict[str, Any]:
        """Process single frame through AR pipeline"""
        if not self.ar_available or not self.ar_processor:
            return self._basic_frame_processing(frame_data)
        
        try:
            # Get quality settings for adaptive processing
            quality_settings = self.adaptive_processor.get_current_settings()
            
            # Scale frame if needed for performance
            frame = frame_data.frame
            if quality_settings['scale'] < 1.0:
                new_height = int(frame.shape[0] * quality_settings['scale'])
                new_width = int(frame.shape[1] * quality_settings['scale'])
                frame = cv2.resize(frame, (new_width, new_height))
            
            # Mock IMU data (in real implementation, this would come from sensors)
            imu_data = {
                'acceleration': np.array([0.0, 0.0, 9.81]),
                'gyroscope': np.array([0.0, 0.0, 0.0]),
                'timestamp': frame_data.timestamp
            }
            
            # Process through AR system
            ar_results = self.ar_processor.process_camera_footage(
                frame, frame, imu_data, frame_data.timestamp
            )
            
            # Add quality information
            ar_results['quality_settings'] = quality_settings
            ar_results['processing_scale'] = quality_settings['scale']
            
            return ar_results
            
        except Exception as e:
            logging.error(f"AR processing error: {e}")
            return self._basic_frame_processing(frame_data)
    
    def _basic_frame_processing(self, frame_data: FrameData) -> Dict[str, Any]:
        """Basic frame processing when AR is not available"""
        return {
            'frame_id': frame_data.frame_id,
            'timestamp': frame_data.timestamp,
            'camera_pose': {'position': [0, 0, 0], 'orientation': [1, 0, 0, 0]},
            'tracked_objects': [],
            'anchor_positions': {},
            'system_status': {
                'tracking_quality': 0.0,
                'ar_available': False
            }
        }
    
    def get_latest_results(self) -> Optional[ARProcessingResult]:
        """Get most recent AR processing results"""
        if not self.results_buffer.data:
            return None
        
        latest_frame_id = max(self.results_buffer.keys())
        return self.results_buffer[latest_frame_id]
    
    def get_results_for_frame(self, frame_id: int) -> Optional[ARProcessingResult]:
        """Get AR results for specific frame"""
        return self.results_buffer.get(frame_id)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get processing statistics"""
        return {
            **self.stats.copy(),
            'adaptive_settings': self.adaptive_processor.get_current_settings(),
            'thread_health': self.coordinator.get_thread_health().get('processing', {}),
            'results_buffer_size': len(self.results_buffer.data)
        }


class DisplayRenderer:
    """Main-thread display renderer with overlay support (macOS compatible)"""
    
    def __init__(self, camera_capture: ThreadedCameraCapture, ar_processor: ARProcessingWorker):
        self.camera_capture = camera_capture
        self.ar_processor = ar_processor
        
        # Threading components (but display runs on main thread)
        self.display_thread = None
        self.running = False
        self.coordinator = camera_capture.coordinator
        self.performance_monitor = camera_capture.performance_monitor
        
        # Window state
        self.window_initialized = False
        
        # Display settings
        self.display_settings = {
            'window_name': 'Medical AR System',
            'fullscreen_window_name': 'Medical AR System - Fullscreen',
            'show_fps': False,  # Disabled for cleaner interface
            'show_stats': True, 
            'show_overlays': True,
            'fullscreen_mode': False,
            'ui_scale_factor': 1.0
        }
        
        # User interaction
        self.mouse_callback = None
        self.key_handlers = {}
        
        # Statistics
        self.stats = ThreadSafeDict()
        self._init_stats()
    
    def _init_stats(self):
        """Initialize display statistics"""
        self.stats.update({
            'frames_displayed': 0,
            'display_errors': 0,
            'user_interactions': 0,
            'average_display_fps': 0.0
        })
    
    def set_mouse_callback(self, callback: Callable):
        """Set mouse callback function"""
        self.mouse_callback = callback
    
    def set_key_handler(self, key: str, handler: Callable):
        """Set keyboard key handler"""
        self.key_handlers[key] = handler
    
    def toggle_fullscreen(self):
        """Toggle fullscreen display mode"""
        self.display_settings['fullscreen_mode'] = not self.display_settings['fullscreen_mode']
        
        if self.display_settings['fullscreen_mode']:
            # Switch to fullscreen
            if self.window_initialized:
                cv2.destroyWindow(self.display_settings['window_name'])
            
            # Create fullscreen window
            cv2.namedWindow(self.display_settings['fullscreen_window_name'], cv2.WINDOW_NORMAL)
            cv2.setWindowProperty(self.display_settings['fullscreen_window_name'], 
                                 cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
            
            # Update UI scale factor for fullscreen
            self.display_settings['ui_scale_factor'] = 1.5
            
            # Set mouse callback for fullscreen window
            if self.mouse_callback:
                cv2.setMouseCallback(self.display_settings['fullscreen_window_name'], self._mouse_handler)
                
            logging.info("Switched to fullscreen mode")
        else:
            # Switch back to windowed mode
            if self.window_initialized:
                cv2.destroyWindow(self.display_settings['fullscreen_window_name'])
            
            # Create regular window
            cv2.namedWindow(self.display_settings['window_name'], cv2.WINDOW_AUTOSIZE)
            
            # Reset UI scale factor
            self.display_settings['ui_scale_factor'] = 1.0
            
            # Set mouse callback for regular window
            if self.mouse_callback:
                cv2.setMouseCallback(self.display_settings['window_name'], self._mouse_handler)
                
            logging.info("Switched to windowed mode")
        
        return self.display_settings['fullscreen_mode']
    
    def initialize_display(self):
        """Initialize display (must be called from main thread)"""
        if not CV2_AVAILABLE:
            logging.error("OpenCV not available for display")
            return False
        
        if not self.window_initialized:
            cv2.namedWindow(self.display_settings['window_name'], cv2.WINDOW_AUTOSIZE)
            
            if self.mouse_callback:
                cv2.setMouseCallback(self.display_settings['window_name'], self._mouse_handler)
            
            self.window_initialized = True
        
        self.running = True
        logging.info("Display initialized on main thread")
        return True
    
    def stop_display(self):
        """Stop the display"""
        self.running = False
        
        if self.window_initialized:
            cv2.destroyAllWindows()
            self.window_initialized = False
        
        logging.info("Display stopped")
    
    def render_frame(self):
        """Render a single frame (call from main thread)"""
        if not self.running or not self.window_initialized:
            return None
        
        try:
            # Check if paused
            if self.coordinator.is_paused():
                return None
            
            # Heartbeat signal
            self.coordinator.heartbeat('display')
            
            # Start display timer
            self.performance_monitor.start_timer('display')
            
            # Get latest frame
            frame_data = self.camera_capture.get_latest_frame()
            if frame_data is None:
                return None
            
            # Get AR results
            ar_results = self.ar_processor.get_results_for_frame(frame_data.frame_id)
            
            # Render frame with overlays
            display_frame = self._render_frame(frame_data, ar_results)
            
            # Display frame using appropriate window
            window_name = (self.display_settings['fullscreen_window_name'] 
                          if self.display_settings['fullscreen_mode'] 
                          else self.display_settings['window_name'])
            cv2.imshow(window_name, display_frame)
            
            # Update statistics
            self.stats['frames_displayed'] += 1
            self.performance_monitor.end_timer('display')
            self.performance_monitor.record_fps('display')
            
            # Handle keyboard input (after stats to avoid early return)
            key = cv2.waitKey(1) & 0xFF
            if key != 255:
                return self._handle_key_input(key)
            
            return None  # No key pressed, frame rendered successfully
            
        except Exception as e:
            self.coordinator.report_error('display', e)
            logging.error(f"Display render error: {e}")
            self.stats['display_errors'] += 1
            return None
    
    def _render_frame(self, frame_data: FrameData, ar_results: Optional[ARProcessingResult]) -> np.ndarray:
        """Render frame with AR overlays and UI elements"""
        frame = frame_data.frame.copy()
        
        if ar_results is not None and self.display_settings['show_overlays']:
            frame = self._render_ar_overlays(frame, ar_results)
        
        if self.display_settings['show_stats']:
            frame = self._render_stats_overlay(frame)
        
        if self.display_settings['show_fps']:
            frame = self._render_fps_overlay(frame)
        
        # Render WebRTC annotations from doctor if available
        if hasattr(self.camera_system, 'ar_webrtc_client') and self.camera_system.ar_webrtc_client:
            frame = self.camera_system.ar_webrtc_client.overlay_annotations_on_frame(frame)
        
        return frame
    
    def _render_ar_overlays(self, frame: np.ndarray, ar_results: ARProcessingResult) -> np.ndarray:
        """Render AR tracking overlays"""
        # Render tracked objects
        if 'tracked_objects' in ar_results.tracking_results:
            for obj in ar_results.tracking_results['tracked_objects']:
                if 'bbox' in obj:
                    bbox = obj['bbox']
                    cv2.rectangle(frame, 
                                (int(bbox[0]), int(bbox[1])), 
                                (int(bbox[2]), int(bbox[3])), 
                                (0, 255, 0), 2)
                    
                    if 'label' in obj:
                        cv2.putText(frame, obj['label'], 
                                  (int(bbox[0]), int(bbox[1])-10),
                                  cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        
        # Render spatial anchors
        if ar_results.anchors:
            for anchor_id, anchor_data in ar_results.anchors.items():
                if 'screen_pos' in anchor_data:
                    pos = anchor_data['screen_pos']
                    cv2.circle(frame, (int(pos[0]), int(pos[1])), 5, (255, 0, 0), -1)
                    cv2.putText(frame, f"A{anchor_id[:4]}", 
                              (int(pos[0])+10, int(pos[1])),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)
        
        return frame
    
    def _render_stats_overlay(self, frame: np.ndarray) -> np.ndarray:
        """Render system statistics overlay"""
        y_offset = 30
        line_height = 20
        
        # Get statistics from all components
        capture_stats = self.camera_capture.get_stats()
        processing_stats = self.ar_processor.get_stats()
        
        stats_text = [
            f"Capture: {capture_stats.get('average_fps', 0):.1f} FPS",
            f"Processing: {processing_stats.get('frames_processed', 0)} frames",
            f"Buffer: {capture_stats.get('current_size', 0)}/{capture_stats.get('max_size', 0)}",
            f"Dropped: {capture_stats.get('dropped_frames', 0)}"
        ]
        
        for i, text in enumerate(stats_text):
            cv2.putText(frame, text, (10, y_offset + i * line_height),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        return frame
    
    def _render_fps_overlay(self, frame: np.ndarray) -> np.ndarray:
        """Render FPS overlay"""
        fps_text = f"Display FPS: {self.stats.get('average_display_fps', 0):.1f}"
        cv2.putText(frame, fps_text, (frame.shape[1] - 200, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        return frame
    
    def _mouse_handler(self, event, x, y, flags, param):
        """Handle mouse events"""
        if self.mouse_callback:
            self.stats['user_interactions'] += 1
            self.mouse_callback(event, x, y, flags, param)
    
    def _handle_key_input(self, key):
        """Handle keyboard input"""
        key_char = chr(key) if key < 128 else None
        
        # Default key handlers
        if key == 27:  # ESC
            self.coordinator.signal_shutdown()
            return 'quit'
        elif key_char == 'p':
            if self.coordinator.is_paused():
                self.coordinator.resume()
            else:
                self.coordinator.pause()
            return 'pause'
        elif key_char in self.key_handlers:
            self.key_handlers[key_char]()
            return key_char
        
        return None
    
    def get_stats(self) -> Dict[str, Any]:
        """Get display statistics"""
        return {
            **self.stats.copy(),
            'thread_health': self.coordinator.get_thread_health().get('display', {}),
            'display_settings': self.display_settings.copy()
        }