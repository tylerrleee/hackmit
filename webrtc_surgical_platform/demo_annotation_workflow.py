#!/usr/bin/env python3
"""
Comprehensive AR Annotation Workflow Demo
Demonstrates real-time doctor-to-field-medic annotation sharing
"""

import asyncio
import websockets
import json
import time
import threading

class AnnotationWorkflowDemo:
    """Demonstrates the complete AR annotation workflow"""
    
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.bridge_url = "ws://localhost:8765"
        
        # Medical scenarios
        self.medical_scenarios = [
            {
                "name": "Emergency Cardiac Surgery",
                "annotations": [
                    {
                        "type": "arrow",
                        "position": {"x": 200, "y": 150},
                        "color": "red",
                        "size": 10,
                        "text": "CRITICAL: Bleeding from coronary artery",
                        "priority": "critical",
                        "timestamp": time.time(),
                        "source": "field_medic"
                    },
                    {
                        "type": "circle", 
                        "position": {"x": 180, "y": 130},
                        "color": "orange",
                        "size": 15,
                        "text": "Apply direct pressure here immediately",
                        "priority": "urgent",
                        "timestamp": time.time() + 1,
                        "source": "doctor_response"
                    },
                    {
                        "type": "line_drawing",
                        "points": [(160, 120), (180, 130), (200, 140), (220, 150)],
                        "color": "blue",
                        "thickness": 3,
                        "text": "Incision line for emergency access",
                        "priority": "high",
                        "timestamp": time.time() + 2,
                        "source": "doctor_guidance"
                    }
                ]
            },
            {
                "name": "Trauma Surgery Assessment",
                "annotations": [
                    {
                        "type": "text",
                        "position": {"x": 100, "y": 300},
                        "color": "green",
                        "text": "Patient vitals: BP 80/50, HR 140, O2 85%",
                        "priority": "high",
                        "timestamp": time.time(),
                        "source": "field_medic_data"
                    },
                    {
                        "type": "urgent_marker",
                        "position": {"x": 250, "y": 200},
                        "color": "red",
                        "size": 20,
                        "text": "URGENT: Signs of internal bleeding",
                        "priority": "critical",
                        "timestamp": time.time() + 1,
                        "source": "field_assessment"
                    },
                    {
                        "type": "arrow",
                        "position": {"x": 270, "y": 220},
                        "color": "gold",
                        "size": 8,
                        "text": "Doctor: Start IV fluids here, prep for transport",
                        "priority": "immediate",
                        "timestamp": time.time() + 2,
                        "source": "doctor_orders"
                    }
                ]
            }
        ]
    
    async def send_annotations_sequence(self, scenario):
        """Send a sequence of annotations for a medical scenario"""
        print(f"\n🏥 Starting scenario: {scenario['name']}")
        print("=" * 50)
        
        try:
            async with websockets.connect(self.bridge_url) as websocket:
                # Join the room as AR client
                await websocket.send(json.dumps({
                    'type': 'join_room',
                    'roomId': self.room_id,
                    'clientType': 'ar_field_medic'
                }))
                
                print(f"📱 AR client joined room {self.room_id}")
                
                # Send annotations in sequence with realistic timing
                for i, annotation in enumerate(scenario['annotations']):
                    # Wait between annotations to simulate realistic workflow
                    if i > 0:
                        await asyncio.sleep(2)
                    
                    # Send annotation to bridge
                    message = {
                        'type': 'annotation',
                        'roomId': self.room_id,
                        'annotation': annotation,
                        'timestamp': time.time(),
                        'source': annotation.get('source', 'ar_field_medic')
                    }
                    
                    await websocket.send(json.dumps(message))
                    
                    # Display what was sent
                    source_name = {
                        'field_medic': '👨‍⚕️ Field Medic',
                        'doctor_response': '👨‍⚕️ Doctor',
                        'doctor_guidance': '👨‍⚕️ Doctor',
                        'field_medic_data': '📊 Field Data',
                        'field_assessment': '🔬 Assessment',
                        'doctor_orders': '📋 Doctor Orders'
                    }.get(annotation.get('source', 'unknown'), '❓ Unknown')
                    
                    print(f"📤 {source_name}: {annotation.get('text', 'Annotation sent')}")
                    
                    # Show annotation details
                    print(f"   Type: {annotation['type']}")
                    print(f"   Priority: {annotation.get('priority', 'normal')}")
                    if annotation.get('position'):
                        pos = annotation['position']
                        print(f"   Position: ({pos['x']}, {pos['y']})")
                
                print(f"\n✅ Scenario '{scenario['name']}' completed")
                print("   All annotations sent to WebRTC platform")
                
        except Exception as e:
            print(f"❌ Error in annotation workflow: {e}")
    
    async def run_demo(self):
        """Run the complete annotation workflow demo"""
        print("🔬 AR Annotation Workflow Demonstration")
        print("=" * 60)
        print(f"Room ID: {self.room_id}")
        print(f"Bridge URL: {self.bridge_url}")
        print()
        print("This demo simulates a real emergency surgical consultation")
        print("where field medics and doctors collaborate using AR annotations.")
        print()
        
        # Run each medical scenario
        for scenario in self.medical_scenarios:
            await self.send_annotations_sequence(scenario)
            await asyncio.sleep(3)  # Pause between scenarios
        
        print("\n" + "=" * 60)
        print("🎉 AR Annotation Workflow Demo Complete!")
        print()
        print("📋 Summary of what happened:")
        print("  1. Field medic identified critical bleeding")
        print("  2. Doctor provided immediate guidance")
        print("  3. Visual annotations showed exact locations")
        print("  4. Real-time vitals monitoring")
        print("  5. Treatment orders synchronized instantly")
        print()
        print("🌐 All annotations were sent through the WebRTC bridge")
        print("   and would appear on both doctor's screen and AR glasses")

def main():
    # Use Dr. Smith's room for the demo
    room_id = "4ab42c71-2cf0-4074-8587-cabc3d670ea4"
    demo = AnnotationWorkflowDemo(room_id)
    
    # Run the demo
    asyncio.run(demo.run_demo())

if __name__ == "__main__":
    main()