#!/usr/bin/env python3
"""
Test AR Client
Simulates a field medic AR device connecting to the bridge service
"""

import asyncio
import websockets
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_ar_client():
    """Test AR client connection and annotation sharing"""
    bridge_url = "ws://localhost:8765"
    room_id = "4d0ccaa8-eaf6-4918-8383-4d62530c591f"
    
    try:
        logger.info(f"🔗 Connecting to WebRTC-AR bridge at {bridge_url}")
        
        async with websockets.connect(bridge_url) as websocket:
            logger.info("✅ Connected to bridge service")
            
            # Join the room
            join_message = {
                "type": "join_room",
                "roomId": room_id,
                "clientType": "ar_field_medic"
            }
            
            await websocket.send(json.dumps(join_message))
            logger.info(f"📱 Joined room: {room_id}")
            
            # Send a test annotation
            annotation_message = {
                "type": "annotation",
                "roomId": room_id,
                "annotation": {
                    "type": "arrow",
                    "position": {"x": 100, "y": 150},
                    "color": "red",
                    "size": 5,
                    "text": "Critical area - Field Medic"
                },
                "timestamp": asyncio.get_event_loop().time()
            }
            
            await websocket.send(json.dumps(annotation_message))
            logger.info("🎨 Sent test annotation to bridge")
            
            # Listen for responses for 30 seconds
            try:
                while True:
                    response = await asyncio.wait_for(websocket.recv(), timeout=30.0)
                    data = json.loads(response)
                    logger.info(f"📨 Received: {data}")
                    
            except asyncio.TimeoutError:
                logger.info("⏰ Test completed - no more messages received")
                
    except websockets.exceptions.ConnectionClosed:
        logger.info("🔌 Connection closed")
    except Exception as e:
        logger.error(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_ar_client())