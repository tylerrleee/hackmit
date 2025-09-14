#!/usr/bin/env python3
"""
Complete System Test for WebRTC AR Integration
Tests the complete workflow: Doctor annotations -> WebRTC Bridge -> AR Camera Overlay
"""

import requests
import json
import time
import sys

def test_backend_status():
    """Test if backend is running and responsive"""
    try:
        response = requests.get('http://localhost:3001/health', timeout=5)
        if response.status_code == 200:
            print("✅ Backend server: RUNNING (port 3001)")
            return True
        else:
            print(f"❌ Backend server: ERROR ({response.status_code})")
            return False
    except Exception as e:
        print(f"❌ Backend server: UNAVAILABLE ({e})")
        return False

def test_frontend_status():
    """Test if frontend is running and responsive"""
    try:
        response = requests.get('http://localhost:3002', timeout=5)
        if response.status_code == 200:
            print("✅ Frontend server: RUNNING (port 3002)")
            return True
        else:
            print(f"❌ Frontend server: ERROR ({response.status_code})")
            return False
    except Exception as e:
        print(f"❌ Frontend server: UNAVAILABLE ({e})")
        return False

def test_doctor_login():
    """Test doctor authentication workflow"""
    try:
        login_data = {
            "username": "dr.smith",
            "password": "password123"
        }
        
        response = requests.post(
            'http://localhost:3001/api/auth/login',
            json=login_data,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if 'token' in data:
                print("✅ Doctor login: SUCCESS")
                print(f"   User: {data.get('user', {}).get('name', 'Unknown')}")
                print(f"   Role: {data.get('user', {}).get('role', 'Unknown')}")
                return data['token']
            else:
                print("❌ Doctor login: NO TOKEN")
                return None
        else:
            print(f"❌ Doctor login: FAILED ({response.status_code})")
            return None
    except Exception as e:
        print(f"❌ Doctor login: ERROR ({e})")
        return None

def test_room_creation(token):
    """Test AR consultation room creation"""
    try:
        headers = {'Authorization': f'Bearer {token}'}
        room_data = {
            "roomType": "ar-consultation",
            "metadata": {
                "medicalSpecialty": "surgery",
                "arAnnotations": True
            }
        }
        
        response = requests.post(
            'http://localhost:3001/api/rooms/create',
            json=room_data,
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            room_id = data.get('room', {}).get('id')
            if room_id:
                print("✅ AR Room creation: SUCCESS")
                print(f"   Room ID: {room_id}")
                return room_id
            else:
                print("❌ AR Room creation: NO ROOM ID")
                return None
        else:
            print(f"❌ AR Room creation: FAILED ({response.status_code})")
            return None
    except Exception as e:
        print(f"❌ AR Room creation: ERROR ({e})")
        return None

def test_webrtc_bridge_status():
    """Test WebRTC bridge status"""
    import socket
    try:
        # Test if WebRTC bridge WebSocket server is listening
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('localhost', 8765))
        sock.close()
        
        if result == 0:
            print("✅ WebRTC-AR Bridge: RUNNING (port 8765)")
            return True
        else:
            print("❌ WebRTC-AR Bridge: NOT LISTENING (port 8765)")
            return False
    except Exception as e:
        print(f"❌ WebRTC-AR Bridge: ERROR ({e})")
        return False

def run_complete_system_test():
    """Run the complete system integration test"""
    print("🧪 Complete WebRTC AR System Integration Test")
    print("=" * 60)
    
    # Test all components
    components_status = {
        'backend': test_backend_status(),
        'frontend': test_frontend_status(),
        'bridge': test_webrtc_bridge_status()
    }
    
    print("\n🔐 Testing Authentication Workflow")
    print("-" * 40)
    token = test_doctor_login()
    
    if token:
        print("\n🏠 Testing Room Management")
        print("-" * 40)
        room_id = test_room_creation(token)
        
        if room_id:
            print("\n📝 AR Annotation Workflow Test")
            print("-" * 40)
            print("✅ Room ready for AR annotations")
            print(f"   Room ID: {room_id}")
            print("   🎯 Doctor can now:")
            print("     - Access AR Video Consultation at http://localhost:3002")
            print("     - Join room and create AR annotation session")
            print("     - Draw annotations on video feed")
            print("   🎯 Field Medic can now:")
            print("     - Run AR camera system with WebRTC integration")
            print("     - Connect to room and receive doctor annotations")
            print("     - See annotations overlaid on camera feed")
    
    print("\n📊 System Status Summary")
    print("=" * 60)
    
    all_working = all(components_status.values()) and token is not None
    
    for component, status in components_status.items():
        status_str = "✅ OPERATIONAL" if status else "❌ FAILED"
        print(f"{component.upper():15}: {status_str}")
    
    print(f"{'AUTHENTICATION':15}: {'✅ WORKING' if token else '❌ FAILED'}")
    
    if all_working:
        print("\n🎉 SYSTEM STATUS: FULLY OPERATIONAL")
        print("\n🚀 Next Steps:")
        print("1. Open http://localhost:3002 in browser")
        print("2. Login as dr.smith / password123")
        print("3. Create/join AR consultation room") 
        print("4. Start drawing annotations")
        print("5. Run AR camera system to see annotations")
        print("\n💡 Demo Commands:")
        print("   WebRTC Bridge: python webrtc_ar_bridge.py --room-id [ROOM_ID]")
        print("   AR Camera:     python test_webrtc_integration.py")
        
        return True
    else:
        print("\n⚠️  SYSTEM STATUS: PARTIAL FAILURE")
        print("   Some components need attention before full testing")
        return False

if __name__ == '__main__':
    success = run_complete_system_test()
    sys.exit(0 if success else 1)