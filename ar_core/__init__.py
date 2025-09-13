"""
AR Core Module for Medical/Surgical Guidance Systems

This module provides advanced AR processing capabilities including:
- 6DoF SLAM tracking
- Environmental understanding
- Spatial anchor management
- Medical-grade precision processing
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

__version__ = "1.0.0"
__all__ = ["CoreARProcessor", "create_medical_ar_system", "Pose6DoF", "SpatialAnchor", "PlaneInfo", "EnvironmentalMesh"]