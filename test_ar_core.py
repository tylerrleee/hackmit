#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script for AR Core module

This script tests the AR core functionality without requiring full dependencies.
"""

import sys
import os

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_data_structures():
    """Test the data structures without dependencies"""
    try:
        from ar_core.data_structures import Pose6DoF, SpatialAnchor, PlaneInfo, EnvironmentalMesh
        import numpy as np
        
        print("[TEST] Testing data structures...")
        
        # Test Pose6DoF
        pose = Pose6DoF(
            position=np.array([1.0, 2.0, 3.0]),
            orientation=np.array([1.0, 0.0, 0.0, 0.0])
        )
        print(f"[OK] Pose6DoF created: position={pose.position}, confidence={pose.confidence}")
        
        # Test serialization
        pose_dict = pose.to_dict()
        pose_restored = Pose6DoF.from_dict(pose_dict)
        print(f"[OK] Pose6DoF serialization works")
        
        # Test PlaneInfo
        plane = PlaneInfo(
            normal=np.array([0, 1, 0]),
            centroid=np.array([0, 0, 0]),
            boundaries=np.array([[0, 0, 0], [1, 0, 1]]),
            area=1.0,
            plane_type='horizontal',
            confidence=0.9
        )
        print(f"[OK] PlaneInfo created: type={plane.plane_type}, area={plane.area}")
        
        print("[SUCCESS] All data structure tests passed!")
        return True
        
    except ImportError as e:
        print(f"[ERROR] Could not import data structures: {e}")
        return False
    except Exception as e:
        print(f"[ERROR] Data structure test failed: {e}")
        return False

def test_module_structure():
    """Test that the module structure is correct"""
    try:
        import ar_core
        print("[OK] ar_core module can be imported")
        
        # Check if __all__ is properly defined
        if hasattr(ar_core, '__version__'):
            print(f"[OK] Module version: {ar_core.__version__}")
        
        print("[SUCCESS] Module structure test passed!")
        return True
        
    except Exception as e:
        print(f"[ERROR] Module structure test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("AR CORE MODULE TESTS")
    print("=" * 60)
    
    tests_passed = 0
    total_tests = 2
    
    # Test data structures
    if test_data_structures():
        tests_passed += 1
    
    print()
    
    # Test module structure
    if test_module_structure():
        tests_passed += 1
    
    print()
    print("=" * 60)
    print(f"RESULTS: {tests_passed}/{total_tests} tests passed")
    
    if tests_passed == total_tests:
        print("[SUCCESS] All tests passed! AR Core module is ready.")
        print("Next: Install dependencies with 'pip install -r requirements.txt'")
    else:
        print("[FAILURE] Some tests failed. Please check the errors above.")
    
    print("=" * 60)
    
    return tests_passed == total_tests

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)