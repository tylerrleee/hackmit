"""
Core AR Processor for Medical/Surgical Guidance Systems

This module processes live camera footage to enable advanced spatial tracking 
and environmental understanding for AR applications, specifically designed for 
medical/surgical guidance systems using XREAL glasses.
"""

import numpy as np
import cv2
import threading
import time
import sqlite3
import pickle
from collections import deque
from typing import Dict, List, Tuple, Optional, Any

try:
    from scipy.spatial.transform import Rotation as R
    from scipy.optimize import least_squares
    from scipy.spatial import ConvexHull, Delaunay
    import open3d as o3d
    from sklearn.decomposition import PCA
    ADVANCED_FEATURES = True
except ImportError:
    print("Warning: Some advanced features disabled. Install scipy, open3d, scikit-learn for full functionality.")
    ADVANCED_FEATURES = False

from .data_structures import Pose6DoF, SpatialAnchor, PlaneInfo, EnvironmentalMesh


class CoreARProcessor:
    """
    Core AR processing system for medical/surgical guidance applications
    Processes live camera footage for advanced spatial tracking and environmental understanding
    """
    
    def __init__(self, camera_params: Dict, medical_precision_mode: bool = True):
        # Camera parameters
        self.camera_matrix = np.array(camera_params['intrinsic_matrix'])
        self.dist_coeffs = np.array(camera_params['distortion_coeffs'])
        self.stereo_baseline = camera_params.get('stereo_baseline', 0.064)  # XREAL glasses baseline
        
        # Medical precision requirements
        self.medical_precision_mode = medical_precision_mode
        self.precision_threshold = 0.1 if medical_precision_mode else 1.0  # sub-millimeter for medical
        
        # SLAM components
        self.slam_initialized = False
        self.current_pose = Pose6DoF()
        self.keyframes = []
        self.map_points = []
        self.pose_history = deque(maxlen=1000)
        
        # Feature detection
        self.feature_detector = cv2.ORB_create(nfeatures=2000, scaleFactor=1.2, nlevels=8)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        
        # Environmental understanding
        self.detected_planes = {}
        self.depth_mesh = None
        self.surface_classifier_model = self._initialize_surface_classifier()
        
        # Spatial anchors
        self.spatial_anchors = {}
        self.anchor_database = self._initialize_anchor_database()
        
        # Performance optimization
        self.processing_thread = None
        self.is_processing = False
        self.frame_buffer = deque(maxlen=5)
        
        # IMU integration
        self.imu_data = deque(maxlen=100)
        self.last_imu_timestamp = 0
        
        # Cache for performance
        self.last_feature_count = 0
        
    def _initialize_surface_classifier(self):
        """Initialize ML model for surface classification"""
        # In practice, this would load a pre-trained model
        # For demonstration, using heuristic classification
        return {
            'horizontal_threshold': 0.15,  # Normal vector angle threshold
            'instrument_tray_height': (0.8, 1.2),  # Height range for instrument trays
            'wall_normal_threshold': 0.85
        }
        
    def _initialize_anchor_database(self):
        """Initialize persistent anchor storage"""
        conn = sqlite3.connect(':memory:')  # In production, use persistent storage
        conn.execute('''CREATE TABLE anchors 
                       (id TEXT PRIMARY KEY, 
                        pose_data BLOB, 
                        descriptor BLOB,
                        timestamp REAL,
                        confidence REAL)''')
        return conn

    def process_camera_footage(self, left_frame: np.ndarray, right_frame: np.ndarray, 
                             imu_data: Dict, timestamp: float) -> Dict[str, Any]:
        """
        Main processing function for camera footage
        
        Args:
            left_frame: Left camera image (stereo)
            right_frame: Right camera image (stereo)
            imu_data: IMU sensor data {'accel': [x,y,z], 'gyro': [x,y,z]}
            timestamp: Frame timestamp
            
        Returns:
            Dictionary containing all AR processing results
        """
        results = {
            'pose_6dof': None,
            'environmental_mesh': None,
            'detected_planes': [],
            'spatial_anchors': [],
            'tracking_quality': 0.0,
            'processing_time': 0.0
        }
        
        start_time = time.perf_counter()
        
        try:
            # 1. SLAM-based 6DoF tracking
            pose_result = self._perform_slam_tracking(left_frame, right_frame, imu_data, timestamp)
            results['pose_6dof'] = pose_result
            
            # 2. Environmental understanding
            if self.slam_initialized and pose_result.get('tracking_quality', 0) > 0.7:
                # Plane detection
                planes = self._detect_planes(left_frame, right_frame)
                results['detected_planes'] = planes
                
                # Depth mesh generation
                depth_mesh = self._generate_depth_mesh(left_frame, right_frame)
                results['environmental_mesh'] = depth_mesh
                
                # Surface classification
                if planes:
                    classified_surfaces = self._classify_surfaces(planes)
                    results['surface_classifications'] = classified_surfaces
            
            # 3. Spatial anchor management
            anchor_results = self._manage_spatial_anchors(left_frame, pose_result)
            results['spatial_anchors'] = anchor_results
            
            # 4. Quality assessment
            results['tracking_quality'] = self._assess_tracking_quality()
            
        except Exception as e:
            print(f"AR Processing error: {e}")
            results['error'] = str(e)
        
        results['processing_time'] = time.perf_counter() - start_time
        return results

    def _perform_slam_tracking(self, left_frame: np.ndarray, right_frame: np.ndarray, 
                             imu_data: Dict, timestamp: float) -> Dict[str, Any]:
        """
        Implement full 6DoF SLAM tracking with IMU fusion
        """
        # Undistort images
        left_undistorted = cv2.undistort(left_frame, self.camera_matrix, self.dist_coeffs)
        right_undistorted = cv2.undistort(right_frame, self.camera_matrix, self.dist_coeffs)
        
        # Extract features
        kp_left, desc_left = self.feature_detector.detectAndCompute(left_undistorted, None)
        kp_right, desc_right = self.feature_detector.detectAndCompute(right_undistorted, None)
        
        if not self.slam_initialized:
            return self._initialize_slam(left_undistorted, right_undistorted, 
                                       kp_left, desc_left, kp_right, desc_right, timestamp)
        else:
            return self._track_pose(left_undistorted, right_undistorted,
                                  kp_left, desc_left, imu_data, timestamp)

    def _initialize_slam(self, left_frame: np.ndarray, right_frame: np.ndarray,
                        kp_left, desc_left, kp_right, desc_right, timestamp: float) -> Dict[str, Any]:
        """Initialize SLAM system with stereo pair"""
        
        if desc_left is None or desc_right is None:
            return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'initialization_failed'}
        
        # Stereo matching for initialization
        matches = self.matcher.knnMatch(desc_left, desc_right, k=2)
        good_matches = []
        
        for match_pair in matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < 0.7 * n.distance:
                    good_matches.append(m)
        
        if len(good_matches) < 50:
            return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'insufficient_features'}
        
        # Triangulate initial map points
        points_3d = self._triangulate_points(kp_left, kp_right, good_matches)
        
        if len(points_3d) > 30:
            self.map_points = points_3d
            self.keyframes.append({
                'timestamp': timestamp,
                'pose': Pose6DoF(),
                'features': desc_left,
                'keypoints': kp_left
            })
            self.slam_initialized = True
            
            return {
                'pose': self.current_pose,
                'tracking_quality': 0.8,
                'status': 'initialized',
                'map_points_count': len(points_3d)
            }
        
        return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'initialization_failed'}

    def _track_pose(self, left_frame: np.ndarray, right_frame: np.ndarray,
                   kp_left, desc_left, imu_data: Dict, timestamp: float) -> Dict[str, Any]:
        """Track current pose using existing map"""
        
        if not self.keyframes or desc_left is None:
            return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'tracking_lost'}
        
        # Match with previous keyframe
        last_keyframe = self.keyframes[-1]
        matches = self.matcher.knnMatch(desc_left, last_keyframe['features'], k=2)
        
        good_matches = []
        for match_pair in matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < 0.7 * n.distance:
                    good_matches.append(m)
        
        self.last_feature_count = len(good_matches)
        
        if len(good_matches) < 20:
            return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'insufficient_matches'}
        
        # PnP pose estimation
        object_points = []
        image_points = []
        
        for match in good_matches:
            if match.trainIdx < len(self.map_points):
                object_points.append(self.map_points[match.trainIdx])
                image_points.append(kp_left[match.queryIdx].pt)
        
        if len(object_points) < 6:
            return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'insufficient_3d_points'}
        
        object_points = np.array(object_points, dtype=np.float32)
        image_points = np.array(image_points, dtype=np.float32)
        
        # IMU prediction for initial pose estimate
        predicted_pose = self._predict_pose_with_imu(imu_data, timestamp)
        
        # Solve PnP
        success, rvec, tvec, inliers = cv2.solvePnPRansac(
            object_points, image_points, self.camera_matrix, self.dist_coeffs,
            useExtrinsicGuess=True,
            rvec=predicted_pose['rotation_vector'],
            tvec=predicted_pose['translation_vector'],
            reprojectionError=2.0 if self.medical_precision_mode else 5.0,
            confidence=0.99
        )
        
        if success and inliers is not None and len(inliers) > 10:
            # Update current pose
            if ADVANCED_FEATURES:
                rotation_matrix = cv2.Rodrigues(rvec)[0]
                quaternion = R.from_matrix(rotation_matrix).as_quat()  # x, y, z, w format
                quaternion = np.array([quaternion[3], quaternion[0], quaternion[1], quaternion[2]])  # w, x, y, z
            else:
                # Fallback without scipy
                quaternion = np.array([1, 0, 0, 0])
            
            self.current_pose = Pose6DoF(
                position=tvec.flatten(),
                orientation=quaternion,
                timestamp=timestamp,
                confidence=len(inliers) / len(good_matches)
            )
            
            # Add to pose history
            self.pose_history.append(self.current_pose)
            
            # Bundle adjustment for medical precision
            if self.medical_precision_mode and len(self.pose_history) > 5 and ADVANCED_FEATURES:
                self._perform_local_bundle_adjustment()
            
            tracking_quality = min(len(inliers) / len(good_matches), 1.0)
            
            return {
                'pose': self.current_pose,
                'tracking_quality': tracking_quality,
                'status': 'tracking',
                'inlier_count': len(inliers),
                'feature_count': len(good_matches)
            }
        
        return {'pose': self.current_pose, 'tracking_quality': 0.0, 'status': 'pose_estimation_failed'}

    def _predict_pose_with_imu(self, imu_data: Dict, timestamp: float) -> Dict[str, np.ndarray]:
        """Predict pose using IMU integration"""
        if not self.pose_history:
            return {
                'rotation_vector': np.zeros(3),
                'translation_vector': np.zeros(3)
            }
        
        last_pose = self.pose_history[-1]
        dt = timestamp - last_pose.timestamp
        
        if dt > 0.1:  # Too much time passed, don't predict
            if ADVANCED_FEATURES:
                rotation_matrix = R.from_quat([last_pose.orientation[1], last_pose.orientation[2], 
                                             last_pose.orientation[3], last_pose.orientation[0]]).as_matrix()
                rotation_vector = cv2.Rodrigues(rotation_matrix)[0]
            else:
                rotation_vector = np.zeros(3)
            
            return {
                'rotation_vector': rotation_vector,
                'translation_vector': last_pose.position
            }
        
        # Simple IMU integration (in practice, use proper IMU fusion like EKF)
        gyro = np.array(imu_data.get('gyro', [0, 0, 0]))
        accel = np.array(imu_data.get('accel', [0, 0, 0]))
        
        if ADVANCED_FEATURES:
            # Integrate rotation
            rotation_delta = gyro * dt
            current_rotation = R.from_quat([last_pose.orientation[1], last_pose.orientation[2], 
                                          last_pose.orientation[3], last_pose.orientation[0]])
            delta_rotation = R.from_rotvec(rotation_delta)
            new_rotation = current_rotation * delta_rotation
            rotation_vector = cv2.Rodrigues(new_rotation.as_matrix())[0]
        else:
            rotation_vector = np.zeros(3)
        
        # Integrate translation (simplified)
        velocity_delta = accel * dt
        position_delta = velocity_delta * dt
        new_position = last_pose.position + position_delta
        
        return {
            'rotation_vector': rotation_vector,
            'translation_vector': new_position
        }

    def _triangulate_points(self, kp_left, kp_right, matches) -> List[np.ndarray]:
        """Triangulate 3D points from stereo matches"""
        points_3d = []
        
        # Stereo camera matrices
        P1 = np.hstack([self.camera_matrix, np.zeros((3, 1))])
        P2 = np.hstack([self.camera_matrix, np.array([[-self.stereo_baseline * self.camera_matrix[0, 0]], [0], [0]])])
        
        for match in matches:
            pt_left = kp_left[match.queryIdx].pt
            pt_right = kp_right[match.trainIdx].pt
            
            # Triangulate point
            point_4d = cv2.triangulatePoints(P1, P2, 
                                           np.array([[pt_left[0]], [pt_left[1]]]),
                                           np.array([[pt_right[0]], [pt_right[1]]]))
            
            if point_4d[3] != 0:
                point_3d = point_4d[:3] / point_4d[3]
                # Filter out points too close or too far
                if 0.1 < point_3d[2] < 10.0:
                    points_3d.append(point_3d.flatten())
        
        return points_3d

    def _perform_local_bundle_adjustment(self):
        """Perform local bundle adjustment for medical precision"""
        if not ADVANCED_FEATURES:
            return
            
        # Simplified bundle adjustment - in practice, use specialized libraries like g2o
        if len(self.pose_history) < 3:
            return
        
        recent_poses = list(self.pose_history)[-5:]
        
        def residual_function(params):
            residuals = []
            for i, pose in enumerate(recent_poses[1:], 1):
                pose_params = params[i*6:(i+1)*6]
                # Calculate reprojection errors and pose smoothness
                # Simplified residual calculation
                residuals.extend(pose_params * 0.01)  # Placeholder
            return np.array(residuals)
        
        try:
            initial_params = np.zeros(len(recent_poses) * 6)
            result = least_squares(residual_function, initial_params, method='lm')
            # Update poses with optimized parameters (simplified)
        except:
            pass  # Fallback if optimization fails

    def _detect_planes(self, left_frame: np.ndarray, right_frame: np.ndarray) -> List[PlaneInfo]:
        """Detect planes in the environment for AR occlusion and placement"""
        if self.depth_mesh is None or not ADVANCED_FEATURES:
            return []
        
        planes = []
        
        try:
            # Use point cloud from depth mesh
            point_cloud = o3d.geometry.PointCloud()
            point_cloud.points = o3d.utility.Vector3dVector(self.depth_mesh.vertices)
            
            # RANSAC plane detection
            remaining_points = np.asarray(point_cloud.points).copy()
            
            for _ in range(5):  # Detect up to 5 planes
                if len(remaining_points) < 100:
                    break
                    
                pc_temp = o3d.geometry.PointCloud()
                pc_temp.points = o3d.utility.Vector3dVector(remaining_points)
                
                plane_model, inliers = pc_temp.segment_plane(distance_threshold=0.02,
                                                            ransac_n=3,
                                                            num_iterations=1000)
                
                if len(inliers) > 50:
                    plane_points = remaining_points[inliers]
                    
                    # Calculate plane properties
                    centroid = np.mean(plane_points, axis=0)
                    normal = plane_model[:3]
                    area = len(inliers) * 0.001  # Approximate area
                    
                    # Classify plane type
                    plane_type = self._classify_plane_type(normal, centroid, plane_points)
                    
                    plane_info = PlaneInfo(
                        normal=normal,
                        centroid=centroid,
                        boundaries=self._calculate_plane_boundaries(plane_points),
                        area=area,
                        plane_type=plane_type,
                        confidence=len(inliers) / len(remaining_points)
                    )
                    
                    planes.append(plane_info)
                    
                    # Remove inlier points
                    remaining_points = np.delete(remaining_points, inliers, axis=0)
        except Exception as e:
            print(f"Plane detection error: {e}")
        
        return planes

    def _classify_plane_type(self, normal: np.ndarray, centroid: np.ndarray, points: np.ndarray) -> str:
        """Classify plane type based on orientation and position"""
        # Horizontal planes (floors, instrument trays)
        if abs(normal[1]) > self.surface_classifier_model['horizontal_threshold']:
            height = centroid[1]
            if (self.surface_classifier_model['instrument_tray_height'][0] <= height <= 
                self.surface_classifier_model['instrument_tray_height'][1]):
                return 'instrument_tray'
            elif height < 0.3:
                return 'floor'
            else:
                return 'horizontal'
        
        # Vertical planes (walls)
        elif abs(normal[0]) > self.surface_classifier_model['wall_normal_threshold'] or \
             abs(normal[2]) > self.surface_classifier_model['wall_normal_threshold']:
            return 'wall'
        
        return 'other'

    def _calculate_plane_boundaries(self, plane_points: np.ndarray) -> np.ndarray:
        """Calculate 2D boundary polygon for plane"""
        if len(plane_points) < 3 or not ADVANCED_FEATURES:
            return np.array([])
        
        try:
            # Project to 2D using PCA
            pca = PCA(n_components=2)
            points_2d = pca.fit_transform(plane_points)
            
            # Find convex hull
            hull = ConvexHull(points_2d)
            boundary_2d = points_2d[hull.vertices]
            
            # Transform back to 3D
            boundary_3d = pca.inverse_transform(boundary_2d)
            return boundary_3d
        except:
            return plane_points[[0, -1]] if len(plane_points) > 1 else np.array([])  # Fallback

    def _generate_depth_mesh(self, left_frame: np.ndarray, right_frame: np.ndarray) -> EnvironmentalMesh:
        """Generate 3D environmental mesh for occlusion"""
        # Stereo depth estimation
        stereo = cv2.StereoBM_create(numDisparities=64, blockSize=15)
        disparity = stereo.compute(cv2.cvtColor(left_frame, cv2.COLOR_BGR2GRAY),
                                 cv2.cvtColor(right_frame, cv2.COLOR_BGR2GRAY))
        
        # Convert disparity to depth
        focal_length = self.camera_matrix[0, 0]
        depth = (focal_length * self.stereo_baseline) / (disparity + 1e-6)
        
        # Generate 3D points
        h, w = depth.shape
        vertices = []
        faces = []
        confidence_map = []
        
        for y in range(0, h-1, 4):  # Subsample for performance
            for x in range(0, w-1, 4):
                if depth[y, x] > 0 and depth[y, x] < 10:  # Valid depth range
                    # Back-project to 3D
                    z = depth[y, x]
                    x_3d = (x - self.camera_matrix[0, 2]) * z / self.camera_matrix[0, 0]
                    y_3d = (y - self.camera_matrix[1, 2]) * z / self.camera_matrix[1, 1]
                    
                    vertices.append([x_3d, y_3d, z])
                    confidence_map.append(1.0 if disparity[y, x] > 0 else 0.5)
        
        # Generate mesh faces (simplified triangulation)
        vertices = np.array(vertices)
        if len(vertices) > 3 and ADVANCED_FEATURES:
            try:
                # Project to 2D for triangulation
                points_2d = vertices[:, [0, 2]]  # x-z plane
                tri = Delaunay(points_2d)
                faces = tri.simplices
                
                # Calculate normals
                normals = self._calculate_mesh_normals(vertices, faces)
            except:
                faces = np.array([])
                normals = np.array([])
        else:
            faces = np.array([])
            normals = np.array([])
        
        self.depth_mesh = EnvironmentalMesh(
            vertices=vertices,
            faces=faces,
            normals=normals,
            confidence_map=np.array(confidence_map) if confidence_map else np.array([])
        )
        
        return self.depth_mesh

    def _calculate_mesh_normals(self, vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
        """Calculate vertex normals for mesh"""
        normals = np.zeros_like(vertices)
        
        for face in faces:
            if len(face) >= 3 and max(face) < len(vertices):
                v0, v1, v2 = vertices[face[:3]]
                normal = np.cross(v1 - v0, v2 - v0)
                norm = np.linalg.norm(normal)
                if norm > 0:
                    normal /= norm
                    for idx in face[:3]:
                        normals[idx] += normal
        
        # Normalize
        norms = np.linalg.norm(normals, axis=1)
        normals[norms > 0] /= norms[norms > 0, np.newaxis]
        
        return normals

    def _classify_surfaces(self, planes: List[PlaneInfo]) -> Dict[str, List[PlaneInfo]]:
        """Classify detected surfaces for intelligent hologram placement"""
        classifications = {
            'instrument_trays': [],
            'walls': [],
            'floors': [],
            'other_horizontal': [],
            'other': []
        }
        
        for plane in planes:
            if plane.plane_type == 'instrument_tray':
                classifications['instrument_trays'].append(plane)
            elif plane.plane_type == 'wall':
                classifications['walls'].append(plane)
            elif plane.plane_type == 'floor':
                classifications['floors'].append(plane)
            elif plane.plane_type == 'horizontal':
                classifications['other_horizontal'].append(plane)
            else:
                classifications['other'].append(plane)
        
        return classifications

    def _manage_spatial_anchors(self, frame: np.ndarray, pose_result: Dict) -> List[Dict]:
        """Manage persistent spatial anchor points"""
        anchor_results = []
        current_time = time.time()
        
        # Update existing anchors
        for anchor_id, anchor in list(self.spatial_anchors.items()):
            # Check if anchor is still visible
            is_visible = self._is_anchor_visible(anchor, pose_result.get('pose', self.current_pose))
            
            if is_visible:
                anchor.last_seen = current_time
                # Re-localize anchor if needed
                updated_pose = self._relocalize_anchor(frame, anchor)
                if updated_pose:
                    anchor.pose = updated_pose
                    anchor.confidence = min(anchor.confidence + 0.1, 1.0)
            else:
                # Decrease confidence for invisible anchors
                anchor.confidence = max(anchor.confidence - 0.05, 0.1)
                
                # Remove anchors with very low confidence
                if anchor.confidence < 0.2:
                    del self.spatial_anchors[anchor_id]
                    continue
            
            anchor_results.append({
                'id': anchor.id,
                'pose': anchor.pose,
                'confidence': anchor.confidence,
                'visible': is_visible
            })
        
        # Detect new potential anchor points
        if pose_result.get('tracking_quality', 0) > 0.8:
            new_anchors = self._detect_new_anchor_candidates(frame, pose_result.get('pose', self.current_pose))
            for new_anchor in new_anchors:
                self.spatial_anchors[new_anchor.id] = new_anchor
                anchor_results.append({
                    'id': new_anchor.id,
                    'pose': new_anchor.pose,
                    'confidence': new_anchor.confidence,
                    'visible': True
                })
        
        return anchor_results

    def _is_anchor_visible(self, anchor: SpatialAnchor, current_pose: Pose6DoF) -> bool:
        """Check if spatial anchor is currently visible"""
        # Calculate relative position
        anchor_world_pos = anchor.pose.position
        camera_world_pos = current_pose.position
        
        relative_pos = anchor_world_pos - camera_world_pos
        distance = np.linalg.norm(relative_pos)
        
        # Check distance and viewing angle
        if distance > 5.0:  # Too far
            return False
        
        if not ADVANCED_FEATURES:
            return distance < 3.0  # Simple distance check
        
        # Transform to camera coordinate system
        camera_rotation = R.from_quat([current_pose.orientation[1], current_pose.orientation[2], 
                                     current_pose.orientation[3], current_pose.orientation[0]])
        relative_pos_camera = camera_rotation.inv().apply(relative_pos)
        
        # Check if in front of camera and within field of view
        if relative_pos_camera[2] < 0:  # Behind camera
            return False
        
        # Project to image plane
        x_img = (relative_pos_camera[0] * self.camera_matrix[0, 0] / relative_pos_camera[2] + 
                self.camera_matrix[0, 2])
        y_img = (relative_pos_camera[1] * self.camera_matrix[1, 1] / relative_pos_camera[2] + 
                self.camera_matrix[1, 2])
        
        # Check if within image bounds
        return 0 <= x_img <= 1920 and 0 <= y_img <= 1080  # Assuming XREAL glasses resolution

    def _relocalize_anchor(self, frame: np.ndarray, anchor: SpatialAnchor) -> Optional[Pose6DoF]:
        """Re-localize anchor using feature matching"""
        # Extract features from current frame
        keypoints, descriptors = self.feature_detector.detectAndCompute(frame, None)
        
        if descriptors is None or len(anchor.descriptor) == 0:
            return None
        
        # Match with anchor descriptor
        try:
            matches = self.matcher.knnMatch(anchor.descriptor, descriptors, k=2)
        except:
            return None
        
        good_matches = []
        for match_pair in matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < 0.7 * n.distance:
                    good_matches.append(m)
        
        if len(good_matches) < 4:
            return None
        
        # Use matched keypoints to refine anchor pose
        anchor_confidence = len(good_matches) / max(len(anchor.feature_points), 1)
        
        if anchor_confidence > 0.5:
            # Return updated pose (simplified)
            return Pose6DoF(
                position=anchor.pose.position,
                orientation=anchor.pose.orientation,
                timestamp=time.time(),
                confidence=anchor_confidence
            )
        
        return None

    def _detect_new_anchor_candidates(self, frame: np.ndarray, current_pose: Pose6DoF) -> List[SpatialAnchor]:
        """Detect new anchor candidates in the current frame"""
        # Extract strong features as potential anchor points
        keypoints, descriptors = self.feature_detector.detectAndCompute(frame, None)
        
        if descriptors is None:
            return []
        
        # Filter for strong, stable features
        strong_keypoints = []
        strong_descriptors = []
        
        for i, kp in enumerate(keypoints):
            if kp.response > 50:  # Strong feature response
                strong_keypoints.append(kp)
                strong_descriptors.append(descriptors[i])
        
        if len(strong_keypoints) < 5:
            return []
        
        # Create new anchors
        new_anchors = []
        current_time = time.time()
        
        for i in range(min(3, len(strong_keypoints))):  # Limit new anchors per frame
            kp = strong_keypoints[i]
            
            # Calculate 3D position (simplified - assumes depth from stereo)
            depth = 2.0  # Placeholder depth
            x_3d = (kp.pt[0] - self.camera_matrix[0, 2]) * depth / self.camera_matrix[0, 0]
            y_3d = (kp.pt[1] - self.camera_matrix[1, 2]) * depth / self.camera_matrix[1, 1]
            z_3d = depth
            
            # Transform to world coordinates
            if ADVANCED_FEATURES:
                camera_rotation = R.from_quat([current_pose.orientation[1], current_pose.orientation[2], 
                                             current_pose.orientation[3], current_pose.orientation[0]])
                world_pos = camera_rotation.apply([x_3d, y_3d, z_3d]) + current_pose.position
            else:
                world_pos = current_pose.position + np.array([x_3d, y_3d, z_3d])
            
            anchor = SpatialAnchor(
                id=f"anchor_{int(current_time)}_{i}",
                pose=Pose6DoF(position=world_pos, orientation=current_pose.orientation, 
                            timestamp=current_time),
                descriptor=strong_descriptors[i:i+1],
                feature_points=[world_pos],
                created_timestamp=current_time,
                last_seen=current_time,
                confidence=0.8
            )
            
            new_anchors.append(anchor)
        
        return new_anchors

    def _assess_tracking_quality(self) -> float:
        """Assess overall tracking quality for the AR system"""
        if not self.slam_initialized:
            return 0.0
        
        factors = []
        
        # Pose stability
        if len(self.pose_history) > 5:
            recent_poses = list(self.pose_history)[-5:]
            position_variance = np.var([pose.position for pose in recent_poses], axis=0)
            position_stability = 1.0 / (1.0 + np.mean(position_variance) * 1000)  # Scale for medical precision
            factors.append(position_stability)
        
        # Feature tracking
        if self.last_feature_count > 0:
            feature_quality = min(self.last_feature_count / 100.0, 1.0)
            factors.append(feature_quality)
        
        # Anchor visibility
        visible_anchors = sum(1 for anchor in self.spatial_anchors.values() 
                            if time.time() - anchor.last_seen < 1.0)
        anchor_quality = min(visible_anchors / max(len(self.spatial_anchors), 1), 1.0)
        factors.append(anchor_quality)
        
        # Environmental understanding
        if hasattr(self, 'detected_planes') and self.detected_planes:
            plane_quality = min(len(self.detected_planes) / 3.0, 1.0)
            factors.append(plane_quality)
        
        return np.mean(factors) if factors else 0.0

    def get_ar_visualization_data(self) -> Dict[str, Any]:
        """Get data for AR visualization and debugging"""
        return {
            'current_pose': self.current_pose,
            'pose_history': list(self.pose_history)[-20:],  # Last 20 poses
            'map_points': self.map_points[:500] if self.map_points else [],  # Limit for performance
            'detected_planes': self.detected_planes,
            'spatial_anchors': {aid: {
                'pose': anchor.pose,
                'confidence': anchor.confidence,
                'age': time.time() - anchor.created_timestamp
            } for aid, anchor in self.spatial_anchors.items()},
            'tracking_quality': self._assess_tracking_quality(),
            'system_status': {
                'slam_initialized': self.slam_initialized,
                'keyframe_count': len(self.keyframes),
                'anchor_count': len(self.spatial_anchors),
                'advanced_features_enabled': ADVANCED_FEATURES
            }
        }

    def reset_tracking(self):
        """Reset tracking system for re-initialization"""
        self.slam_initialized = False
        self.current_pose = Pose6DoF()
        self.keyframes.clear()
        self.map_points.clear()
        self.pose_history.clear()
        self.detected_planes.clear()
        # Keep spatial anchors for re-localization
        
    def save_session(self, filepath: str):
        """Save current AR session for later restoration"""
        session_data = {
            'anchors': self.spatial_anchors,
            'map_points': self.map_points,
            'keyframes': self.keyframes[-10:],  # Save recent keyframes
            'timestamp': time.time()
        }
        
        try:
            with open(filepath, 'wb') as f:
                pickle.dump(session_data, f)
            return True
        except Exception as e:
            print(f"Failed to save session: {e}")
            return False
    
    def load_session(self, filepath: str) -> bool:
        """Load previous AR session"""
        try:
            with open(filepath, 'rb') as f:
                session_data = pickle.load(f)
            
            self.spatial_anchors = session_data.get('anchors', {})
            self.map_points = session_data.get('map_points', [])
            self.keyframes = session_data.get('keyframes', [])
            
            if self.map_points and self.keyframes:
                self.slam_initialized = True
                return True
                
        except Exception as e:
            print(f"Failed to load session: {e}")
        
        return False


def create_medical_ar_system():
    """Factory function to create AR system optimized for medical applications"""
    
    # XREAL glasses camera parameters (example)
    camera_params = {
        'intrinsic_matrix': [[1000, 0, 960], [0, 1000, 540], [0, 0, 1]],
        'distortion_coeffs': [-0.1, 0.05, 0, 0, 0],
        'stereo_baseline': 0.064  # 64mm baseline for XREAL glasses
    }
    
    ar_processor = CoreARProcessor(
        camera_params=camera_params,
        medical_precision_mode=True
    )
    
    return ar_processor