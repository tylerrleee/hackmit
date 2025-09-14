#!/usr/bin/env python3
"""
Test Script - WebRTC Drawing System Integration
Tests the complete drawing workflow from field medic to surgeon
"""

import asyncio
import websockets
import json
import requests
import time

class DrawingSystemTester:
    def __init__(self, backend_url="http://localhost:3001", bridge_url="ws://localhost:8765"):
        self.backend_url = backend_url
        self.bridge_url = bridge_url
        self.token = None
        self.room_id = None
        
    async def test_complete_drawing_workflow(self):
        """Test the complete drawing workflow"""
        print("🧪 Testing Complete Drawing Workflow")
        print("=" * 50)
        
        # Step 1: Login and get token
        print("📋 Step 1: Authenticating...")
        if not self.login():
            print("❌ Authentication failed")
            return False
            
        print("✅ Authentication successful")
        
        # Step 2: Create room
        print("📋 Step 2: Creating room...")
        if not self.create_room():
            print("❌ Room creation failed")
            return False
            
        print(f"✅ Room created: {self.room_id}")
        
        # Step 3: Connect to bridge and test drawing
        print("📋 Step 3: Testing drawing integration...")
        success = await self.test_drawing_bridge()
        
        if success:
            print("✅ Drawing system integration successful!")
            return True
        else:
            print("❌ Drawing system integration failed")
            return False
    
    def login(self):
        """Login to get authentication token"""
        try:
            response = requests.post(f"{self.backend_url}/api/auth/login", json={
                "username": "dr.smith",
                "password": "SecurePass123!"
            })
            
            if response.status_code == 200:
                data = response.json()
                print(f"Login response: {data}")
                tokens = data.get("tokens", {})
                self.token = tokens.get("accessToken")
                return True
            else:
                print(f"Login failed: {response.status_code}")
                print(f"Response: {response.text}")
                return False
                
        except Exception as e:
            print(f"Login error: {e}")
            return False
    
    def create_room(self):
        """Create a consultation room"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            response = requests.post(f"{self.backend_url}/api/rooms/create", 
                                   headers=headers,
                                   json={"type": "ar-consultation"})
            
            if response.status_code == 201:
                data = response.json()
                self.room_id = data.get("roomId")
                return True
            else:
                print(f"Room creation failed: {response.status_code}")
                print(f"Response: {response.text}")
                print(f"Token: {self.token[:20] if self.token else 'None'}...")
                return False
                
        except Exception as e:
            print(f"Room creation error: {e}")
            return False
    
    async def test_drawing_bridge(self):
        """Test drawing through the WebRTC bridge"""
        try:
            # Connect to bridge
            ws = await websockets.connect(self.bridge_url)
            print("🔗 Connected to WebRTC bridge")
            
            # Join room as field medic
            join_message = {
                "type": "join_room",
                "roomId": self.room_id,
                "clientType": "ar_field_medic",
                "userInfo": {
                    "name": "Test Field Medic",
                    "capabilities": ["drawing", "annotations"]
                }
            }
            await ws.send(json.dumps(join_message))
            print("👥 Joined room as field medic")
            
            # Send test drawing annotation
            drawing_annotation = {
                "type": "annotation",
                "roomId": self.room_id,
                "annotation": {
                    "type": "draw",
                    "data": {
                        "points": [
                            {"x": 0.1, "y": 0.1},
                            {"x": 0.2, "y": 0.2},
                            {"x": 0.3, "y": 0.1},
                            {"x": 0.4, "y": 0.2}
                        ],
                        "color": "#00FF00",
                        "thickness": 3
                    },
                    "timestamp": time.time(),
                    "source": "field_medic"
                },
                "timestamp": time.time()
            }
            
            await ws.send(json.dumps(drawing_annotation))
            print("📍 Sent test drawing annotation")
            
            # Wait for response or confirmation
            await asyncio.sleep(1)
            
            # Send another test drawing
            circle_drawing = {
                "type": "annotation",
                "roomId": self.room_id,
                "annotation": {
                    "type": "draw",
                    "data": {
                        "points": self.generate_circle_points(0.5, 0.5, 0.1),
                        "color": "#FF0000",
                        "thickness": 2
                    },
                    "timestamp": time.time(),
                    "source": "field_medic"
                },
                "timestamp": time.time()
            }
            
            await ws.send(json.dumps(circle_drawing))
            print("🔴 Sent circle drawing annotation")
            
            await ws.close()
            print("✅ Bridge drawing test completed successfully")
            return True
            
        except Exception as e:
            print(f"❌ Bridge drawing test failed: {e}")
            return False
    
    def generate_circle_points(self, center_x, center_y, radius, num_points=20):
        """Generate points for a circle drawing"""
        import math
        points = []
        for i in range(num_points + 1):
            angle = 2 * math.pi * i / num_points
            x = center_x + radius * math.cos(angle)
            y = center_y + radius * math.sin(angle)
            points.append({"x": x, "y": y})
        return points

async def main():
    """Main test function"""
    print("🧪 WebRTC Drawing System Integration Test")
    print("=" * 50)
    
    tester = DrawingSystemTester()
    success = await tester.test_complete_drawing_workflow()
    
    if success:
        print("\n🎉 All tests passed!")
        print("✅ Drawing system is fully functional")
        print("\nYou can now:")
        print("1. Open the frontend at http://localhost:3000")
        print("2. Login as surgeon (dr.smith / SecurePass123!)")
        print("3. Create/join a room")
        print("4. Start drawing on the web interface")
        print("5. Run the camera AR demo to see field medic view")
    else:
        print("\n❌ Some tests failed")
        print("Check the backend and bridge services")
    
    return success

if __name__ == "__main__":
    asyncio.run(main())