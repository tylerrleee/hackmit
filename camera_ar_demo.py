#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Direct Camera Integration for Medical AR System

This script demonstrates real-time camera integration with the AR system.
Supports both stereo camera setups and single camera with side-by-side stereo.
"""

import numpy as np
import time
import sys
import os
from ar_core import CoreARProcessor, create_medical_ar_system

# Handle optional opencv dependency gracefully
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("Error: OpenCV (cv2) is required for camera integration.")
    print("Install with: pip install opencv-python")
    sys.exit(1)


class CameraARSystem:
    """Real-time camera integration for AR processing with interactive drawing"""
    
    def __init__(self, camera_mode='single', left_camera_id=0, right_camera_id=1):
        """
        Initialize camera AR system
        
        Args:
            camera_mode: 'single' for single camera with stereo split, 'stereo' for two cameras
            left_camera_id: Camera ID for left camera (or main camera in single mode)
            right_camera_id: Camera ID for right camera (only used in stereo mode)
        """
        self.camera_mode = camera_mode
        self.left_camera_id = left_camera_id
        self.right_camera_id = right_camera_id
        
        # Initialize cameras
        self.left_camera = None
        self.right_camera = None
        self.single_camera = None
        
        # AR processor
        self.ar_processor = None
        
        # Frame dimensions
        self.frame_width = 640
        self.frame_height = 480
        
        # Performance tracking
        self.fps_counter = 0
        self.fps_start_time = time.time()
        self.current_fps = 0
        
        # Drawing system
        self.drawing_points = []  # List of drawing points
        self.drawing_lines = []   # List of connected lines
        self.current_line = []    # Current line being drawn
        self.drawing_mode = True
        self.drawing_color = (0, 255, 0)  # Green by default
        self.drawing_thickness = 3
        self.drawing_colors = [
            (0, 255, 0),    # Green
            (255, 0, 0),    # Blue  
            (0, 0, 255),    # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
            (255, 255, 255) # White
        ]
        self.current_color_index = 0
        
        # Mouse state
        self.mouse_drawing = False
        self.last_mouse_pos = None
        
        print(f"Initializing camera system in {camera_mode} mode...")
        
    def initialize_cameras(self):
        """Initialize camera hardware"""
        try:
            if self.camera_mode == 'stereo':
                # Two separate cameras
                self.left_camera = cv2.VideoCapture(self.left_camera_id)
                self.right_camera = cv2.VideoCapture(self.right_camera_id)
                
                if not self.left_camera.isOpened() or not self.right_camera.isOpened():
                    raise Exception("Could not open stereo cameras")
                
                # Set camera properties
                for camera in [self.left_camera, self.right_camera]:
                    camera.set(cv2.CAP_PROP_FRAME_WIDTH, self.frame_width)
                    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, self.frame_height)
                    camera.set(cv2.CAP_PROP_FPS, 30)
                
                print("✅ Stereo cameras initialized")
                
            else:  # single camera mode
                self.single_camera = cv2.VideoCapture(self.left_camera_id)
                
                if not self.single_camera.isOpened():
                    raise Exception(f"Could not open camera {self.left_camera_id}")
                
                # Set camera properties (double width for side-by-side stereo)
                self.single_camera.set(cv2.CAP_PROP_FRAME_WIDTH, self.frame_width * 2)
                self.single_camera.set(cv2.CAP_PROP_FRAME_HEIGHT, self.frame_height)
                self.single_camera.set(cv2.CAP_PROP_FPS, 30)
                
                print("✅ Single camera initialized (stereo split mode)")
                
            return True
            
        except Exception as e:
            print(f"❌ Camera initialization failed: {e}")
            return False
    
    def initialize_ar_system(self):
        """Initialize the AR processing system"""
        try:
            self.ar_processor = create_medical_ar_system()
            print("✅ AR system initialized")
            return True
        except Exception as e:
            print(f"❌ AR system initialization failed: {e}")
            print("Make sure to install requirements: pip install -r requirements.txt")
            return False
    
    def get_camera_frames(self):
        """Capture frames from cameras"""
        if self.camera_mode == 'stereo':
            ret_l, left_frame = self.left_camera.read()
            ret_r, right_frame = self.right_camera.read()
            
            if not (ret_l and ret_r):
                return None, None
                
            return left_frame, right_frame
        
        else:  # single camera mode
            ret, frame = self.single_camera.read()
            
            if not ret:
                return None, None
            
            # Split the frame into left and right
            height, width = frame.shape[:2]
            left_frame = frame[:, :width//2]
            right_frame = frame[:, width//2:]
            
            return left_frame, right_frame
    
    def simulate_imu_data(self):
        """
        Simulate IMU data - replace this with real IMU sensor integration
        For XREAL glasses, this would come from their SDK
        """
        return {
            'accel': [0.1, -9.81, 0.2],  # Accelerometer (m/s²)
            'gyro': [0.01, 0.02, 0.01]   # Gyroscope (rad/s)
        }
    
    def mouse_callback(self, event, x, y, flags, param):
        """Handle mouse events for drawing"""
        if not self.drawing_mode:
            return
            
        if event == cv2.EVENT_LBUTTONDOWN:
            # Start drawing
            self.mouse_drawing = True
            self.current_line = [(x, y)]
            self.last_mouse_pos = (x, y)
            
        elif event == cv2.EVENT_MOUSEMOVE:
            # Continue drawing
            if self.mouse_drawing:
                self.current_line.append((x, y))
                self.last_mouse_pos = (x, y)
                
        elif event == cv2.EVENT_LBUTTONUP:
            # Finish drawing
            self.mouse_drawing = False
            if len(self.current_line) > 1:
                # Save the completed line
                self.drawing_lines.append({
                    'points': self.current_line.copy(),
                    'color': self.drawing_color,
                    'thickness': self.drawing_thickness
                })
            self.current_line = []
            self.last_mouse_pos = None
    
    def cycle_drawing_color(self):
        """Cycle through available drawing colors"""
        self.current_color_index = (self.current_color_index + 1) % len(self.drawing_colors)
        self.drawing_color = self.drawing_colors[self.current_color_index]
    
    def clear_drawings(self):
        """Clear all drawings"""
        self.drawing_lines.clear()
        self.current_line.clear()
        self.drawing_points.clear()
    
    def toggle_drawing_mode(self):
        """Toggle drawing mode on/off"""
        self.drawing_mode = not self.drawing_mode
        return self.drawing_mode
    
    def adjust_thickness(self, delta):
        """Adjust drawing thickness"""
        self.drawing_thickness = max(1, min(10, self.drawing_thickness + delta))
    
    def draw_overlay(self, frame):
        """Draw the interactive overlay on the frame"""
        overlay_frame = frame.copy()
        
        # Draw completed lines
        for line_data in self.drawing_lines:
            points = line_data['points']
            color = line_data['color']
            thickness = line_data['thickness']
            
            for i in range(1, len(points)):
                cv2.line(overlay_frame, points[i-1], points[i], color, thickness)
        
        # Draw current line being drawn
        if len(self.current_line) > 1:
            for i in range(1, len(self.current_line)):
                cv2.line(overlay_frame, self.current_line[i-1], self.current_line[i], 
                        self.drawing_color, self.drawing_thickness)
        
        # Draw crosshair at last mouse position when drawing
        if self.mouse_drawing and self.last_mouse_pos:
            x, y = self.last_mouse_pos
            cv2.drawMarker(overlay_frame, (x, y), self.drawing_color, 
                          cv2.MARKER_CROSS, 10, 2)
        
        return overlay_frame
    
    def update_fps(self):
        """Update FPS counter"""
        self.fps_counter += 1
        current_time = time.time()
        
        if current_time - self.fps_start_time >= 1.0:
            self.current_fps = self.fps_counter / (current_time - self.fps_start_time)
            self.fps_counter = 0
            self.fps_start_time = current_time
    
    def display_results(self, results, left_frame, right_frame):
        """Display AR results and camera frames with drawing overlay"""
        # Apply drawing overlay to the left frame
        display_frame = self.draw_overlay(left_frame)
        
        # Add FPS counter
        cv2.putText(display_frame, f'FPS: {self.current_fps:.1f}', 
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        # Add tracking quality
        tracking_quality = results.get('tracking_quality', 0.0)
        quality_color = (0, 255, 0) if tracking_quality > 0.8 else (0, 165, 255) if tracking_quality > 0.6 else (0, 0, 255)
        cv2.putText(display_frame, f'Quality: {tracking_quality:.2f}', 
                   (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1, quality_color, 2)
        
        # Add pose information
        if results['pose_6dof'] and 'pose' in results['pose_6dof']:
            pose = results['pose_6dof']['pose']
            pos_text = f'Pos: [{pose.position[0]:.2f}, {pose.position[1]:.2f}, {pose.position[2]:.2f}]'
            cv2.putText(display_frame, pos_text, 
                       (10, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        
        # Add detected planes count
        planes_count = len(results.get('detected_planes', []))
        cv2.putText(display_frame, f'Planes: {planes_count}', 
                   (10, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)
        
        # Drawing mode indicator
        mode_text = "DRAWING ON" if self.drawing_mode else "DRAWING OFF"
        mode_color = (0, 255, 0) if self.drawing_mode else (0, 0, 255)
        cv2.putText(display_frame, mode_text, 
                   (10, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.7, mode_color, 2)
        
        # Drawing color indicator
        if self.drawing_mode:
            color_names = ['GREEN', 'BLUE', 'RED', 'CYAN', 'MAGENTA', 'YELLOW', 'WHITE']
            current_color_name = color_names[self.current_color_index]
            cv2.putText(display_frame, f'Color: {current_color_name} (T:{self.drawing_thickness})', 
                       (10, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.6, self.drawing_color, 2)
            
            # Draw color swatch
            cv2.rectangle(display_frame, (200, 180), (240, 210), self.drawing_color, -1)
            cv2.rectangle(display_frame, (200, 180), (240, 210), (255, 255, 255), 1)
        
        # Drawing statistics
        if len(self.drawing_lines) > 0:
            cv2.putText(display_frame, f'Lines drawn: {len(self.drawing_lines)}', 
                       (10, 230), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        
        # Medical precision indicator
        precision_y = display_frame.shape[0] - 20
        if tracking_quality > 0.8:
            cv2.putText(display_frame, 'MEDICAL PRECISION: OK', 
                       (10, precision_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        elif tracking_quality > 0.6:
            cv2.putText(display_frame, 'MEDICAL PRECISION: CAUTION', 
                       (10, precision_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
        else:
            cv2.putText(display_frame, 'MEDICAL PRECISION: INSUFFICIENT', 
                       (10, precision_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        
        # Show frames
        cv2.imshow('Medical AR - Interactive Camera', display_frame)
        cv2.imshow('Medical AR - Right Camera', right_frame)
        
        # Set mouse callback for the main display window
        cv2.setMouseCallback('Medical AR - Interactive Camera', self.mouse_callback)
    
    def run(self):
        """Main processing loop"""
        print("🔬 Starting Medical AR Camera System")
        print("=" * 50)
        
        if not self.initialize_cameras():
            return False
        
        if not self.initialize_ar_system():
            self.cleanup()
            return False
        
        print("\n📹 Camera AR Interactive System is running!")
        print("Controls:")
        print("  - Left click and drag to draw on the camera feed")
        print("  - Press 'q' to quit")
        print("  - Press 's' to save current session")
        print("  - Press SPACE to pause/resume")
        print("  - Press 'd' to toggle drawing mode on/off")
        print("  - Press 'c' to cycle drawing colors")
        print("  - Press 'x' to clear all drawings")
        print("  - Press '+/-' to increase/decrease line thickness")
        print("\nProcessing frames...")
        
        paused = False
        frame_count = 0
        
        try:
            while True:
                if not paused:
                    # Get camera frames
                    left_frame, right_frame = self.get_camera_frames()
                    
                    if left_frame is None or right_frame is None:
                        print("❌ Failed to capture frames")
                        break
                    
                    # Get IMU data
                    imu_data = self.simulate_imu_data()
                    
                    # Process with AR system
                    timestamp = time.time()
                    results = self.ar_processor.process_camera_footage(
                        left_frame, right_frame, imu_data, timestamp
                    )
                    
                    # Update FPS
                    self.update_fps()
                    
                    # Display results
                    self.display_results(results, left_frame, right_frame)
                    
                    frame_count += 1
                    
                    # Print periodic updates
                    if frame_count % 30 == 0:
                        quality = results['tracking_quality']
                        planes = len(results.get('detected_planes', []))
                        print(f"Frame {frame_count}: Quality={quality:.2f}, Planes={planes}, FPS={self.current_fps:.1f}")
                
                # Handle keyboard input
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q'):
                    print("\n⏹️  Stopping camera AR system...")
                    break
                elif key == ord('s'):
                    self.save_session()
                elif key == ord(' '):
                    paused = not paused
                    status = "PAUSED" if paused else "RESUMED"
                    print(f"\n⏸️  {status}")
                elif key == ord('d'):
                    drawing_status = "ON" if self.toggle_drawing_mode() else "OFF"
                    print(f"🎨 Drawing mode: {drawing_status}")
                elif key == ord('c'):
                    self.cycle_drawing_color()
                    color_names = ['GREEN', 'BLUE', 'RED', 'CYAN', 'MAGENTA', 'YELLOW', 'WHITE']
                    print(f"🎨 Drawing color: {color_names[self.current_color_index]}")
                elif key == ord('x'):
                    self.clear_drawings()
                    print("🗑️  All drawings cleared")
                elif key == ord('+') or key == ord('='):
                    self.adjust_thickness(1)
                    print(f"📏 Line thickness: {self.drawing_thickness}")
                elif key == ord('-') or key == ord('_'):
                    self.adjust_thickness(-1)
                    print(f"📏 Line thickness: {self.drawing_thickness}")
        
        except KeyboardInterrupt:
            print("\n⏹️  Interrupted by user")
        
        except Exception as e:
            print(f"\n❌ Error during processing: {e}")
        
        finally:
            self.cleanup()
            print("👋 Camera AR system stopped")
            return True
    
    def save_session(self):
        """Save current AR session"""
        try:
            session_path = f"camera_ar_session_{int(time.time())}.pkl"
            if self.ar_processor.save_session(session_path):
                print(f"✅ Session saved to {session_path}")
            else:
                print("❌ Failed to save session")
        except Exception as e:
            print(f"❌ Error saving session: {e}")
    
    def cleanup(self):
        """Clean up resources"""
        if self.left_camera:
            self.left_camera.release()
        if self.right_camera:
            self.right_camera.release()
        if self.single_camera:
            self.single_camera.release()
        cv2.destroyAllWindows()


def main():
    """Main function"""
    print("🔬 Medical AR - Interactive Camera Integration")
    print("=" * 50)
    
    # Configuration options
    print("Camera configuration options:")
    print("1. Single camera (side-by-side stereo)")
    print("2. Dual cameras (separate left/right)")
    print("3. Auto-detect")
    
    try:
        choice = input("\nSelect option (1-3) [default: 1]: ").strip()
        if not choice:
            choice = '1'
        
        if choice == '2':
            camera_mode = 'stereo'
            left_id = int(input("Left camera ID [0]: ") or "0")
            right_id = int(input("Right camera ID [1]: ") or "1")
            camera_system = CameraARSystem('stereo', left_id, right_id)
        elif choice == '3':
            # Auto-detect available cameras
            print("Detecting available cameras...")
            available_cameras = []
            print("AVAILABLE_CAMERAS:" ,available_cameras)
            for i in range(4):  # Check first 4 camera indices
                cap = cv2.VideoCapture(i)
                if cap.isOpened():
                    available_cameras.append(i)
                    cap.release()
            
            print(f"Available cameras: {available_cameras}")
            if len(available_cameras) >= 2:
                camera_mode = 'stereo'
                camera_system = CameraARSystem('stereo', available_cameras[0], available_cameras[1])
                print(f"Using stereo mode with cameras {available_cameras[0]} and {available_cameras[1]}")
            elif len(available_cameras) >= 1:
                camera_mode = 'single'
                camera_system = CameraARSystem('single', available_cameras[0])
                print(f"Using single camera mode with camera {available_cameras[0]}")
            else:
                print("❌ No cameras detected")
                return
        else:  # Default: single camera
            camera_mode = 'single'
            camera_id = int(input("Camera ID [0]: ") or "0")
            camera_system = CameraARSystem('single', camera_id)
        
        print(f"\n🚀 Starting {camera_mode} camera AR system...")
        camera_system.run()
        
    except KeyboardInterrupt:
        print("\n⏹️  Setup interrupted by user")
    except ValueError:
        print("❌ Invalid input. Please enter a number.")
    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    main()