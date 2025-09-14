"""
AR Core Module for Medical/Surgical Guidance Systems

This module provides advanced AR processing capabilities including:
- 6DoF SLAM tracking
- Environmental understanding
- Spatial anchor management
- Medical-grade precision processing
- Enhanced object detection and tracking for medical environments
"""

# Import data structures first (they have no heavy dependencies)
from .data_structures import Pose6DoF, SpatialAnchor, PlaneInfo, EnvironmentalMesh

# Import processor with dependency check
try:
    from .core_ar_processor import CoreARProcessor, create_medical_ar_system
    _PROCESSOR_AVAILABLE = True
except ImportError as e:
    print(f"Warning: CoreARProcessor not available due to missing dependencies: {e}")
    print("Install dependencies with: pip install -r requirements.txt")
    _PROCESSOR_AVAILABLE = False
    
    # Create placeholder functions
    def CoreARProcessor(*args, **kwargs):
        raise ImportError("CoreARProcessor requires opencv-python, numpy, and other dependencies. Run: pip install -r requirements.txt")
    
    def create_medical_ar_system(*args, **kwargs):
        raise ImportError("create_medical_ar_system requires opencv-python, numpy, and other dependencies. Run: pip install -r requirements.txt")

# Import enhanced medical tracking
try:
    from .medical_tracking import MedicalARTracker, ObjectTracker, Detection3D, TrackingResult
    _MEDICAL_TRACKING_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Enhanced medical tracking features limited: {e}")
    _MEDICAL_TRACKING_AVAILABLE = False


class EnhancedMedicalARProcessor:
    """Enhanced AR processor with medical object tracking capabilities"""
    
    def __init__(self, camera_params=None, medical_precision_mode=True):
        if not _PROCESSOR_AVAILABLE:
            raise ImportError("Enhanced Medical AR Processor requires opencv-python, numpy, and other dependencies. Run: pip install -r requirements.txt")
        
        # Base AR processor (the original function doesn't take parameters)
        self.base_processor = create_medical_ar_system()
        
        # Enhanced medical tracking
        if _MEDICAL_TRACKING_AVAILABLE:
            self.medical_tracker = MedicalARTracker(
                camera_params or self._get_default_camera_params(),
                medical_mode=medical_precision_mode
            )
        else:
            self.medical_tracker = None
            print("Warning: Enhanced medical tracking not available")
    
    def process_camera_footage(self, left_frame, right_frame, imu_data, timestamp):
        """Process camera footage with enhanced medical tracking"""
        # Get base AR results
        base_results = self.base_processor.process_camera_footage(
            left_frame, right_frame, imu_data, timestamp
        )
        
        # Add enhanced medical tracking if available
        if self.medical_tracker:
            medical_results = self.medical_tracker.process_stereo_frame(
                left_frame, right_frame, imu_data, timestamp
            )
            
            # Merge results
            base_results.update({
                'tracked_objects': medical_results.get('tracked_objects', []),
                'anchor_positions': medical_results.get('anchor_positions', {}),
                'enhanced_tracking_quality': medical_results.get('tracking_quality', 0.0),
                'system_status': {
                    **base_results.get('system_status', {}),
                    **medical_results.get('system_status', {})
                }
            })
        
        return base_results
    
    def create_manual_anchor(self, screen_pos, object_type="manual"):
        """Create manual spatial anchor at screen position"""
        if self.medical_tracker:
            return self.medical_tracker.create_manual_anchor(screen_pos, object_type)
        return None
    
    def remove_anchor(self, anchor_id):
        """Remove spatial anchor"""
        if self.medical_tracker:
            return self.medical_tracker.remove_anchor(anchor_id)
        return False
    
    def get_tracking_statistics(self):
        """Get detailed tracking statistics"""
        if self.medical_tracker:
            return self.medical_tracker.get_tracking_statistics()
        return {}
    
    def save_session(self, filepath):
        """Save tracking session"""
        if self.medical_tracker:
            return self.medical_tracker.save_session(filepath)
        return self.base_processor.save_session(filepath)
    
    def load_session(self, filepath):
        """Load tracking session"""
        if self.medical_tracker:
            return self.medical_tracker.load_session(filepath)
        return False
    
    def get_ar_visualization_data(self):
        """Get AR visualization data"""
        base_viz = self.base_processor.get_ar_visualization_data()
        
        if self.medical_tracker:
            medical_stats = self.medical_tracker.get_tracking_statistics()
            base_viz['system_status'].update({
                'medical_tracking_enabled': True,
                'tracker_count': medical_stats.get('total_trackers', 0),
                'anchor_count': medical_stats.get('total_anchors', 0)
            })
        
        return base_viz
    
    def _get_default_camera_params(self):
        """Get default camera parameters"""
        return {
            'intrinsic_matrix': [
                [800, 0, 320],
                [0, 800, 240], 
                [0, 0, 1]
            ],
            'distortion_coeffs': [0.1, -0.2, 0.0, 0.0, 0.0],
            'stereo_baseline': 0.064
        }


def create_enhanced_medical_ar_system(camera_params=None, medical_precision_mode=True):
    """
    Create an enhanced medical AR system with object tracking and spatial anchoring
    
    Args:
        camera_params: Camera calibration parameters
        medical_precision_mode: Enable sub-millimeter precision mode
        
    Returns:
        EnhancedMedicalARProcessor: Enhanced AR processor with medical object tracking
    """
    return EnhancedMedicalARProcessor(camera_params, medical_precision_mode)


__version__ = "1.0.0"
__all__ = [
    "CoreARProcessor", 
    "EnhancedMedicalARProcessor",
    "create_medical_ar_system", 
    "create_enhanced_medical_ar_system",
    "Pose6DoF", 
    "SpatialAnchor", 
    "PlaneInfo", 
    "EnvironmentalMesh"
]

# Add medical tracking components if available
if _MEDICAL_TRACKING_AVAILABLE:
    __all__.extend([
        "MedicalARTracker",
        "ObjectTracker", 
        "Detection3D",
        "TrackingResult"
    ])