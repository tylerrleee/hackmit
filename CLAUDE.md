# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a HackMIT project implementing a Core AR (Augmented Reality) function for medical/surgical guidance systems using XREAL glasses. The system processes live camera footage to enable advanced spatial tracking and environmental understanding with medical-grade precision.

## Repository Structure

```
hackmit/
├── ar_core/                    # Core AR processing module
│   ├── __init__.py            # Module initialization
│   ├── core_ar_processor.py   # Main AR processor class
│   └── data_structures.py     # AR data types and structures
├── camera_ar_demo.py          # Real-time camera AR integration
├── medical_ar_demo.py         # Medical AR demonstration script
├── test_ar_core.py            # AR core functionality tests
├── requirements.txt           # Python dependencies
├── welcome.py                 # Project welcome and info script
└── CLAUDE.md                  # This file
```

## Key Components

### CoreARProcessor
The main AR processing class located in `ar_core/core_ar_processor.py` that provides:
- **6DoF SLAM Tracking**: Full 6 degrees of freedom pose tracking using visual SLAM
- **Environmental Understanding**: Plane detection, depth mesh generation, surface classification
- **Spatial Anchors**: Persistent anchor point management for AR content placement
- **Medical Precision**: Sub-millimeter accuracy suitable for surgical guidance

### Data Structures
Located in `ar_core/data_structures.py`:
- `Pose6DoF`: 6-degree-of-freedom pose representation
- `SpatialAnchor`: Persistent spatial anchor points
- `PlaneInfo`: Detected plane information
- `EnvironmentalMesh`: 3D environmental mesh data

## Development Commands

### Installation
```bash
pip install -r requirements.txt
```

### Running the System
```bash
# Show project information and check dependencies
python welcome.py

# Run the medical AR demonstration (simulated data)
python medical_ar_demo.py

# Run with real camera input (recommended)
python camera_ar_demo.py
```

### Using the AR Core
```python
from ar_core import CoreARProcessor, create_medical_ar_system

# Create medical-grade AR system
ar_processor = create_medical_ar_system()

# Process camera footage
results = ar_processor.process_camera_footage(
    left_frame, right_frame, imu_data, timestamp
)
```

## Architecture Notes

### Medical-Grade Requirements
- Sub-millimeter precision for surgical guidance
- Real-time performance (30+ FPS)
- Robust tracking under dynamic lighting
- XREAL glasses integration

### Technical Features
- Stereo visual SLAM with ORB features
- IMU sensor fusion for stability
- RANSAC-based plane detection
- Bundle adjustment for precision
- Persistent anchor management with re-localization

### Performance Optimizations
- Multi-threaded processing pipeline
- Frame buffering and caching
- Adaptive feature detection
- Medical precision mode with enhanced algorithms

## Dependencies

### Core Requirements
- `numpy>=1.24.0` - Numerical computing
- `opencv-python>=4.8.0` - Computer vision algorithms
- `scipy>=1.10.0` - Scientific computing (advanced features)
- `scikit-learn>=1.3.0` - Machine learning utilities
- `open3d>=0.17.0` - 3D data processing

### Graceful Degradation
The system detects missing optional dependencies and disables advanced features while maintaining core functionality.

## Current Branch

The repository is on the `LAB5` branch for HackMIT lab work.

## Medical AR Use Cases

This system is designed for:
- Surgical navigation and guidance
- Instrument tracking and placement
- Anatomical overlay visualization  
- Real-time surgical assistance
- Training and education applications