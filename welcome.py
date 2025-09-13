#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Welcome to HackMIT - Medical AR System

This project implements a Core AR (Augmented Reality) function that processes 
live camera footage to enable advanced spatial tracking and environmental 
understanding for AR applications, specifically designed for medical/surgical 
guidance systems using XREAL glasses.

Usage:
    python welcome.py - Shows this welcome message and project info
    python medical_ar_demo.py - Run the medical AR demonstration
"""

import sys
import os

# Add the current directory to Python path so we can import ar_core
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def show_welcome():
    """Display welcome message and project information"""
    print("*** Welcome to HackMIT - Medical AR System ***")
    print("=" * 50)
    print()
    print("PROJECT OVERVIEW:")
    print("   This project implements a comprehensive AR processing system")
    print("   for medical and surgical guidance applications using XREAL glasses.")
    print()
    print("KEY FEATURES:")
    print("   * 6DoF SLAM tracking with sub-millimeter precision")
    print("   * Real-time environmental understanding")
    print("   * Persistent spatial anchor management")
    print("   * Medical-grade performance optimization")
    print("   * Plane detection and surface classification")
    print("   * Dynamic 3D mesh generation for occlusion")
    print()
    print("GETTING STARTED:")
    print("   1. Install dependencies: pip install -r requirements.txt")
    print("   2. Run demo: python medical_ar_demo.py")
    print("   3. Explore ar_core/ module for implementation details")
    print()
    print("PROJECT STRUCTURE:")
    print("   * ar_core/               - Core AR processing module")
    print("   * medical_ar_demo.py     - Medical AR demonstration")
    print("   * requirements.txt       - Python dependencies")
    print("   * welcome.py             - This welcome script")
    print()
    print("TECHNICAL COMPONENTS:")
    print("   * CoreARProcessor        - Main AR processing class")
    print("   * 6DoF Pose Tracking     - SLAM-based spatial tracking")
    print("   * Environmental Mesh     - 3D scene understanding")
    print("   * Spatial Anchors        - Persistent AR markers")
    print("   * Surface Classification - Medical equipment detection")
    print()
    print("FOR MEDICAL APPLICATIONS:")
    print("   * Sub-millimeter precision for surgical guidance")
    print("   * Real-time performance suitable for OR environments")
    print("   * Robust tracking under dynamic lighting conditions")
    print("   * Instrument tray and surface detection")
    print()
    print("NEXT STEPS:")
    print("   Run 'python medical_ar_demo.py' to see the system in action!")
    print()

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import numpy
        import cv2
        print("[OK] Core dependencies (numpy, opencv) are available")
        
        try:
            import scipy
            import sklearn
            import open3d
            print("[OK] Advanced features (scipy, sklearn, open3d) are available")
            return True
        except ImportError:
            print("[WARNING] Some advanced features may be limited")
            print("   Install with: pip install -r requirements.txt")
            return False
            
    except ImportError as e:
        print(f"[ERROR] Missing core dependencies: {e}")
        print("   Install with: pip install -r requirements.txt")
        return False

if __name__ == "__main__":
    show_welcome()
    
    print("DEPENDENCY CHECK:")
    check_dependencies()
    
    print("\n" + "=" * 50)
    print("Ready to start your medical AR journey!")