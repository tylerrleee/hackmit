"""
Data structures for AR Core system
"""

import numpy as np
import time
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Pose6DoF:
    """6 Degrees of Freedom pose representation"""
    position: np.ndarray = field(default_factory=lambda: np.zeros(3))  # x, y, z
    orientation: np.ndarray = field(default_factory=lambda: np.array([1, 0, 0, 0]))  # quaternion w, x, y, z
    timestamp: float = field(default_factory=time.time)
    confidence: float = 1.0

    def to_dict(self):
        """Convert to dictionary for serialization"""
        return {
            'position': self.position.tolist(),
            'orientation': self.orientation.tolist(),
            'timestamp': self.timestamp,
            'confidence': self.confidence
        }

    @classmethod
    def from_dict(cls, data):
        """Create from dictionary"""
        return cls(
            position=np.array(data['position']),
            orientation=np.array(data['orientation']),
            timestamp=data['timestamp'],
            confidence=data['confidence']
        )


@dataclass  
class SpatialAnchor:
    """Persistent spatial anchor point"""
    id: str
    pose: Pose6DoF
    descriptor: np.ndarray
    feature_points: List[np.ndarray]
    created_timestamp: float
    last_seen: float
    confidence: float = 1.0

    def to_dict(self):
        """Convert to dictionary for serialization"""
        return {
            'id': self.id,
            'pose': self.pose.to_dict(),
            'descriptor': self.descriptor.tolist(),
            'feature_points': [fp.tolist() for fp in self.feature_points],
            'created_timestamp': self.created_timestamp,
            'last_seen': self.last_seen,
            'confidence': self.confidence
        }


@dataclass
class PlaneInfo:
    """Detected plane information"""
    normal: np.ndarray
    centroid: np.ndarray
    boundaries: np.ndarray
    area: float
    plane_type: str  # 'horizontal', 'vertical', 'instrument_tray', 'wall'
    confidence: float

    def to_dict(self):
        """Convert to dictionary for serialization"""
        return {
            'normal': self.normal.tolist(),
            'centroid': self.centroid.tolist(),
            'boundaries': self.boundaries.tolist(),
            'area': self.area,
            'plane_type': self.plane_type,
            'confidence': self.confidence
        }


@dataclass
class EnvironmentalMesh:
    """3D environmental mesh data"""
    vertices: np.ndarray
    faces: np.ndarray
    normals: np.ndarray
    texture_coords: Optional[np.ndarray] = None
    confidence_map: Optional[np.ndarray] = None

    def to_dict(self):
        """Convert to dictionary for serialization"""
        result = {
            'vertices': self.vertices.tolist(),
            'faces': self.faces.tolist(),
            'normals': self.normals.tolist(),
        }
        if self.texture_coords is not None:
            result['texture_coords'] = self.texture_coords.tolist()
        if self.confidence_map is not None:
            result['confidence_map'] = self.confidence_map.tolist()
        return result