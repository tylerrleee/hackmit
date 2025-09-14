#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Direct Camera Integration for Medical AR System

This script demonstrates real-time camera integration with the AR system.
Supports both stereo camera setups and single camera with side-by-side stereo.
"""

import numpy as np
import time
import sys
import os
import logging
from ar_core import CoreARProcessor, create_medical_ar_system, create_enhanced_medical_ar_system
from threaded_camera import ThreadedCameraCapture, ARProcessingWorker, DisplayRenderer
from threading_utils import ThreadCoordinator, PerformanceMonitor

# Handle optional opencv dependency gracefully
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("Error: OpenCV (cv2) is required for camera integration.")
    print("Install with: pip install opencv-python")
    sys.exit(1)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class CameraARSystem:
    """Multi-threaded real-time camera integration for AR processing with interactive drawing"""
    
    def __init__(self, camera_mode='single', left_camera_id=0, right_camera_id=1, use_threading=True, target_fps=30):
        """
        Initialize camera AR system
        
        Args:
            camera_mode: 'single' for single camera with stereo split, 'stereo' for two cameras
            left_camera_id: Camera ID for left camera (or main camera in single mode)
            right_camera_id: Camera ID for right camera (only used in stereo mode)
        """
        self.camera_mode = camera_mode
        self.left_camera_id = left_camera_id
        self.right_camera_id = right_camera_id
        self.use_threading = use_threading
        self.target_fps = target_fps
        
        # Multi-threaded components
        self.camera_capture = None
        self.ar_processor_worker = None
        self.display_renderer = None
        self.coordinator = None
        self.performance_monitor = None
        
        # Legacy components (for fallback)
        self.left_camera = None
        self.right_camera = None
        self.single_camera = None
        self.ar_processor = None
        
        # Frame dimensions
        self.frame_width = 640
        self.frame_height = 480
        
        # Performance tracking
        self.fps_counter = 0
        self.fps_start_time = time.time()
        self.current_fps = 0
        
        # Drawing system
        self.drawing_points = []  # List of drawing points
        self.drawing_lines = []   # List of connected lines
        self.current_line = []    # Current line being drawn
        self.drawing_mode = True
        self.drawing_color = (0, 255, 0)  # Green by default
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
        
        # Mouse state
        self.mouse_drawing = False
        self.last_mouse_pos = None
        
        # Enhanced medical tracking
        self.use_enhanced_tracking = True
        self.spatial_anchors = {}  # 3D anchored drawing points
        self.anchor_mode = False   # Toggle for creating 3D anchors
        
        # Object-anchored drawing system
        self.object_anchor_mode = False  # Toggle for anchoring drawings to objects
        self.selected_object_id = None   # Currently selected object for drawing
        self.object_anchored_drawings = {} # Drawings anchored to specific objects
        self.object_selection_radius = 30  # Pixels radius for object selection
        
        # Enhanced object selection system
        self.object_selection_mode = False  # Toggle for object selection mode
        self.selected_for_highlighting = None  # Object selected for highlighting (separate from drawing)
        
        threading_mode = "multi-threaded" if use_threading else "single-threaded"
        print(f"Initializing {threading_mode} camera system in {camera_mode} mode (target FPS: {target_fps})...")
        
    def initialize_cameras(self):
        """Initialize camera hardware with optional multi-threading"""
        try:
            if self.use_threading:
                # Initialize multi-threaded camera capture
                camera_id = self.left_camera_id  # Use left camera as primary
                buffer_size = 15  # Larger buffer for better performance
                
                self.camera_capture = ThreadedCameraCapture(
                    camera_index=camera_id,
                    buffer_size=buffer_size,
                    target_fps=self.target_fps
                )
                
                if not self.camera_capture.start_capture():
                    raise Exception("Failed to start threaded camera capture")
                
                print(f"✅ Multi-threaded camera capture initialized (Camera {camera_id})")
                print(f"   - Buffer size: {buffer_size} frames")
                print(f"   - Target FPS: {self.target_fps}")
                
                return True
            
            else:
                # Legacy single-threaded initialization
                return self._initialize_legacy_cameras()
                
        except Exception as e:
            print(f"❌ Camera initialization failed: {e}")
            if self.use_threading:
                print("   Falling back to single-threaded mode...")
                self.use_threading = False
                return self._initialize_legacy_cameras()
            return False
    
    def _initialize_legacy_cameras(self):
        """Legacy single-threaded camera initialization"""
        try:
            if self.camera_mode == 'stereo':
                # Two separate cameras
                self.left_camera = cv2.VideoCapture(self.left_camera_id)
                self.right_camera = cv2.VideoCapture(self.right_camera_id)
                
                if not self.left_camera.isOpened() or not self.right_camera.isOpened():
                    raise Exception("Could not open stereo cameras")
                
                # Set camera properties
                for camera in [self.left_camera, self.right_camera]:
                    camera.set(cv2.CAP_PROP_FRAME_WIDTH, self.frame_width)
                    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, self.frame_height)
                    camera.set(cv2.CAP_PROP_FPS, 30)
                
                print("✅ Legacy stereo cameras initialized")
                
            else:  # single camera mode
                self.single_camera = cv2.VideoCapture(self.left_camera_id)
                
                if not self.single_camera.isOpened():
                    raise Exception(f"Could not open camera {self.left_camera_id}")
                
                # Set camera properties (double width for side-by-side stereo)
                self.single_camera.set(cv2.CAP_PROP_FRAME_WIDTH, self.frame_width * 2)
                self.single_camera.set(cv2.CAP_PROP_FRAME_HEIGHT, self.frame_height)
                self.single_camera.set(cv2.CAP_PROP_FPS, 30)
                
                print("✅ Legacy single camera initialized (stereo split mode)")
                
            return True
            
        except Exception as e:
            print(f"❌ Legacy camera initialization failed: {e}")
            return False
    
    def initialize_ar_system(self):
        """Initialize the AR processing system with optional multi-threading"""
        try:
            if self.use_threading:
                # Initialize multi-threaded AR processing
                self.ar_processor_worker = ARProcessingWorker(
                    self.camera_capture, 
                    target_fps=max(15, self.target_fps - 10)  # Slightly lower for processing
                )
                
                self.ar_processor_worker.start_processing()
                
                # Initialize display renderer
                self.display_renderer = DisplayRenderer(
                    self.camera_capture, 
                    self.ar_processor_worker
                )
                
                # Set up mouse callback for drawing
                self.display_renderer.set_mouse_callback(self.mouse_callback)
                
                # Set up key handlers
                self._setup_key_handlers()
                
                if not self.display_renderer.initialize_display():
                    raise Exception("Failed to initialize display renderer")
                
                # Get coordinator and performance monitor
                self.coordinator = self.camera_capture.coordinator
                self.performance_monitor = self.camera_capture.performance_monitor
                
                print("✅ Multi-threaded AR system initialized")
                print("   - Threaded camera capture: ACTIVE")
                print("   - Background AR processing: ACTIVE")
                print("   - Display rendering: ACTIVE")
                
                return True
            
            else:
                # Legacy single-threaded AR initialization
                return self._initialize_legacy_ar_system()
                
        except Exception as e:
            print(f"❌ Multi-threaded AR system initialization failed: {e}")
            if self.use_threading:
                print("   Falling back to single-threaded mode...")
                self.use_threading = False
                return self._initialize_legacy_ar_system()
            return False
    
    def _initialize_legacy_ar_system(self):
        """Legacy single-threaded AR system initialization"""
        try:
            if self.use_enhanced_tracking:
                # Try enhanced medical AR system first
                try:
                    self.ar_processor = create_enhanced_medical_ar_system()
                    print("✅ Enhanced Medical AR system initialized (legacy mode)")
                    print("   - Medical object detection enabled")
                    print("   - 3D spatial anchoring enabled") 
                    print("   - Multi-object tracking enabled")
                    return True
                except Exception as e:
                    print(f"⚠️  Enhanced tracking not available: {e}")
                    print("   Falling back to basic AR system...")
                    self.use_enhanced_tracking = False
            
            # Fallback to basic system
            self.ar_processor = create_medical_ar_system()
            print("✅ Basic AR system initialized (legacy mode)")
            return True
            
        except Exception as e:
            print(f"❌ Legacy AR system initialization failed: {e}")
            print("Make sure to install requirements: pip install -r requirements.txt")
            return False
    
    def get_camera_frames(self):
        """Capture frames from cameras (legacy mode only)"""
        if self.use_threading:
            # In threaded mode, frames are handled by ThreadedCameraCapture
            return None, None
        
        if self.camera_mode == 'stereo':
            ret_l, left_frame = self.left_camera.read()
            ret_r, right_frame = self.right_camera.read()
            
            if not (ret_l and ret_r):
                return None, None
                
            return left_frame, right_frame
        
        else:  # single camera mode
            ret, frame = self.single_camera.read()
            
            if not ret:
                return None, None
            
            # Split the frame into left and right
            height, width = frame.shape[:2]
            left_frame = frame[:, :width//2]
            right_frame = frame[:, width//2:]
            
            return left_frame, right_frame
    
    def simulate_imu_data(self):
        """
        Simulate IMU data - replace this with real IMU sensor integration
        For XREAL glasses, this would come from their SDK
        """
        return {
            'accel': [0.1, -9.81, 0.2],  # Accelerometer (m/s²)
            'gyro': [0.01, 0.02, 0.01]   # Gyroscope (rad/s)
        }
    
    def _setup_key_handlers(self):
        """Setup keyboard event handlers for multi-threaded mode"""
        if not self.display_renderer:
            return
        
        # Map key handlers
        key_handlers = {
            'q': lambda: self.coordinator.signal_shutdown(),
            's': self.save_session,
            'd': self.toggle_drawing_mode,
            'c': self.cycle_drawing_color,
            'x': self.clear_drawings,
            'a': self.toggle_anchor_mode,
            'o': self.toggle_object_anchor_mode,
            'r': self._clear_selected_object,
            't': self._show_tracking_statistics,
            'v': self.toggle_object_selection_mode,  # 'v' for 'view/select'
            'z': self.clear_object_selection  # 'z' for 'clear selection'
        }
        
        for key, handler in key_handlers.items():
            self.display_renderer.set_key_handler(key, handler)
    
    def mouse_callback(self, event, x, y, flags, param):
        """Handle mouse events for object selection, drawing and 3D anchoring"""
        if event == cv2.EVENT_LBUTTONDOWN:
            # Priority 1: Object selection mode (independent of drawing mode)
            if self.object_selection_mode and self.use_enhanced_tracking:
                selected_obj = self._select_object_for_highlighting((x, y))
                if selected_obj:
                    self.selected_for_highlighting = selected_obj['track_id']
                    print(f"🎯 Selected object {self.selected_for_highlighting} ({selected_obj['class_name']}) for highlighting")
                    return
                else:
                    print("❌ No object found at click position")
                    return
        
        # Return early if not in drawing mode for drawing-related operations
        if not self.drawing_mode:
            return
            
        if event == cv2.EVENT_LBUTTONDOWN:
            # Check if in object anchor mode - select object for drawing
            if self.object_anchor_mode and self.use_enhanced_tracking:
                selected_obj = self._select_object_at_position((x, y))
                if selected_obj:
                    self.selected_object_id = selected_obj['track_id']
                    print(f"🎯 Selected object {self.selected_object_id} ({selected_obj['class_name']}) for drawing")
                    return
                else:
                    print("❌ No object found at click position")
                    return
            
            # Check if in anchor mode for enhanced tracking
            if self.anchor_mode and self.use_enhanced_tracking:
                # Create 3D spatial anchor
                anchor_id = self._create_3d_anchor((x, y))
                if anchor_id:
                    print(f"🔗 Created 3D anchor: {anchor_id} at screen position ({x}, {y})")
                return
            
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
                    'points': self.current_line.copy(),
                    'color': self.drawing_color,
                    'thickness': self.drawing_thickness,
                    'is_3d_anchored': False,
                    'is_object_anchored': False,
                    'anchored_object_id': None
                }
                
                # Check if drawing should be anchored to selected object
                if self.selected_object_id is not None and self.use_enhanced_tracking:
                    line_data['is_object_anchored'] = True
                    line_data['anchored_object_id'] = self.selected_object_id
                    
                    # Convert screen coordinates to object-relative coordinates
                    object_relative_line = self._convert_to_object_relative_coords(
                        self.current_line, self.selected_object_id
                    )
                    line_data['object_relative_points'] = object_relative_line
                    
                    # Store in object-anchored drawings
                    if self.selected_object_id not in self.object_anchored_drawings:
                        self.object_anchored_drawings[self.selected_object_id] = []
                    self.object_anchored_drawings[self.selected_object_id].append(line_data)
                    
                    print(f"🎯 Created object-anchored line on object {self.selected_object_id}")
                    
                # If enhanced tracking is available and not object-anchored, try 3D anchored line
                elif self.use_enhanced_tracking and hasattr(self.ar_processor, 'create_manual_anchor'):
                    # Create anchor at start and end points
                    start_anchor = self._create_3d_anchor(self.current_line[0])
                    end_anchor = self._create_3d_anchor(self.current_line[-1])
                    
                    if start_anchor and end_anchor:
                        line_data['start_anchor'] = start_anchor
                        line_data['end_anchor'] = end_anchor
                        line_data['is_3d_anchored'] = True
                        print(f"🔗 Created 3D anchored line: {start_anchor} -> {end_anchor}")
                
                # Add to regular drawing lines if not object-anchored
                if not line_data['is_object_anchored']:
                    self.drawing_lines.append(line_data)
                
            self.current_line = []
            self.last_mouse_pos = None
    
    def _create_3d_anchor(self, screen_pos):
        """Create a 3D spatial anchor at screen position"""
        if not self.use_enhanced_tracking or not hasattr(self.ar_processor, 'create_manual_anchor'):
            return None
        
        try:
            anchor_id = self.ar_processor.create_manual_anchor(
                screen_pos, 
                object_type="drawing_anchor"
            )
            if anchor_id:
                self.spatial_anchors[anchor_id] = {
                    'screen_pos': screen_pos,
                    'created_time': time.time(),
                    'color': self.drawing_color
                }
            return anchor_id
        except Exception as e:
            print(f"Error creating 3D anchor: {e}")
            return None
    
    def cycle_drawing_color(self):
        """Cycle through available drawing colors"""
        self.current_color_index = (self.current_color_index + 1) % len(self.drawing_colors)
        self.drawing_color = self.drawing_colors[self.current_color_index]
    
    def clear_drawings(self):
        """Clear all drawings"""
        self.drawing_lines.clear()
        self.current_line.clear()
        self.drawing_points.clear()
        self.object_anchored_drawings.clear()  # Clear object-anchored drawings too
    
    def toggle_drawing_mode(self):
        """Toggle drawing mode on/off"""
        self.drawing_mode = not self.drawing_mode
        return self.drawing_mode
    
    def toggle_anchor_mode(self):
        """Toggle 3D anchor creation mode"""
        self.anchor_mode = not self.anchor_mode
        return self.anchor_mode
    
    def toggle_object_anchor_mode(self):
        """Toggle object-anchored drawing mode"""
        self.object_anchor_mode = not self.object_anchor_mode
        if not self.object_anchor_mode:
            self.selected_object_id = None  # Clear selection when disabling
        return self.object_anchor_mode
    
    def toggle_object_selection_mode(self):
        """Toggle object selection mode for highlighting"""
        self.object_selection_mode = not self.object_selection_mode
        if not self.object_selection_mode:
            self.selected_for_highlighting = None  # Clear selection when disabling
        return self.object_selection_mode
    
    def clear_object_selection(self):
        """Clear the currently selected object"""
        self.selected_for_highlighting = None
        print("🔘 Object selection cleared")
    
    def _select_object_at_position(self, screen_pos):
        """Select object at screen position for drawing anchoring"""
        # Get current AR results to find tracked objects
        if not hasattr(self, '_last_ar_results') or not self._last_ar_results:
            return None
        
        tracked_objects = self._last_ar_results.get('tracked_objects', [])
        x_click, y_click = screen_pos
        
        best_object = None
        min_distance = float('inf')
        
        for obj in tracked_objects:
            if hasattr(obj, 'bbox') and hasattr(obj, 'track_id'):
                bbox = obj.bbox
                # Calculate center of bounding box
                obj_center_x = (bbox[0] + bbox[2]) // 2
                obj_center_y = (bbox[1] + bbox[3]) // 2
                
                # Calculate distance from click to object center
                distance = np.sqrt((x_click - obj_center_x)**2 + (y_click - obj_center_y)**2)
                
                # Check if click is within bounding box and selection radius
                if (bbox[0] <= x_click <= bbox[2] and 
                    bbox[1] <= y_click <= bbox[3] and
                    distance < self.object_selection_radius and
                    distance < min_distance):
                    
                    min_distance = distance
                    best_object = {
                        'track_id': obj.track_id,
                        'class_name': getattr(obj, 'class_name', 'unknown'),
                        'bbox': bbox,
                        'center': (obj_center_x, obj_center_y)
                    }
        
        return best_object
    
    def _select_object_for_highlighting(self, screen_pos):
        """Select object at screen position for highlighting (not drawing)"""
        # Get current AR results to find tracked objects
        if not hasattr(self, '_last_ar_results') or not self._last_ar_results:
            return None
        
        tracked_objects = self._last_ar_results.get('tracked_objects', [])
        x_click, y_click = screen_pos
        
        best_object = None
        min_distance = float('inf')
        
        for obj in tracked_objects:
            if hasattr(obj, 'bbox') and hasattr(obj, 'track_id'):
                bbox = obj.bbox
                # Calculate center of bounding box
                obj_center_x = (bbox[0] + bbox[2]) // 2
                obj_center_y = (bbox[1] + bbox[3]) // 2
                
                # Calculate distance from click to object center
                distance = np.sqrt((x_click - obj_center_x)**2 + (y_click - obj_center_y)**2)
                
                # Check if click is within bounding box and selection radius
                if (bbox[0] <= x_click <= bbox[2] and 
                    bbox[1] <= y_click <= bbox[3] and
                    distance < self.object_selection_radius and
                    distance < min_distance):
                    
                    min_distance = distance
                    best_object = {
                        'track_id': obj.track_id,
                        'class_name': getattr(obj, 'class_name', 'unknown'),
                        'bbox': bbox,
                        'center': (obj_center_x, obj_center_y)
                    }
        
        return best_object
    
    def _convert_to_object_relative_coords(self, screen_points, object_id):
        """Convert screen coordinates to object-relative coordinates"""
        if not hasattr(self, '_last_ar_results') or not self._last_ar_results:
            return screen_points
        
        tracked_objects = self._last_ar_results.get('tracked_objects', [])
        
        # Find the target object
        target_object = None
        for obj in tracked_objects:
            if hasattr(obj, 'track_id') and obj.track_id == object_id:
                target_object = obj
                break
        
        if not target_object or not hasattr(target_object, 'bbox'):
            return screen_points
        
        bbox = target_object.bbox
        obj_center_x = (bbox[0] + bbox[2]) // 2
        obj_center_y = (bbox[1] + bbox[3]) // 2
        obj_width = bbox[2] - bbox[0]
        obj_height = bbox[3] - bbox[1]
        
        # Convert to relative coordinates (normalized to object bounding box)
        relative_points = []
        for x, y in screen_points:
            # Normalize to [-1, 1] relative to object center and size
            rel_x = (x - obj_center_x) / (obj_width / 2) if obj_width > 0 else 0
            rel_y = (y - obj_center_y) / (obj_height / 2) if obj_height > 0 else 0
            relative_points.append((rel_x, rel_y))
        
        return relative_points
    
    def _convert_from_object_relative_coords(self, relative_points, current_bbox):
        """Convert object-relative coordinates back to screen coordinates"""
        obj_center_x = (current_bbox[0] + current_bbox[2]) // 2
        obj_center_y = (current_bbox[1] + current_bbox[3]) // 2
        obj_width = current_bbox[2] - current_bbox[0]
        obj_height = current_bbox[3] - current_bbox[1]
        
        # Convert back to screen coordinates
        screen_points = []
        for rel_x, rel_y in relative_points:
            screen_x = int(obj_center_x + rel_x * (obj_width / 2))
            screen_y = int(obj_center_y + rel_y * (obj_height / 2))
            screen_points.append((screen_x, screen_y))
        
        return screen_points
    
    def adjust_thickness(self, delta):
        """Adjust drawing thickness"""
        self.drawing_thickness = max(1, min(10, self.drawing_thickness + delta))
    
    def _clear_selected_object(self):
        """Clear selected object for drawing"""
        if self.selected_object_id is not None:
            print(f"❌ Cleared selected object {self.selected_object_id}")
            self.selected_object_id = None
        else:
            print("ℹ️  No object was selected")
    
    def draw_overlay(self, frame, ar_results=None):
        """Draw the interactive overlay on the frame"""
        overlay_frame = frame.copy()
        
        # Store AR results for object selection
        self._last_ar_results = ar_results
        
        # Draw tracked objects if enhanced tracking is available
        if ar_results and self.use_enhanced_tracking:
            self._draw_tracked_objects(overlay_frame, ar_results)
            self._draw_3d_anchors(overlay_frame, ar_results)
            self._draw_object_anchored_drawings(overlay_frame, ar_results)
        
        # Draw completed lines (non-object-anchored)
        for line_data in self.drawing_lines:
            points = line_data['points']
            color = line_data['color']
            thickness = line_data['thickness']
            is_3d = line_data.get('is_3d_anchored', False)
            is_object_anchored = line_data.get('is_object_anchored', False)
            
            # Skip object-anchored lines (they are drawn separately)
            if is_object_anchored:
                continue
            
            # Draw line with special styling for 3D anchored lines
            for i in range(1, len(points)):
                if is_3d:
                    # Draw 3D anchored lines with dashed style
                    self._draw_dashed_line(overlay_frame, points[i-1], points[i], color, thickness)
                else:
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
        
        # Draw mode indicators
        if self.anchor_mode:
            cv2.circle(overlay_frame, (50, 50), 15, (0, 255, 255), -1)
            cv2.putText(overlay_frame, 'ANCHOR', (70, 55), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        
        if self.object_anchor_mode:
            cv2.circle(overlay_frame, (50, 80), 15, (255, 165, 0), -1)
            cv2.putText(overlay_frame, 'OBJECT', (70, 85), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 165, 0), 1)
        
        if self.object_selection_mode:
            cv2.circle(overlay_frame, (50, 110), 15, (0, 165, 255), -1)
            cv2.putText(overlay_frame, 'SELECT', (70, 115), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 1)
        
        return overlay_frame
    
    def _draw_tracked_objects(self, frame, ar_results):
        """Draw detected and tracked objects"""
        tracked_objects = ar_results.get('tracked_objects', [])
        
        for obj in tracked_objects:
            if hasattr(obj, 'bbox') and hasattr(obj, 'class_name'):
                bbox = obj.bbox
                class_name = obj.class_name
                confidence = getattr(obj, 'confidence', 0.0)
                track_id = getattr(obj, 'track_id', -1)
                
                # Enhanced highlighting for different selection types
                is_selected_for_drawing = (track_id == self.selected_object_id)
                is_selected_for_highlighting = (track_id == self.selected_for_highlighting)
                
                # Determine color and styling based on selection type
                if is_selected_for_highlighting:
                    # Bright orange/yellow for highlighted selection
                    color = (0, 165, 255)  # Orange
                    thickness = 4
                    label_prefix = "🔍 "
                elif is_selected_for_drawing:
                    # Cyan for drawing anchor selection
                    color = (255, 255, 0)  # Cyan
                    thickness = 3
                    label_prefix = "🎯 "
                else:
                    # Default colors based on confidence
                    color = (0, 255, 0) if confidence > 0.7 else (0, 200, 200)
                    thickness = 2
                    label_prefix = ""
                
                # Draw bounding box
                cv2.rectangle(frame, (bbox[0], bbox[1]), (bbox[2], bbox[3]), color, thickness)
                
                # Draw enhanced corners for selected objects
                if is_selected_for_highlighting or is_selected_for_drawing:
                    corner_length = 20
                    corner_thickness = 3
                    # Top-left corner
                    cv2.line(frame, (bbox[0], bbox[1]), (bbox[0] + corner_length, bbox[1]), color, corner_thickness)
                    cv2.line(frame, (bbox[0], bbox[1]), (bbox[0], bbox[1] + corner_length), color, corner_thickness)
                    # Top-right corner
                    cv2.line(frame, (bbox[2], bbox[1]), (bbox[2] - corner_length, bbox[1]), color, corner_thickness)
                    cv2.line(frame, (bbox[2], bbox[1]), (bbox[2], bbox[1] + corner_length), color, corner_thickness)
                    # Bottom-left corner
                    cv2.line(frame, (bbox[0], bbox[3]), (bbox[0] + corner_length, bbox[3]), color, corner_thickness)
                    cv2.line(frame, (bbox[0], bbox[3]), (bbox[0], bbox[3] - corner_length), color, corner_thickness)
                    # Bottom-right corner
                    cv2.line(frame, (bbox[2], bbox[3]), (bbox[2] - corner_length, bbox[3]), color, corner_thickness)
                    cv2.line(frame, (bbox[2], bbox[3]), (bbox[2], bbox[3] - corner_length), color, corner_thickness)
                
                # Draw label with enhanced formatting for selected objects
                label = f"{label_prefix}{class_name}({track_id}): {confidence:.2f}"
                label_bg_color = color if (is_selected_for_highlighting or is_selected_for_drawing) else None
                
                # Draw label background for selected objects
                if label_bg_color:
                    label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
                    cv2.rectangle(frame, 
                                (bbox[0] - 2, bbox[1] - label_size[1] - 15), 
                                (bbox[0] + label_size[0] + 4, bbox[1] - 5), 
                                label_bg_color, -1)
                    text_color = (0, 0, 0)  # Black text on colored background
                    font_scale = 0.6
                    font_thickness = 2
                else:
                    text_color = color
                    font_scale = 0.5
                    font_thickness = 1
                
                cv2.putText(frame, label, (bbox[0], bbox[1] - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, font_scale, text_color, font_thickness)
    
    def _draw_object_anchored_drawings(self, frame, ar_results):
        """Draw object-anchored drawings that follow tracked objects"""
        if not ar_results or not self.object_anchored_drawings:
            return
        
        tracked_objects = ar_results.get('tracked_objects', [])
        
        # Create a mapping of track_id to current bbox
        object_bboxes = {}
        for obj in tracked_objects:
            if hasattr(obj, 'bbox') and hasattr(obj, 'track_id'):
                object_bboxes[obj.track_id] = obj.bbox
        
        # Draw all object-anchored drawings
        for object_id, drawings in self.object_anchored_drawings.items():
            # Check if the object is still being tracked
            if object_id not in object_bboxes:
                continue  # Object lost, skip drawings
            
            current_bbox = object_bboxes[object_id]
            
            # Draw each line anchored to this object
            for line_data in drawings:
                if 'object_relative_points' not in line_data:
                    continue
                
                # Convert relative coordinates back to current screen coordinates
                current_points = self._convert_from_object_relative_coords(
                    line_data['object_relative_points'], 
                    current_bbox
                )
                
                # Draw the line with object-anchored styling
                color = line_data['color']
                thickness = line_data['thickness']
                
                for i in range(1, len(current_points)):
                    # Use dotted line style for object-anchored drawings
                    self._draw_dotted_line(frame, current_points[i-1], current_points[i], 
                                         color, thickness)
                
                # Add small indicators at line endpoints
                if len(current_points) >= 2:
                    start_pt = current_points[0]
                    end_pt = current_points[-1]
                    cv2.circle(frame, start_pt, 3, color, -1)
                    cv2.circle(frame, end_pt, 3, color, -1)
    
    def _draw_3d_anchors(self, frame, ar_results):
        """Draw 3D spatial anchors projected to screen"""
        anchor_positions = ar_results.get('anchor_positions', {})
        
        for anchor_id, anchor_data in anchor_positions.items():
            screen_pos = anchor_data.get('screen_pos')
            confidence = anchor_data.get('confidence', 1.0)
            object_type = anchor_data.get('object_type', 'unknown')
            
            if screen_pos:
                x, y = int(screen_pos[0]), int(screen_pos[1])
                
                # Draw anchor marker
                anchor_color = (0, 255, 255) if confidence > 0.7 else (0, 200, 200)
                cv2.drawMarker(frame, (x, y), anchor_color, cv2.MARKER_STAR, 15, 2)
                
                # Draw anchor ID
                cv2.putText(frame, f"A:{anchor_id[-3:]}", (x + 10, y - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, anchor_color, 1)
    
    def _draw_dashed_line(self, frame, pt1, pt2, color, thickness):
        """Draw a dashed line for 3D anchored drawings"""
        # Simple dashed line implementation
        distance = int(np.sqrt((pt2[0] - pt1[0])**2 + (pt2[1] - pt1[1])**2))
        dash_length = 10
        
        if distance > 0:
            dx = (pt2[0] - pt1[0]) / distance
            dy = (pt2[1] - pt1[1]) / distance
            
            for i in range(0, distance, dash_length * 2):
                start_pt = (int(pt1[0] + i * dx), int(pt1[1] + i * dy))
                end_pt = (int(pt1[0] + min(i + dash_length, distance) * dx),
                         int(pt1[1] + min(i + dash_length, distance) * dy))
                cv2.line(frame, start_pt, end_pt, color, thickness)
    
    def _draw_dotted_line(self, frame, pt1, pt2, color, thickness):
        """Draw a dotted line for object-anchored drawings"""
        # Smaller dots for object-anchored lines
        distance = int(np.sqrt((pt2[0] - pt1[0])**2 + (pt2[1] - pt1[1])**2))
        dot_spacing = 5
        
        if distance > 0:
            dx = (pt2[0] - pt1[0]) / distance
            dy = (pt2[1] - pt1[1]) / distance
            
            for i in range(0, distance, dot_spacing):
                dot_pt = (int(pt1[0] + i * dx), int(pt1[1] + i * dy))
                cv2.circle(frame, dot_pt, thickness // 2 + 1, color, -1)
    
    def update_fps(self):
        """Update FPS counter"""
        self.fps_counter += 1
        current_time = time.time()
        
        if current_time - self.fps_start_time >= 1.0:
            self.current_fps = self.fps_counter / (current_time - self.fps_start_time)
            self.fps_counter = 0
            self.fps_start_time = current_time
    
    def display_results(self, results, left_frame, right_frame):
        """Display AR results and camera frames with enhanced tracking overlay"""
        # Apply drawing overlay with AR results
        display_frame = self.draw_overlay(left_frame, results)
        
        # Add FPS counter
        cv2.putText(display_frame, f'FPS: {self.current_fps:.1f}', 
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        # Add tracking quality (use enhanced if available)
        tracking_quality = results.get('enhanced_tracking_quality', results.get('tracking_quality', 0.0))
        quality_color = (0, 255, 0) if tracking_quality > 0.8 else (0, 165, 255) if tracking_quality > 0.6 else (0, 0, 255)
        cv2.putText(display_frame, f'Quality: {tracking_quality:.2f}', 
                   (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1, quality_color, 2)
        
        # Add pose information
        if results['pose_6dof'] and 'pose' in results['pose_6dof']:
            pose = results['pose_6dof']['pose']
            pos_text = f'Pos: [{pose.position[0]:.2f}, {pose.position[1]:.2f}, {pose.position[2]:.2f}]'
            cv2.putText(display_frame, pos_text, 
                       (10, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        
        # Enhanced tracking info
        if self.use_enhanced_tracking:
            tracked_objects = results.get('tracked_objects', [])
            spatial_anchors = results.get('spatial_anchors', [])
            
            cv2.putText(display_frame, f'Objects: {len(tracked_objects)} | Anchors: {len(spatial_anchors)}', 
                       (10, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        else:
            # Add detected planes count for basic system
            planes_count = len(results.get('detected_planes', []))
            cv2.putText(display_frame, f'Planes: {planes_count}', 
                       (10, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)
        
        # Drawing mode indicator
        mode_text = "DRAWING ON" if self.drawing_mode else "DRAWING OFF"
        mode_color = (0, 255, 0) if self.drawing_mode else (0, 0, 255)
        cv2.putText(display_frame, mode_text, 
                   (10, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.7, mode_color, 2)
        
        # Anchor mode indicators (if enhanced tracking)
        if self.use_enhanced_tracking:
            # 3D anchor mode
            anchor_text = "3D ANCHOR ON" if self.anchor_mode else "3D ANCHOR OFF"
            anchor_color = (0, 255, 255) if self.anchor_mode else (128, 128, 128)
            cv2.putText(display_frame, anchor_text, 
                       (250, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.6, anchor_color, 1)
            
            # Object anchor mode
            obj_anchor_text = "OBJ ANCHOR ON" if self.object_anchor_mode else "OBJ ANCHOR OFF"
            obj_anchor_color = (255, 165, 0) if self.object_anchor_mode else (128, 128, 128)
            cv2.putText(display_frame, obj_anchor_text, 
                       (250, 190), cv2.FONT_HERSHEY_SIMPLEX, 0.6, obj_anchor_color, 1)
            
            # Object selection mode
            selection_text = "SELECT MODE ON" if self.object_selection_mode else "SELECT MODE OFF"
            selection_color = (0, 165, 255) if self.object_selection_mode else (128, 128, 128)
            cv2.putText(display_frame, selection_text, 
                       (250, 210), cv2.FONT_HERSHEY_SIMPLEX, 0.6, selection_color, 1)
            
            # Show selected object info (for drawing)
            if self.selected_object_id is not None:
                cv2.putText(display_frame, f"Draw Target: Obj {self.selected_object_id}", 
                           (10, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 165, 0), 2)
            
            # Show highlighted object info (for selection)
            if self.selected_for_highlighting is not None:
                cv2.putText(display_frame, f"🔍 Highlighted: Obj {self.selected_for_highlighting}", 
                           (10, 320), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
        
        # Drawing color indicator
        if self.drawing_mode:
            color_names = ['GREEN', 'BLUE', 'RED', 'CYAN', 'MAGENTA', 'YELLOW', 'WHITE']
            current_color_name = color_names[self.current_color_index]
            cv2.putText(display_frame, f'Color: {current_color_name} (T:{self.drawing_thickness})', 
                       (10, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.6, self.drawing_color, 2)
            
            # Draw color swatch
            cv2.rectangle(display_frame, (200, 180), (240, 210), self.drawing_color, -1)
            cv2.rectangle(display_frame, (200, 180), (240, 210), (255, 255, 255), 1)
        
        # Drawing statistics
        total_lines = len(self.drawing_lines)
        anchored_lines = sum(1 for line in self.drawing_lines if line.get('is_3d_anchored', False))
        object_anchored_lines = sum(len(drawings) for drawings in self.object_anchored_drawings.values())
        
        if total_lines > 0 or object_anchored_lines > 0:
            cv2.putText(display_frame, f'Lines: {total_lines} (3D: {anchored_lines}, Obj: {object_anchored_lines})', 
                       (10, 230), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        
        # System status
        system_status = results.get('system_status', {})
        if system_status.get('medical_tracking_enabled', False):
            cv2.putText(display_frame, 'ENHANCED MEDICAL TRACKING', 
                       (10, 260), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        
        # Medical precision indicator
        precision_y = display_frame.shape[0] - 20
        if tracking_quality > 0.8:
            cv2.putText(display_frame, 'MEDICAL PRECISION: OK', 
                       (10, precision_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        elif tracking_quality > 0.6:
            cv2.putText(display_frame, 'MEDICAL PRECISION: CAUTION', 
                       (10, precision_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
        else:
            cv2.putText(display_frame, 'MEDICAL PRECISION: INSUFFICIENT', 
                       (10, precision_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        
        # Show frames
        cv2.imshow('Medical AR - Enhanced Interactive Camera', display_frame)
        cv2.imshow('Medical AR - Right Camera', right_frame)
        
        # Set mouse callback for the main display window
        cv2.setMouseCallback('Medical AR - Enhanced Interactive Camera', self.mouse_callback)
    
    def run(self):
        """Main processing loop with multi-threading support"""
        print("🔬 Starting Medical AR Camera System")
        print("=" * 50)
        
        if not self.initialize_cameras():
            return False
        
        if not self.initialize_ar_system():
            self.cleanup()
            return False
        
        if self.use_threading:
            return self._run_threaded_mode()
        else:
            return self._run_legacy_mode()
    
    def _run_threaded_mode(self):
        """Run the system in multi-threaded mode"""
        print("\n📡 Multi-threaded Medical AR System is running!")
        print("🕐️ Performance optimizations: ACTIVE")
        print("   - Threaded camera capture")
        print("   - Background AR processing")
        print("   - Adaptive quality control")
        
        if self.ar_processor_worker and self.ar_processor_worker.ar_available:
            print("🔬 Enhanced Medical Tracking: ENABLED")
            print("   - Medical object detection active")
            print("   - 3D spatial anchoring available")
        else:
            print("⚠️  Enhanced Medical Tracking: DISABLED (using basic system)")
        
        print("\nControls:")
        print("  - Left click and drag to draw on the camera feed")
        print("  - Press 'q' to quit")
        print("  - Press 's' to save current session")
        print("  - Press ESC or 'p' to pause/resume")
        print("  - Press 'd' to toggle drawing mode on/off")
        print("  - Press 'c' to cycle drawing colors")
        print("  - Press 'x' to clear all drawings")
        print("  - Press '+/-' to increase/decrease line thickness")
        if self.ar_processor_worker and self.ar_processor_worker.ar_available:
            print("  - Press 'a' to toggle 3D anchor mode (for spatial anchoring)")
            print("  - Press 'o' to toggle object anchor mode (drawings follow objects)")
            print("  - Press 'v' to toggle object selection mode (highlight objects)")
            print("  - Press 'z' to clear highlighted object")
            print("  - Press 'r' to clear selected object (for drawing)")
            print("  - Press 't' to show tracking statistics")
        print("\nProcessing frames with multi-threading...")
        
        try:
            # Monitor performance and system health
            last_stats_time = time.time()
            frame_count = 0
            
            while not self.coordinator.is_shutdown_requested():
                # Render frame on main thread (required for macOS)
                key_result = self.display_renderer.render_frame()
                
                # Handle quit command
                if key_result == 'quit':
                    break
                
                # Check thread health
                thread_health = self.coordinator.get_thread_health()
                
                # Check for errors
                errors = self.coordinator.get_errors()
                for thread_name, error, timestamp in errors:
                    logging.error(f"Thread {thread_name} error: {error}")
                
                # Print performance statistics periodically
                current_time = time.time()
                if current_time - last_stats_time >= 5.0:  # Every 5 seconds
                    self._print_performance_stats()
                    last_stats_time = current_time
                
                frame_count += 1
                
                # Small sleep to prevent excessive CPU usage
                time.sleep(0.001)  # 1ms sleep
        
        except KeyboardInterrupt:
            print("\n⏹️  Interrupted by user")
        
        except Exception as e:
            logging.error(f"Threaded mode error: {e}")
        
        finally:
            self.cleanup()
            print("👋 Multi-threaded camera AR system stopped")
            return True
    
    def _print_performance_stats(self):
        """Print current performance statistics"""
        if not self.performance_monitor:
            return
        
        stats = self.performance_monitor.get_stats()
        
        # Extract key metrics
        capture_fps = stats.get('capture_fps', {}).get('current', 0)
        processing_fps = stats.get('processing_fps', {}).get('current', 0)
        display_fps = stats.get('display_fps', {}).get('current', 0)
        
        capture_stats = self.camera_capture.get_stats()
        processing_stats = self.ar_processor_worker.get_stats() if self.ar_processor_worker else {}
        
        print(f"\n📈 Performance: Capture={capture_fps:.1f} FPS, Processing={processing_fps:.1f} FPS, Display={display_fps:.1f} FPS")
        print(f"   Buffer: {capture_stats.get('current_size', 0)}/{capture_stats.get('max_size', 0)}, "
              f"Dropped: {capture_stats.get('dropped_frames', 0)}, "
              f"Processed: {processing_stats.get('frames_processed', 0)}")
    
    def _run_legacy_mode(self):
        """Run the system in legacy single-threaded mode"""
        
        print("\n📹 Legacy Medical AR Interactive System is running!")
        if self.use_enhanced_tracking:
            print("🔬 Enhanced Medical Tracking: ENABLED (single-threaded)")
            print("   - Medical object detection active")
            print("   - 3D spatial anchoring available")
        else:
            print("⚠️  Enhanced Medical Tracking: DISABLED (using basic system)")
            
        print("\nControls:")
        print("  - Left click and drag to draw on the camera feed")
        print("  - Press 'q' to quit")
        print("  - Press 's' to save current session")
        print("  - Press SPACE to pause/resume")
        print("  - Press 'd' to toggle drawing mode on/off")
        print("  - Press 'c' to cycle drawing colors")
        print("  - Press 'x' to clear all drawings")
        print("  - Press '+/-' to increase/decrease line thickness")
        if self.use_enhanced_tracking:
            print("  - Press 'a' to toggle 3D anchor mode (for spatial anchoring)")
            print("  - Press 'o' to toggle object anchor mode (drawings follow objects)")
            print("  - Press 'v' to toggle object selection mode (highlight objects)")
            print("  - Press 'z' to clear highlighted object")
            print("  - Press 'r' to clear selected object (for drawing)")
            print("  - Press 't' to show tracking statistics")
        print("\nProcessing frames (single-threaded mode)...")
        
        paused = False
        frame_count = 0
        
        try:
            while True:
                if not paused:
                    # Get camera frames
                    left_frame, right_frame = self.get_camera_frames()
                    
                    if left_frame is None or right_frame is None:
                        print("❌ Failed to capture frames")
                        break
                    
                    # Get IMU data
                    imu_data = self.simulate_imu_data()
                    
                    # Process with AR system
                    timestamp = time.time()
                    results = self.ar_processor.process_camera_footage(
                        left_frame, right_frame, imu_data, timestamp
                    )
                    
                    # Update FPS
                    self.update_fps()
                    
                    # Display results
                    self.display_results(results, left_frame, right_frame)
                    
                    frame_count += 1
                    
                    # Print periodic updates
                    if frame_count % 30 == 0:
                        quality = results['tracking_quality']
                        planes = len(results.get('detected_planes', []))
                        print(f"Frame {frame_count}: Quality={quality:.2f}, Planes={planes}, FPS={self.current_fps:.1f}")
                
                # Handle keyboard input
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q'):
                    print("\n⏹️  Stopping camera AR system...")
                    break
                elif key == ord('s'):
                    self.save_session()
                elif key == ord(' '):
                    paused = not paused
                    status = "PAUSED" if paused else "RESUMED"
                    print(f"\n⏸️  {status}")
                elif key == ord('d'):
                    drawing_status = "ON" if self.toggle_drawing_mode() else "OFF"
                    print(f"🎨 Drawing mode: {drawing_status}")
                elif key == ord('c'):
                    self.cycle_drawing_color()
                    color_names = ['GREEN', 'BLUE', 'RED', 'CYAN', 'MAGENTA', 'YELLOW', 'WHITE']
                    print(f"🎨 Drawing color: {color_names[self.current_color_index]}")
                elif key == ord('x'):
                    self.clear_drawings()
                    print("🗑️  All drawings cleared")
                elif key == ord('+') or key == ord('='):
                    self.adjust_thickness(1)
                    print(f"📏 Line thickness: {self.drawing_thickness}")
                elif key == ord('-') or key == ord('_'):
                    self.adjust_thickness(-1)
                    print(f"📏 Line thickness: {self.drawing_thickness}")
                elif key == ord('a') and self.use_enhanced_tracking:
                    anchor_status = "ON" if self.toggle_anchor_mode() else "OFF"
                    print(f"🔗 3D Anchor mode: {anchor_status}")
                elif key == ord('o') and self.use_enhanced_tracking:
                    obj_anchor_status = "ON" if self.toggle_object_anchor_mode() else "OFF"
                    print(f"🎯 Object Anchor mode: {obj_anchor_status}")
                    if obj_anchor_status == "ON":
                        print("   Click on an object to select it for drawing")
                elif key == ord('r') and self.use_enhanced_tracking:
                    if self.selected_object_id is not None:
                        print(f"❌ Cleared selected object {self.selected_object_id}")
                        self.selected_object_id = None
                    else:
                        print("ℹ️  No object was selected")
                elif key == ord('t') and self.use_enhanced_tracking:
                    self._show_tracking_statistics()
                elif key == ord('v') and self.use_enhanced_tracking:
                    selection_status = "ON" if self.toggle_object_selection_mode() else "OFF"
                    print(f"🔍 Object Selection mode: {selection_status}")
                    if selection_status == "ON":
                        print("   Click on an object to select it for highlighting")
                elif key == ord('z') and self.use_enhanced_tracking:
                    self.clear_object_selection()
        
        except KeyboardInterrupt:
            print("\n⏹️  Interrupted by user")
        
        except Exception as e:
            print(f"\n❌ Error during processing: {e}")
        
        finally:
            self.cleanup()
            print("👋 Camera AR system stopped")
            return True
    
    def save_session(self):
        """Save current AR session"""
        try:
            session_path = f"camera_ar_session_{int(time.time())}.pkl"
            
            if self.use_threading and self.ar_processor_worker:
                # Multi-threaded mode - get AR processor from worker
                ar_processor = self.ar_processor_worker.ar_processor
                if ar_processor and hasattr(ar_processor, 'save_session'):
                    if ar_processor.save_session(session_path):
                        print(f"✅ Session saved to {session_path}")
                    else:
                        print("❌ Failed to save session")
                else:
                    print("❌ Session saving not available in current mode")
            elif self.ar_processor and hasattr(self.ar_processor, 'save_session'):
                # Legacy mode
                if self.ar_processor.save_session(session_path):
                    print(f"✅ Session saved to {session_path}")
                else:
                    print("❌ Failed to save session")
            else:
                print("❌ Session saving not available")
                
        except Exception as e:
            print(f"❌ Error saving session: {e}")
    
    def _show_tracking_statistics(self):
        """Display detailed tracking statistics"""
        ar_processor = None
        
        if self.use_threading and self.ar_processor_worker:
            ar_processor = self.ar_processor_worker.ar_processor
        elif not self.use_threading and self.ar_processor:
            ar_processor = self.ar_processor
        
        if not ar_processor or not hasattr(ar_processor, 'get_tracking_statistics'):
            print("❌ Enhanced tracking statistics not available")
            return
        
        try:
            stats = ar_processor.get_tracking_statistics()
            mode_text = "MULTI-THREADED" if self.use_threading else "SINGLE-THREADED"
            print("\n" + "=" * 60)
            print(f"📊 {mode_text} MEDICAL AR TRACKING STATISTICS")
            print("=" * 60)
            
            # Add threading-specific stats
            if self.use_threading:
                perf_stats = self.performance_monitor.get_stats() if self.performance_monitor else {}
                capture_stats = self.camera_capture.get_stats() if self.camera_capture else {}
                processing_stats = self.ar_processor_worker.get_stats() if self.ar_processor_worker else {}
                
                print("\nThreading Performance:")
                capture_fps = perf_stats.get('capture_fps', {}).get('current', 0)
                processing_fps = perf_stats.get('processing_fps', {}).get('current', 0)
                display_fps = perf_stats.get('display_fps', {}).get('current', 0)
                print(f"  Capture FPS: {capture_fps:.1f}")
                print(f"  Processing FPS: {processing_fps:.1f}")
                print(f"  Display FPS: {display_fps:.1f}")
                print(f"  Buffer Utilization: {capture_stats.get('utilization', 0)*100:.1f}%")
                print(f"  Frames Dropped: {capture_stats.get('dropped_frames', 0)}")
                print(f"  Frames Skipped: {processing_stats.get('frames_skipped', 0)}")
            
            print(f"Total Trackers: {stats.get('total_trackers', 0)}")
            print(f"Active Trackers: {stats.get('active_trackers', 0)}")
            print(f"Spatial Anchors: {stats.get('total_anchors', 0)}")
            print(f"Tracking Quality: {stats.get('tracking_quality', 0.0):.2f}")
            print(f"Processing Time: {stats.get('average_processing_time', 0.0):.3f}s")
            print(f"Frames Processed: {stats.get('frames_processed', 0)}")
            
            capabilities = stats.get('system_capabilities', {})
            print(f"\nSystem Capabilities:")
            print(f"  OpenCV Available: {capabilities.get('opencv_available', False)}")
            print(f"  SciPy Available: {capabilities.get('scipy_available', False)}")
            print(f"  Medical Mode: {capabilities.get('medical_mode', False)}")
            
            print(f"\nDrawing Statistics:")
            total_lines = len(self.drawing_lines)
            anchored_lines = sum(1 for line in self.drawing_lines if line.get('is_3d_anchored', False))
            print(f"  Total Lines: {total_lines}")
            print(f"  3D Anchored Lines: {anchored_lines}")
            print(f"  Manual Anchors: {len(self.spatial_anchors)}")
            
            print("=" * 60)
            
        except Exception as e:
            print(f"❌ Error retrieving tracking statistics: {e}")
    
    def cleanup(self):
        """Clean up resources"""
        # Stop multi-threaded components first
        if self.use_threading:
            print("🔄 Stopping multi-threaded components...")
            
            if self.display_renderer:
                self.display_renderer.stop_display()
            
            if self.ar_processor_worker:
                self.ar_processor_worker.stop_processing()
            
            if self.camera_capture:
                self.camera_capture.stop_capture()
            
            if self.coordinator:
                self.coordinator.signal_shutdown()
        
        # Clean up legacy components
        if self.left_camera:
            self.left_camera.release()
        if self.right_camera:
            self.right_camera.release()
        if self.single_camera:
            self.single_camera.release()
        
        cv2.destroyAllWindows()
        print("✅ Cleanup completed")


def main():
    """Main function"""
    print("🔬 Medical AR - Multi-threaded Interactive Camera Integration")
    print("=" * 60)
    
    # Threading mode selection
    print("Performance mode options:")
    print("1. Multi-threaded (optimized for high frame rates)")
    print("2. Single-threaded (legacy mode)")
    
    try:
        threading_choice = input("\nSelect performance mode (1-2) [default: 1]: ").strip()
        use_threading = threading_choice != '2'
        
        if use_threading:
            print("✅ Multi-threaded mode selected")
            # Get target FPS for optimization
            fps_input = input("Target FPS (15-60) [default: 30]: ").strip()
            target_fps = int(fps_input) if fps_input.isdigit() and 15 <= int(fps_input) <= 60 else 30
        else:
            print("⚠️  Single-threaded legacy mode selected")
            target_fps = 30
        
        print(f"Target FPS: {target_fps}")
    
    except (ValueError, KeyboardInterrupt):
        print("\nUsing default settings: multi-threaded, 30 FPS")
        use_threading = True
        target_fps = 30
    
    # Camera configuration options
    print("\nCamera configuration options:")
    print("1. Single camera (side-by-side stereo)")
    print("2. Dual cameras (separate left/right)")
    print("3. Auto-detect")
    
    try:
        choice = input("\nSelect option (1-3) [default: 1]: ").strip()
        if not choice:
            choice = '1'
        
        if choice == '2':
            camera_mode = 'stereo'
            left_id = int(input("Left camera ID [0]: ") or "0")
            right_id = int(input("Right camera ID [1]: ") or "1")
            camera_system = CameraARSystem('stereo', left_id, right_id, use_threading, target_fps)
        elif choice == '3':
            # Auto-detect available cameras
            print("Detecting available cameras...")
            available_cameras = []
            print("AVAILABLE_CAMERAS:" ,available_cameras)
            for i in range(4):  # Check first 4 camera indices
                cap = cv2.VideoCapture(i)
                if cap.isOpened():
                    available_cameras.append(i)
                    cap.release()
            
            print(f"Available cameras: {available_cameras}")
            if len(available_cameras) >= 2:
                camera_mode = 'stereo'
                camera_system = CameraARSystem('stereo', available_cameras[0], available_cameras[1], use_threading, target_fps)
                print(f"Using stereo mode with cameras {available_cameras[0]} and {available_cameras[1]}")
            elif len(available_cameras) >= 1:
                camera_mode = 'single'
                camera_system = CameraARSystem('single', available_cameras[0], 0, use_threading, target_fps)
                print(f"Using single camera mode with camera {available_cameras[0]}")
            else:
                print("❌ No cameras detected")
                return
        else:  # Default: single camera
            camera_mode = 'single'
            camera_id = int(input("Camera ID [0]: ") or "0")
            camera_system = CameraARSystem('single', camera_id, 0, use_threading, target_fps)
        
        threading_mode = "multi-threaded" if use_threading else "single-threaded"
        print(f"\n🚀 Starting {threading_mode} {camera_mode} camera AR system (FPS: {target_fps})...")
        camera_system.run()
        
    except KeyboardInterrupt:
        print("\n⏹️  Setup interrupted by user")
    except ValueError:
        print("❌ Invalid input. Please enter a number.")
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()