#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Medical AR Demo Application

This demonstrates the Core AR functionality for medical/surgical guidance systems.
Simulates camera input and shows how to process AR data for medical applications.
"""

import numpy as np
import time
from ar_core import CoreARProcessor, create_medical_ar_system

# Handle optional opencv dependency gracefully
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("Warning: OpenCV (cv2) not available. Some visualization features will be limited.")
    print("Install with: pip install opencv-python")


def simulate_camera_frames():
    """Simulate stereo camera frames from XREAL glasses"""
    # Create synthetic stereo frames (in practice, these come from hardware)
    height, width = 1080, 1920  # XREAL glasses resolution
    
    left_frame = np.random.randint(0, 255, (height, width, 3), dtype=np.uint8)
    right_frame = np.random.randint(0, 255, (height, width, 3), dtype=np.uint8)
    
    # Add some synthetic features for testing if OpenCV is available
    if CV2_AVAILABLE:
        # Draw some rectangles and circles as features
        cv2.rectangle(left_frame, (400, 300), (600, 500), (255, 255, 255), 2)
        cv2.circle(left_frame, (800, 400), 50, (0, 255, 0), -1)
        cv2.rectangle(right_frame, (390, 300), (590, 500), (255, 255, 255), 2)  # Slight disparity
        cv2.circle(right_frame, (790, 400), 50, (0, 255, 0), -1)  # Slight disparity
    else:
        # Simple pattern without OpenCV - just add some basic patterns using numpy
        left_frame[300:500, 400:600] = [255, 255, 255]  # White rectangle
        right_frame[300:500, 390:590] = [255, 255, 255]  # Slightly offset
    
    return left_frame, right_frame


def simulate_imu_data():
    """Simulate IMU sensor data"""
    return {
        'accel': [0.1, -9.81, 0.2],  # Accelerometer (m/s²)
        'gyro': [0.01, 0.02, 0.01]   # Gyroscope (rad/s)
    }


def display_ar_results(results):
    """Display AR processing results in a formatted way"""
    print("=" * 60)
    print("AR PROCESSING RESULTS")
    print("=" * 60)
    
    # Pose information
    if results['pose_6dof'] and 'pose' in results['pose_6dof']:
        pose = results['pose_6dof']['pose']
        print(f"📍 6DoF POSE:")
        print(f"   Position: [{pose.position[0]:.3f}, {pose.position[1]:.3f}, {pose.position[2]:.3f}]")
        print(f"   Orientation (quat): [{pose.orientation[0]:.3f}, {pose.orientation[1]:.3f}, {pose.orientation[2]:.3f}, {pose.orientation[3]:.3f}]")
        print(f"   Confidence: {pose.confidence:.2f}")
        print(f"   Status: {results['pose_6dof'].get('status', 'unknown')}")
    
    # Tracking quality
    print(f"\n🎯 TRACKING QUALITY: {results['tracking_quality']:.2f}")
    
    # Environmental understanding
    planes = results.get('detected_planes', [])
    print(f"\n🏢 DETECTED PLANES: {len(planes)}")
    for i, plane in enumerate(planes[:3]):  # Show first 3 planes
        print(f"   Plane {i+1}: {plane.plane_type} (confidence: {plane.confidence:.2f})")
    
    # Spatial anchors
    anchors = results.get('spatial_anchors', [])
    print(f"\n⚓ SPATIAL ANCHORS: {len(anchors)}")
    for anchor in anchors[:3]:  # Show first 3 anchors
        print(f"   {anchor['id']}: confidence {anchor['confidence']:.2f}, visible: {anchor['visible']}")
    
    # Environmental mesh
    if results.get('environmental_mesh'):
        mesh = results['environmental_mesh']
        print(f"\n🌐 ENVIRONMENTAL MESH:")
        print(f"   Vertices: {len(mesh.vertices)}")
        print(f"   Faces: {len(mesh.faces)}")
    
    print(f"\n⏱️  Processing time: {results['processing_time']:.3f}s")
    print("-" * 60)


def medical_guidance_simulation():
    """Simulate medical guidance scenario"""
    print("🏥 MEDICAL AR GUIDANCE SYSTEM")
    print("Initializing AR system for surgical guidance...")
    
    # Create medical-grade AR system
    ar_processor = create_medical_ar_system()
    
    print("✅ AR System initialized")
    print("📹 Starting camera processing simulation...")
    
    # Simulate processing loop
    for frame_num in range(10):
        print(f"\n📋 Processing frame {frame_num + 1}/10")
        
        # Get simulated camera data
        left_frame, right_frame = simulate_camera_frames()
        imu_data = simulate_imu_data()
        timestamp = time.time()
        
        # Process AR data
        results = ar_processor.process_camera_footage(
            left_frame, right_frame, imu_data, timestamp
        )
        
        # Display results
        display_ar_results(results)
        
        # Medical-specific checks
        tracking_quality = results['tracking_quality']
        if tracking_quality > 0.8:
            print("✅ MEDICAL PRECISION: Suitable for surgical guidance")
        elif tracking_quality > 0.6:
            print("⚠️  MEDICAL PRECISION: Moderate quality - proceed with caution")
        else:
            print("❌ MEDICAL PRECISION: Insufficient for surgical use")
        
        # Simulate processing at 30 FPS
        time.sleep(0.033)
    
    # Show system statistics
    viz_data = ar_processor.get_ar_visualization_data()
    print("\n📊 SYSTEM STATISTICS:")
    print(f"   SLAM Initialized: {viz_data['system_status']['slam_initialized']}")
    print(f"   Keyframes: {viz_data['system_status']['keyframe_count']}")
    print(f"   Anchors: {viz_data['system_status']['anchor_count']}")
    print(f"   Advanced Features: {viz_data['system_status']['advanced_features_enabled']}")
    
    # Save session
    session_path = "medical_ar_session.pkl"
    if ar_processor.save_session(session_path):
        print(f"✅ Session saved to {session_path}")
    
    print("\n🎉 Medical AR demo completed!")


def test_ar_components():
    """Test individual AR components"""
    print("\n🧪 TESTING AR COMPONENTS")
    
    # Test data structures
    from ar_core.data_structures import Pose6DoF, PlaneInfo
    
    # Test Pose6DoF
    pose = Pose6DoF(
        position=np.array([1.0, 2.0, 3.0]),
        orientation=np.array([1.0, 0.0, 0.0, 0.0])
    )
    print(f"✅ Pose6DoF created: {pose.to_dict()}")
    
    # Test PlaneInfo
    plane = PlaneInfo(
        normal=np.array([0, 1, 0]),
        centroid=np.array([0, 0, 0]),
        boundaries=np.array([[0, 0, 0], [1, 0, 1]]),
        area=1.0,
        plane_type='horizontal',
        confidence=0.9
    )
    print(f"✅ PlaneInfo created: {plane.plane_type} plane")
    
    print("✅ All component tests passed!")


if __name__ == "__main__":
    print("🔬 HACKMIT - Medical AR System Demo")
    print("===================================")
    
    try:
        # Run component tests
        test_ar_components()
        
        # Run medical guidance simulation
        medical_guidance_simulation()
        
    except KeyboardInterrupt:
        print("\n⏹️  Demo interrupted by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("Make sure to install requirements: pip install -r requirements.txt")
    
    print("\n👋 Demo finished!")