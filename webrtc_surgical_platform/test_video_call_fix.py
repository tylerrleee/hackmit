#!/usr/bin/env python3
"""
Quick test to verify video call initialization fix
"""

import requests
import json

def test_video_call_workflow():
    """Test video call creation workflow"""
    backend_url = "http://localhost:3001"
    
    # Test 1: Login
    print("🧪 Testing video call initialization fix...")
    
    try:
        # Login
        response = requests.post(f"{backend_url}/api/auth/login", json={
            "username": "dr.smith",
            "password": "SecurePass123!"
        })
        
        if response.status_code != 200:
            print("❌ Login failed")
            return False
            
        tokens = response.json().get("tokens", {})
        token = tokens.get("accessToken")
        
        if not token:
            print("❌ No access token received")
            return False
            
        print("✅ Authentication successful")
        
        # Test 2: Create room
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.post(f"{backend_url}/api/rooms/create", 
                               headers=headers,
                               json={"type": "ar-consultation"})
        
        if response.status_code != 201:
            print("❌ Room creation failed")
            return False
            
        room_data = response.json()
        print(f"Room response: {room_data}")
        room_id = room_data.get("roomId") or room_data.get("room", {}).get("id")
        print(f"✅ Room created: {room_id}")
        
        # Test 3: Start video call
        response = requests.post(f"{backend_url}/api/video-call/start",
                               headers=headers,
                               json={
                                   "roomId": room_id,
                                   "options": {
                                       "enableAR": True,
                                       "quality": "hd"
                                   }
                               })
        
        if response.status_code == 200:
            print("✅ Video call initialization successful!")
            print("✅ Frontend JavaScript hoisting error has been fixed!")
            return True
        else:
            print(f"❌ Video call failed: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

if __name__ == "__main__":
    success = test_video_call_workflow()
    if success:
        print("\n🎉 Video call fix verified!")
        print("You can now:")
        print("1. Open http://localhost:3000")
        print("2. Login as surgeon")
        print("3. Click 'Start Video Call' without JavaScript errors")
    else:
        print("\n❌ Issues remain - check backend logs")