#!/usr/bin/env python3
"""
Demo: WebRTC AR Camera System
Runs the AR camera system without interactive prompts for easy testing
"""

import sys
import os
sys.path.append('/Users/tienle/Documents/Coding/hackmit')

from camera_ar_demo import CameraARSystem
import time

def main():
    print("🎥 Starting WebRTC AR Camera Demo")
    print("=" * 50)
    print("This demo will start the AR camera system and show:")
    print("✨ Real-time camera feed with AR tracking")
    print("🖊️  Doctor annotations overlay (when connected)")
    print("🔗 WebRTC integration for remote annotation sync")
    print()
    
    # Create AR system (without WebRTC for now to avoid connection issues)
    ar_system = CameraARSystem(
        camera_mode='single',
        left_camera_id=0,
        use_threading=True,
        target_fps=30,
        webrtc_enabled=False,  # Disable WebRTC to avoid connection issues for now
        room_id='test-room-123',
        bridge_url='ws://localhost:8765'
    )
    
    print("🔧 Initializing AR camera system...")
    
    try:
        # Initialize cameras
        if not ar_system.initialize_cameras():
            print("❌ Failed to initialize cameras")
            print("Make sure you have a camera connected (camera ID 0)")
            return False
        
        # Initialize AR system
        if not ar_system.initialize_ar_system():
            print("❌ Failed to initialize AR system")
            return False
        
        print("✅ AR Camera System initialized successfully!")
        print()
        print("📹 Camera Controls:")
        print("  - Left click and drag: Draw on camera feed")
        print("  - Press 'q' to quit")
        print("  - Press 'd' to toggle drawing mode")
        print("  - Press 'c' to cycle drawing colors")
        print("  - Press 'x' to clear all drawings")
        print("  - Press '+/-' to adjust line thickness")
        print()
        print("🚀 Starting AR camera system...")
        print("   (Camera window will open)")
        
        # Run the AR system
        return ar_system.run()
        
    except KeyboardInterrupt:
        print("\n⏹️  Demo stopped by user")
        return True
    except Exception as e:
        print(f"❌ Demo failed: {e}")
        print("\nTroubleshooting:")
        print("1. Make sure you have a camera connected")
        print("2. Check if another app is using the camera")
        print("3. Try running: pip install opencv-python")
        return False
    finally:
        ar_system.cleanup()
        print("🧹 Camera system cleaned up")

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)