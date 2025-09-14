const express = require('express');

function createRoomRoutes(roomManager, authService) {
    const router = express.Router();

    // Create a new room
    router.post('/create', authService.authenticate, async (req, res) => {
        try {
            const {
                roomType = 'consultation',
                maxParticipants = 10,
                isPrivate = false,
                metadata = {},
                expiresIn
            } = req.body;

            const userInfo = {
                userId: req.user.id,
                userName: req.user.name,
                userRole: req.user.role
            };

            const room = await roomManager.createRoom(userInfo, {
                roomType,
                maxParticipants,
                isPrivate,
                metadata,
                expiresIn
            });

            res.status(201).json({
                success: true,
                room: {
                    id: room.id,
                    type: room.type,
                    createdAt: room.createdAt,
                    expiresAt: room.expiresAt,
                    maxParticipants: room.maxParticipants,
                    isPrivate: room.isPrivate,
                    metadata: room.metadata,
                    participantCount: room.participants.length
                }
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get room information
    router.get('/:roomId', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const roomInfo = await roomManager.getRoomInfo(roomId);

            res.json({
                success: true,
                room: roomInfo
            });

        } catch (error) {
            res.status(404).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get rooms for current user
    router.get('/user/rooms', authService.authenticate, async (req, res) => {
        try {
            const userId = req.user.id;
            const rooms = roomManager.getRoomsForUser(userId);

            const roomsData = rooms.map(room => ({
                id: room.id,
                type: room.type,
                createdAt: room.createdAt,
                lastActivity: room.lastActivity,
                participantCount: room.participants.length,
                hasActiveCalls: room.activeCalls.length > 0,
                metadata: room.metadata
            }));

            res.json({
                success: true,
                rooms: roomsData
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get active rooms (for admin users)
    router.get('/admin/active', authService.authenticate, authService.requireRole(['admin', 'doctor']), async (req, res) => {
        try {
            const activeRooms = roomManager.getActiveRooms();

            const roomsData = activeRooms.map(room => ({
                id: room.id,
                type: room.type,
                creator: room.creator,
                createdAt: room.createdAt,
                lastActivity: room.lastActivity,
                participantCount: room.participants.length,
                activeCalls: room.activeCalls.length,
                participants: room.participants.map(p => ({
                    id: p.id,
                    name: p.name,
                    role: p.role,
                    joinedAt: p.joinedAt,
                    isOnline: p.isOnline
                }))
            }));

            res.json({
                success: true,
                rooms: roomsData
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get room statistics
    router.get('/admin/stats', authService.authenticate, authService.requireRole(['admin', 'doctor']), async (req, res) => {
        try {
            const stats = roomManager.getRoomStats();

            res.json({
                success: true,
                stats
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Update room settings
    router.patch('/:roomId/settings', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const { maxParticipants, metadata, isPrivate } = req.body;
            const userId = req.user.id;

            const room = await roomManager.getRoomInfo(roomId);

            // Check if user has permission to update room
            if (room.creator.id !== userId && !req.user.roles?.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Permission denied. Only room creator or admin can update settings.'
                });
            }

            // Update room settings
            const roomData = roomManager.rooms.get(roomId);
            if (roomData) {
                if (maxParticipants !== undefined) {
                    roomData.maxParticipants = maxParticipants;
                }
                if (metadata !== undefined) {
                    roomData.metadata = { ...roomData.metadata, ...metadata };
                }
                if (isPrivate !== undefined) {
                    roomData.isPrivate = isPrivate;
                }
                roomData.lastActivity = new Date();
            }

            res.json({
                success: true,
                message: 'Room settings updated successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Delete/close room
    router.delete('/:roomId', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const userId = req.user.id;

            const room = await roomManager.getRoomInfo(roomId);

            // Check if user has permission to delete room
            if (room.creator.id !== userId && !req.user.roles?.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Permission denied. Only room creator or admin can delete room.'
                });
            }

            // End all active calls in the room
            for (const call of room.activeCalls) {
                await roomManager.endCall(call.id, userId);
            }

            // Remove all participants
            for (const participant of room.participants) {
                await roomManager.leaveRoom(roomId, participant.id);
            }

            // Delete the room
            roomManager.rooms.delete(roomId);

            res.json({
                success: true,
                message: 'Room deleted successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get room chat history
    router.get('/:roomId/chat', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const { limit = 50, before } = req.query;

            const room = await roomManager.getRoomInfo(roomId);

            // Check if user is participant
            const isParticipant = room.participants.some(p => p.id === req.user.id);
            if (!isParticipant && !req.user.roles?.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. Must be room participant to view chat.'
                });
            }

            let chatHistory = room.chatHistory || [];

            // Filter messages if 'before' timestamp provided
            if (before) {
                const beforeDate = new Date(before);
                chatHistory = chatHistory.filter(msg => msg.timestamp < beforeDate);
            }

            // Limit results
            chatHistory = chatHistory.slice(-limit);

            res.json({
                success: true,
                messages: chatHistory
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get room file shares
    router.get('/:roomId/files', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const room = await roomManager.getRoomInfo(roomId);

            // Check if user is participant
            const isParticipant = room.participants.some(p => p.id === req.user.id);
            if (!isParticipant && !req.user.roles?.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied. Must be room participant to view files.'
                });
            }

            res.json({
                success: true,
                files: room.fileShares || []
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Join room via HTTP (alternative to WebSocket)
    router.post('/:roomId/join', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const { metadata = {} } = req.body;

            const userInfo = {
                userId: req.user.id,
                userName: req.user.name,
                userRole: req.user.role,
                socketId: null // Will be set when WebSocket connects
            };

            const room = await roomManager.joinRoom(roomId, userInfo, {
                metadata,
                joinedAt: new Date()
            });

            res.json({
                success: true,
                room: {
                    id: room.id,
                    type: room.type,
                    participantCount: room.participants.length,
                    participants: room.participants.map(p => ({
                        id: p.id,
                        name: p.name,
                        role: p.role,
                        joinedAt: p.joinedAt,
                        isOnline: p.isOnline
                    }))
                }
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Leave room via HTTP
    router.post('/:roomId/leave', authService.authenticate, async (req, res) => {
        try {
            const { roomId } = req.params;
            const userId = req.user.id;

            await roomManager.leaveRoom(roomId, userId);

            res.json({
                success: true,
                message: 'Left room successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createRoomRoutes;