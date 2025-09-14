#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Medical AR Tracking System

Enhanced AR tracking specifically designed for medical/surgical applications.
Provides robust 6DoF tracking, object detection, and spatial anchoring.
"""

import numpy as np
import time
import threading
from collections import deque, defaultdict
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
import pickle
import json

# Handle optional dependencies
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("Warning: OpenCV not available. Some tracking features will be limited.")

try:
    from scipy.spatial.distance import cdist
    from scipy.optimize import linear_sum_assignment
    from scipy.spatial.transform import Rotation as R
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    print("Warning: SciPy not available. Using simplified tracking algorithms.")

from .data_structures import Pose6DoF, SpatialAnchor, PlaneInfo


@dataclass
class Detection3D:
    """3D object detection result"""
    position: np.ndarray        # 3D world position [x, y, z]
    bbox_left: Tuple[int, int, int, int]  # Left image bounding box (x1, y1, x2, y2)
    bbox_right: Optional[Tuple[int, int, int, int]] = None  # Right image bounding box
    class_id: int = 0          # Object class identifier
    class_name: str = "unknown"  # Object class name
    confidence: float = 0.0    # Detection confidence [0-1]
    depth: float = 0.0         # Distance from camera
    timestamp: float = 0.0     # Detection timestamp


@dataclass
class TrackingResult:
    """Result from object tracking"""
    track_id: int              # Unique tracker ID
    position: np.ndarray       # Current 3D position
    velocity: np.ndarray       # Current 3D velocity
    bbox: Tuple[int, int, int, int]  # Current bounding box
    class_name: str            # Object class
    confidence: float          # Tracking confidence
    age: int                   # Frames since creation
    hits: int                  # Number of successful updates
    time_since_update: int     # Frames since last update


class ExtendedKalmanFilter:
    """Simplified Extended Kalman Filter for 3D object tracking"""
    
    def __init__(self, dim_x=6, dim_z=3):
        """
        Initialize Kalman filter
        State: [x, y, z, vx, vy, vz] - position and velocity
        Measurement: [x, y, z] - position only
        """
        self.dim_x = dim_x
        self.dim_z = dim_z
        
        # State vector [x, y, z, vx, vy, vz]
        self.x = np.zeros(dim_x)
        
        # State covariance matrix
        self.P = np.eye(dim_x) * 1000.0
        
        # State transition matrix (constant velocity model)
        self.F = np.eye(dim_x)
        # Position updates with velocity: x(k+1) = x(k) + vx(k) * dt
        self.F[0, 3] = self.F[1, 4] = self.F[2, 5] = 1.0
        
        # Measurement matrix (observe position only)
        self.H = np.zeros((dim_z, dim_x))
        self.H[0, 0] = self.H[1, 1] = self.H[2, 2] = 1.0
        
        # Process noise covariance
        self.Q = np.eye(dim_x) * 0.1
        
        # Measurement noise covariance  
        self.R = np.eye(dim_z) * 1.0
    
    def predict(self, dt=1.0):
        """Predict next state"""
        # Update state transition matrix with time step
        self.F[0, 3] = self.F[1, 4] = self.F[2, 5] = dt
        
        # Predict state
        self.x = self.F @ self.x
        
        # Predict covariance
        self.P = self.F @ self.P @ self.F.T + self.Q
    
    def update(self, measurement):
        """Update with measurement"""
        # Innovation
        y = measurement - (self.H @ self.x)
        
        # Innovation covariance
        S = self.H @ self.P @ self.H.T + self.R
        
        # Kalman gain
        K = self.P @ self.H.T @ np.linalg.inv(S)
        
        # Update state
        self.x = self.x + K @ y
        
        # Update covariance
        I_KH = np.eye(self.dim_x) - K @ self.H
        self.P = I_KH @ self.P


class ObjectTracker:
    """Individual object tracker with Kalman filtering"""
    
    def __init__(self, track_id: int, initial_detection: Detection3D):
        self.track_id = track_id
        self.class_name = initial_detection.class_name
        self.class_id = initial_detection.class_id
        
        # Kalman filter for state estimation
        self.kf = ExtendedKalmanFilter(dim_x=6, dim_z=3)
        
        # Initialize state with detection
        self.kf.x[:3] = initial_detection.position
        self.kf.x[3:] = 0.0  # Initial velocity is zero
        
        # Tracking statistics
        self.age = 0
        self.hits = 1
        self.time_since_update = 0
        self.confidence = initial_detection.confidence
        
        # History for smoothing
        self.position_history = deque(maxlen=10)
        self.position_history.append(initial_detection.position.copy())
        
        # Last detection info
        self.last_bbox = initial_detection.bbox_left
        self.last_timestamp = initial_detection.timestamp
    
    def predict(self, dt: float = 1.0):
        """Predict next state"""
        self.kf.predict(dt)
        self.age += 1
        self.time_since_update += 1
    
    def update(self, detection: Detection3D):
        """Update tracker with new detection"""
        self.kf.update(detection.position)
        
        # Update tracking statistics
        self.hits += 1
        self.time_since_update = 0
        
        # Update confidence with exponential moving average
        self.confidence = 0.7 * self.confidence + 0.3 * detection.confidence
        
        # Update history
        self.position_history.append(detection.position.copy())
        self.last_bbox = detection.bbox_left
        self.last_timestamp = detection.timestamp
    
    def get_state(self) -> TrackingResult:
        """Get current tracking state"""
        return TrackingResult(
            track_id=self.track_id,
            position=self.kf.x[:3].copy(),
            velocity=self.kf.x[3:].copy(),
            bbox=self.last_bbox,
            class_name=self.class_name,
            confidence=self.confidence,
            age=self.age,
            hits=self.hits,
            time_since_update=self.time_since_update
        )
    
    def is_alive(self, max_age: int = 30, min_hits: int = 3) -> bool:
        """Check if tracker should be kept alive"""
        if self.time_since_update > max_age:
            return False
        if self.hits < min_hits and self.age > max_age:
            return False
        return True
    
    def get_smoothed_position(self) -> np.ndarray:
        """Get position smoothed over recent history"""
        if len(self.position_history) < 2:
            return self.kf.x[:3]
        
        # Simple moving average
        positions = np.array(list(self.position_history))
        return np.mean(positions, axis=0)


class MedicalObjectDetector:
    """Medical-specific object detection using computer vision techniques"""
    
    def __init__(self):
        self.medical_classes = {
            0: 'surgical_instrument',
            1: 'syringe', 
            2: 'forceps',
            3: 'scalpel',
            4: 'medical_equipment',
            5: 'hand',
            6: 'anatomical_landmark',
            7: 'iv_stand',
            8: 'monitor'
        }
        
        # Edge detection parameters for instruments
        self.canny_low = 50
        self.canny_high = 150
        
        # Contour filtering parameters
        self.min_contour_area = 100
        self.max_contour_area = 50000
    
    def detect_objects(self, frame: np.ndarray) -> List[Dict]:
        """Detect medical objects using classical computer vision"""
        if not CV2_AVAILABLE:
            return []
        
        detections = []
        
        # Convert to grayscale for processing
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Detect surgical instruments by edges and shapes
        instrument_dets = self._detect_instruments(frame, gray)
        detections.extend(instrument_dets)
        
        # Detect hands using skin color detection
        hand_dets = self._detect_hands(frame)
        detections.extend(hand_dets)
        
        # Detect rectangular medical equipment
        equipment_dets = self._detect_equipment(frame, gray)
        detections.extend(equipment_dets)
        
        return detections
    
    def _detect_instruments(self, frame: np.ndarray, gray: np.ndarray) -> List[Dict]:
        """Detect surgical instruments using edge detection"""
        detections = []
        
        # Edge detection
        edges = cv2.Canny(gray, self.canny_low, self.canny_high)
        
        # Morphological operations to connect edges
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if self.min_contour_area < area < self.max_contour_area:
                # Get bounding box
                x, y, w, h = cv2.boundingRect(contour)
                
                # Filter by aspect ratio (instruments are often elongated)
                aspect_ratio = max(w, h) / min(w, h)
                if aspect_ratio > 2.0:  # Elongated objects
                    confidence = min(0.9, area / 1000.0)  # Simple confidence based on size
                    
                    detections.append({
                        'bbox': (x, y, x + w, y + h),
                        'class_id': 0,  # surgical_instrument
                        'class_name': 'surgical_instrument', 
                        'confidence': confidence,
                        'center': (x + w // 2, y + h // 2)
                    })
        
        return detections
    
    def _detect_hands(self, frame: np.ndarray) -> List[Dict]:
        """Detect hands using skin color detection"""
        detections = []
        
        # Convert to HSV for skin detection
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Skin color range in HSV
        lower_skin = np.array([0, 20, 70], dtype=np.uint8)
        upper_skin = np.array([20, 255, 255], dtype=np.uint8)
        
        # Create mask for skin pixels
        skin_mask = cv2.inRange(hsv, lower_skin, upper_skin)
        
        # Morphological operations to clean up mask
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN, kernel)
        skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, kernel)
        
        # Find contours in skin mask
        contours, _ = cv2.findContours(skin_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 2000:  # Minimum hand size
                x, y, w, h = cv2.boundingRect(contour)
                
                # Simple hand shape validation (roughly square-ish)
                aspect_ratio = max(w, h) / min(w, h)
                if aspect_ratio < 2.0:
                    confidence = min(0.8, area / 10000.0)
                    
                    detections.append({
                        'bbox': (x, y, x + w, y + h),
                        'class_id': 5,  # hand
                        'class_name': 'hand',
                        'confidence': confidence,
                        'center': (x + w // 2, y + h // 2)
                    })
        
        return detections
    
    def _detect_equipment(self, frame: np.ndarray, gray: np.ndarray) -> List[Dict]:
        """Detect medical equipment using rectangle detection"""
        detections = []
        
        # Apply Gaussian blur
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Adaptive threshold
        thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_MEAN_C, 
                                      cv2.THRESH_BINARY, 11, 2)
        
        # Find contours
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            # Approximate contour to polygon
            epsilon = 0.02 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            
            # Look for rectangular shapes (4 corners)
            if len(approx) == 4:
                area = cv2.contourArea(contour)
                if area > 5000:  # Minimum equipment size
                    x, y, w, h = cv2.boundingRect(contour)
                    
                    confidence = min(0.7, area / 20000.0)
                    
                    detections.append({
                        'bbox': (x, y, x + w, y + h),
                        'class_id': 4,  # medical_equipment
                        'class_name': 'medical_equipment',
                        'confidence': confidence,
                        'center': (x + w // 2, y + h // 2)
                    })
        
        return detections


class StereoDepthProcessor:
    """Process stereo camera pairs for depth information"""
    
    def __init__(self, camera_params: Dict):
        self.camera_matrix = np.array(camera_params['intrinsic_matrix'])
        self.baseline = camera_params.get('stereo_baseline', 0.064)
        self.focal_length = self.camera_matrix[0, 0]
        
        # Stereo matching parameters
        if CV2_AVAILABLE:
            self.stereo_matcher = cv2.StereoBM_create(numDisparities=64, blockSize=15)
    
    def compute_depth_map(self, left_frame: np.ndarray, right_frame: np.ndarray) -> np.ndarray:
        """Compute depth map from stereo pair"""
        if not CV2_AVAILABLE:
            return np.zeros((left_frame.shape[0], left_frame.shape[1]), dtype=np.float32)
        
        # Convert to grayscale
        left_gray = cv2.cvtColor(left_frame, cv2.COLOR_BGR2GRAY)
        right_gray = cv2.cvtColor(right_frame, cv2.COLOR_BGR2GRAY)
        
        # Compute disparity
        disparity = self.stereo_matcher.compute(left_gray, right_gray).astype(np.float32) / 16.0
        
        # Convert disparity to depth
        # Avoid division by zero
        disparity[disparity <= 0] = 1.0
        depth_map = (self.focal_length * self.baseline) / disparity
        
        return depth_map
    
    def triangulate_point(self, left_point: Tuple[int, int], 
                         right_point: Tuple[int, int]) -> np.ndarray:
        """Triangulate 3D point from stereo correspondence"""
        # Disparity
        disparity = left_point[0] - right_point[0]
        if disparity <= 0:
            return np.array([0, 0, 0])
        
        # 3D coordinates
        depth = (self.focal_length * self.baseline) / disparity
        
        # Convert from image coordinates to 3D
        cx, cy = self.camera_matrix[0, 2], self.camera_matrix[1, 2]
        fx, fy = self.camera_matrix[0, 0], self.camera_matrix[1, 1]
        
        x = (left_point[0] - cx) * depth / fx
        y = (left_point[1] - cy) * depth / fy
        z = depth
        
        return np.array([x, y, z])


class MedicalARTracker:
    """Enhanced AR tracking for medical applications"""
    
    def __init__(self, camera_params: Dict, medical_mode: bool = True):
        self.camera_params = camera_params
        self.medical_mode = medical_mode
        
        # Object detection and tracking
        self.medical_detector = MedicalObjectDetector()
        self.depth_processor = StereoDepthProcessor(camera_params)
        
        # Multi-object tracking
        self.trackers: Dict[int, ObjectTracker] = {}
        self.next_track_id = 0
        self.max_trackers = 50
        
        # Spatial anchors for persistent annotations
        self.spatial_anchors: Dict[str, SpatialAnchor] = {}
        self.anchor_counter = 0
        
        # Current state
        self.current_pose = Pose6DoF()
        self.current_timestamp = 0.0
        self.tracking_quality = 0.0
        
        # Performance tracking
        self.frame_count = 0
        self.processing_times = deque(maxlen=30)
        
        print("Medical AR Tracker initialized")
        print(f"Medical mode: {medical_mode}")
        print(f"Camera parameters: {list(camera_params.keys())}")
    
    def process_stereo_frame(self, left_frame: np.ndarray, right_frame: np.ndarray,
                           imu_data: Dict, timestamp: float) -> Dict[str, Any]:
        """Main processing pipeline for stereo frames"""
        start_time = time.time()
        
        self.current_timestamp = timestamp
        self.frame_count += 1
        
        # 1. Update pose (simplified - would use SLAM in full implementation)
        self._update_pose(imu_data, timestamp)
        
        # 2. Detect objects in left frame
        detections_2d = self.medical_detector.detect_objects(left_frame)
        
        # 3. Convert 2D detections to 3D using stereo depth
        detections_3d = self._triangulate_detections(
            detections_2d, left_frame, right_frame
        )
        
        # 4. Update multi-object tracking
        self._update_trackers(detections_3d, timestamp)
        
        # 5. Update spatial anchors
        self._update_spatial_anchors()
        
        # 6. Calculate tracking quality
        self._calculate_tracking_quality()
        
        # Record performance
        processing_time = time.time() - start_time
        self.processing_times.append(processing_time)
        
        return self._generate_results(processing_time)
    
    def _update_pose(self, imu_data: Dict, timestamp: float):
        """Update camera pose using IMU data (simplified)"""
        # In a full implementation, this would use visual-inertial SLAM
        # For now, use IMU integration for basic pose estimation
        
        dt = 0.033  # Assume 30 FPS
        if hasattr(self, '_last_timestamp'):
            dt = timestamp - self._last_timestamp
        
        # Simple IMU integration (very basic - real implementation would be much more complex)
        accel = np.array(imu_data.get('accel', [0, 0, 0]))
        gyro = np.array(imu_data.get('gyro', [0, 0, 0]))
        
        # Update orientation using gyroscope (simplified)
        if hasattr(self, '_angular_velocity'):
            self._angular_velocity = 0.9 * self._angular_velocity + 0.1 * gyro
        else:
            self._angular_velocity = gyro
        
        # Update position using accelerometer (very simplified)
        if not hasattr(self, '_velocity'):
            self._velocity = np.zeros(3)
        
        self._velocity += accel * dt
        new_position = self.current_pose.position + self._velocity * dt
        
        # Create updated pose
        self.current_pose = Pose6DoF(
            position=new_position,
            orientation=self.current_pose.orientation,  # Would be updated with gyro integration
            timestamp=timestamp,
            confidence=0.8  # Simplified confidence
        )
        
        self._last_timestamp = timestamp
    
    def _triangulate_detections(self, detections_2d: List[Dict], 
                              left_frame: np.ndarray, 
                              right_frame: np.ndarray) -> List[Detection3D]:
        """Convert 2D detections to 3D using stereo triangulation"""
        detections_3d = []
        
        for det in detections_2d:
            # For simplicity, assume same detection appears in right frame
            # In real implementation, would do stereo matching
            left_center = det['center']
            
            # Simulate stereo correspondence (simplified)
            disparity = max(1, int(20 + np.random.normal(0, 5)))  # Simulated disparity
            right_center = (left_center[0] - disparity, left_center[1])
            
            # Triangulate 3D position
            world_pos = self.depth_processor.triangulate_point(left_center, right_center)
            
            # Transform to world coordinates using current pose
            world_pos = self._camera_to_world(world_pos)
            
            detection_3d = Detection3D(
                position=world_pos,
                bbox_left=det['bbox'],
                class_id=det['class_id'],
                class_name=det['class_name'],
                confidence=det['confidence'],
                depth=np.linalg.norm(world_pos - self.current_pose.position),
                timestamp=self.current_timestamp
            )
            
            detections_3d.append(detection_3d)
        
        return detections_3d
    
    def _camera_to_world(self, camera_pos: np.ndarray) -> np.ndarray:
        """Transform point from camera coordinates to world coordinates"""
        # Apply current camera pose transformation
        # This is a simplified version - real implementation would use proper transformation matrices
        return camera_pos + self.current_pose.position
    
    def _update_trackers(self, detections_3d: List[Detection3D], timestamp: float):
        """Update multi-object tracking"""
        # Predict all trackers
        dt = 0.033  # Assume 30 FPS
        for tracker in self.trackers.values():
            tracker.predict(dt)
        
        # Associate detections with trackers
        if len(self.trackers) > 0 and len(detections_3d) > 0:
            associations = self._associate_detections_to_trackers(detections_3d)
        else:
            associations = {}
        
        # Update associated trackers
        updated_trackers = set()
        for det_idx, track_id in associations.items():
            if track_id in self.trackers:
                self.trackers[track_id].update(detections_3d[det_idx])
                updated_trackers.add(track_id)
        
        # Create new trackers for unassociated detections
        for det_idx, detection in enumerate(detections_3d):
            if det_idx not in associations and len(self.trackers) < self.max_trackers:
                new_tracker = ObjectTracker(self.next_track_id, detection)
                self.trackers[self.next_track_id] = new_tracker
                self.next_track_id += 1
        
        # Remove dead trackers
        dead_trackers = [
            track_id for track_id, tracker in self.trackers.items()
            if not tracker.is_alive()
        ]
        for track_id in dead_trackers:
            del self.trackers[track_id]
    
    def _associate_detections_to_trackers(self, detections: List[Detection3D]) -> Dict[int, int]:
        """Associate detections with existing trackers using Hungarian algorithm"""
        if not SCIPY_AVAILABLE or len(self.trackers) == 0 or len(detections) == 0:
            return {}
        
        # Create cost matrix based on 3D distance
        tracker_ids = list(self.trackers.keys())
        tracker_positions = np.array([
            self.trackers[tid].kf.x[:3] for tid in tracker_ids
        ])
        detection_positions = np.array([det.position for det in detections])
        
        # Calculate distance matrix
        distances = cdist(detection_positions, tracker_positions)
        
        # Apply Hungarian algorithm
        det_indices, tracker_indices = linear_sum_assignment(distances)
        
        # Filter out associations with distance > threshold
        max_distance = 2.0  # meters
        associations = {}
        for det_idx, tracker_idx in zip(det_indices, tracker_indices):
            if distances[det_idx, tracker_idx] < max_distance:
                associations[det_idx] = tracker_ids[tracker_idx]
        
        return associations
    
    def _update_spatial_anchors(self):
        """Update spatial anchors based on current tracking"""
        # Create anchors for stable, high-confidence tracks
        for tracker in self.trackers.values():
            track_result = tracker.get_state()
            
            # Create anchor for stable tracks
            if (track_result.hits > 10 and 
                track_result.confidence > 0.7 and 
                track_result.time_since_update < 5):
                
                anchor_id = f"track_{track_result.track_id}"
                
                if anchor_id not in self.spatial_anchors:
                    # Create new spatial anchor with proper Pose6DoF
                    anchor_pose = Pose6DoF(
                        position=track_result.position.copy(),
                        orientation=np.array([1, 0, 0, 0]),  # Identity quaternion
                        timestamp=self.current_timestamp,
                        confidence=track_result.confidence
                    )
                    
                    self.spatial_anchors[anchor_id] = SpatialAnchor(
                        id=anchor_id,
                        pose=anchor_pose,
                        descriptor=np.random.randn(128),  # Placeholder descriptor
                        feature_points=[track_result.position.copy()],  # Simplified
                        created_timestamp=self.current_timestamp,
                        last_seen=self.current_timestamp,
                        confidence=track_result.confidence
                    )
                else:
                    # Update existing anchor
                    anchor = self.spatial_anchors[anchor_id]
                    # Smooth anchor position
                    alpha = 0.1
                    anchor.pose.position = (1 - alpha) * anchor.pose.position + alpha * track_result.position
                    anchor.confidence = max(anchor.confidence, track_result.confidence)
                    anchor.last_seen = self.current_timestamp
    
    def _calculate_tracking_quality(self):
        """Calculate overall tracking quality metric"""
        if len(self.trackers) == 0:
            self.tracking_quality = 0.5  # Neutral quality when no objects
            return
        
        # Quality based on tracker confidence and stability
        total_quality = 0.0
        for tracker in self.trackers.values():
            track_result = tracker.get_state()
            
            # Quality factors
            confidence_factor = track_result.confidence
            stability_factor = min(1.0, track_result.hits / 10.0)
            recency_factor = max(0.0, 1.0 - track_result.time_since_update / 10.0)
            
            track_quality = confidence_factor * stability_factor * recency_factor
            total_quality += track_quality
        
        # Average quality across all trackers
        self.tracking_quality = min(1.0, total_quality / len(self.trackers))
    
    def _generate_results(self, processing_time: float) -> Dict[str, Any]:
        """Generate results dictionary"""
        # Get current tracking results
        tracking_results = [tracker.get_state() for tracker in self.trackers.values()]
        
        # Get spatial anchor positions for annotation
        anchor_positions = {}
        for anchor_id, anchor in self.spatial_anchors.items():
            # Project 3D anchor to screen coordinates (simplified)
            screen_pos = self._world_to_screen(anchor.pose.position)
            if screen_pos is not None:
                anchor_positions[anchor_id] = {
                    'screen_pos': screen_pos,
                    'world_pos': anchor.pose.position,
                    'confidence': anchor.confidence,
                    'object_type': getattr(anchor, 'object_type', 'unknown')
                }
        
        return {
            'pose_6dof': {
                'pose': self.current_pose,
                'status': 'tracking' if self.tracking_quality > 0.5 else 'lost'
            },
            'tracking_quality': self.tracking_quality,
            'tracked_objects': tracking_results,
            'spatial_anchors': list(self.spatial_anchors.values()),
            'anchor_positions': anchor_positions,
            'detected_planes': [],  # Placeholder for plane detection
            'environmental_mesh': None,  # Placeholder for mesh
            'processing_time': processing_time,
            'average_processing_time': np.mean(self.processing_times) if self.processing_times else 0.0,
            'frame_count': self.frame_count,
            'system_status': {
                'slam_initialized': True,
                'keyframe_count': self.frame_count // 10,
                'anchor_count': len(self.spatial_anchors),
                'tracker_count': len(self.trackers),
                'advanced_features_enabled': SCIPY_AVAILABLE and CV2_AVAILABLE
            }
        }
    
    def _world_to_screen(self, world_pos: np.ndarray) -> Optional[Tuple[int, int]]:
        """Project 3D world position to screen coordinates (simplified)"""
        # This is a very simplified projection
        # Real implementation would use proper camera projection matrices
        
        # Transform to camera coordinates (simplified)
        camera_pos = world_pos - self.current_pose.position
        
        # Basic perspective projection
        if camera_pos[2] <= 0:  # Behind camera
            return None
        
        fx = self.camera_params['intrinsic_matrix'][0][0]
        fy = self.camera_params['intrinsic_matrix'][1][1]
        cx = self.camera_params['intrinsic_matrix'][0][2]
        cy = self.camera_params['intrinsic_matrix'][1][2]
        
        x_screen = int(fx * camera_pos[0] / camera_pos[2] + cx)
        y_screen = int(fy * camera_pos[1] / camera_pos[2] + cy)
        
        return (x_screen, y_screen)
    
    def create_manual_anchor(self, screen_pos: Tuple[int, int], object_type: str = "manual") -> str:
        """Create a manual spatial anchor at screen position"""
        # Convert screen position to world position (simplified)
        # In real implementation, this would use proper unprojection
        
        # Assume 1 meter depth for manual anchors
        depth = 1.0
        
        fx = self.camera_params['intrinsic_matrix'][0][0]
        fy = self.camera_params['intrinsic_matrix'][1][1]
        cx = self.camera_params['intrinsic_matrix'][0][2]
        cy = self.camera_params['intrinsic_matrix'][1][2]
        
        # Unproject to camera coordinates
        x_cam = (screen_pos[0] - cx) * depth / fx
        y_cam = (screen_pos[1] - cy) * depth / fy
        z_cam = depth
        
        # Transform to world coordinates
        world_pos = np.array([x_cam, y_cam, z_cam]) + self.current_pose.position
        
        # Create spatial anchor
        anchor_id = f"manual_{self.anchor_counter}"
        self.anchor_counter += 1
        
        # Create proper Pose6DoF for the anchor
        anchor_pose = Pose6DoF(
            position=world_pos,
            orientation=np.array([1, 0, 0, 0]),  # Identity quaternion
            timestamp=self.current_timestamp,
            confidence=1.0
        )
        
        self.spatial_anchors[anchor_id] = SpatialAnchor(
            id=anchor_id,
            pose=anchor_pose,
            descriptor=np.random.randn(128),  # Placeholder descriptor
            feature_points=[world_pos.copy()],  # Simplified
            created_timestamp=self.current_timestamp,
            last_seen=self.current_timestamp,
            confidence=1.0
        )
        
        # Add object type as an attribute for backward compatibility
        setattr(self.spatial_anchors[anchor_id], 'object_type', object_type)
        
        return anchor_id
    
    def remove_anchor(self, anchor_id: str) -> bool:
        """Remove a spatial anchor"""
        if anchor_id in self.spatial_anchors:
            del self.spatial_anchors[anchor_id]
            return True
        return False
    
    def get_tracking_statistics(self) -> Dict[str, Any]:
        """Get detailed tracking statistics"""
        return {
            'total_trackers': len(self.trackers),
            'active_trackers': len([t for t in self.trackers.values() if t.time_since_update < 5]),
            'total_anchors': len(self.spatial_anchors),
            'tracking_quality': self.tracking_quality,
            'average_processing_time': np.mean(self.processing_times) if self.processing_times else 0.0,
            'frames_processed': self.frame_count,
            'system_capabilities': {
                'opencv_available': CV2_AVAILABLE,
                'scipy_available': SCIPY_AVAILABLE,
                'medical_mode': self.medical_mode
            }
        }
    
    def save_session(self, filepath: str) -> bool:
        """Save tracking session to file"""
        try:
            session_data = {
                'spatial_anchors': {aid: anchor.to_dict() for aid, anchor in self.spatial_anchors.items()},
                'tracking_stats': self.get_tracking_statistics(),
                'camera_params': self.camera_params,
                'timestamp': self.current_timestamp
            }
            
            with open(filepath, 'wb') as f:
                pickle.dump(session_data, f)
            
            return True
        except Exception as e:
            print(f"Error saving session: {e}")
            return False
    
    def load_session(self, filepath: str) -> bool:
        """Load tracking session from file"""
        try:
            with open(filepath, 'rb') as f:
                session_data = pickle.load(f)
            
            # Restore spatial anchors
            self.spatial_anchors = {}
            for aid, anchor_dict in session_data['spatial_anchors'].items():
                self.spatial_anchors[aid] = SpatialAnchor.from_dict(anchor_dict)
            
            print(f"Loaded session with {len(self.spatial_anchors)} spatial anchors")
            return True
            
        except Exception as e:
            print(f"Error loading session: {e}")
            return False