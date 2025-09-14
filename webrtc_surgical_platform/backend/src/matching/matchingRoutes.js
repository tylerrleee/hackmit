const express = require('express');
const joi = require('joi');

function createMatchingRoutes(matchingService, authService) {
    const router = express.Router();

    // Validation schemas
    const consultationRequestSchema = joi.object({
        id: joi.string().default(() => `consult_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`),
        patientInfo: joi.object({
            age: joi.number().integer().min(0).max(150),
            gender: joi.string().valid('male', 'female', 'other'),
            medicalHistory: joi.array().items(joi.string()),
            currentCondition: joi.string().required(),
            severity: joi.string().valid('mild', 'moderate', 'severe', 'critical').required()
        }).required(),
        caseType: joi.string().required(),
        urgency: joi.string().valid('low', 'normal', 'high', 'emergency').required(),
        complexity: joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
        requiredSpecializations: joi.array().items(joi.string()),
        preferredSpecializations: joi.array().items(joi.string()),
        estimatedDuration: joi.number().integer().min(10).max(480).default(30), // 10 min to 8 hours
        maxBudget: joi.number().min(0),
        preferredLanguages: joi.array().items(joi.string()).default(['english']),
        locationPreference: joi.object({
            country: joi.string(),
            timezone: joi.string(),
            maxDistance: joi.number() // km
        }),
        previousConsultations: joi.array().items(joi.string()),
        additionalRequirements: joi.string(),
        metadata: joi.object().default({})
    });

    const feedbackSchema = joi.object({
        consultationId: joi.string().required(),
        expertId: joi.string().required(),
        rating: joi.number().min(1).max(5).required(),
        wasHelpful: joi.boolean().required(),
        responseTime: joi.number().integer().min(0), // seconds
        expertise: joi.number().min(1).max(5),
        communication: joi.number().min(1).max(5),
        overallSatisfaction: joi.number().min(1).max(5).required(),
        comments: joi.string(),
        wouldRecommend: joi.boolean(),
        improvements: joi.array().items(joi.string())
    });

    // Apply authentication to all routes
    router.use(authService.authenticate);

    // Find matching experts
    router.post('/find-experts', async (req, res) => {
        try {
            const { error, value } = consultationRequestSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid consultation request',
                    details: error.details[0].message
                });
            }

            // Add requester information
            const consultationRequest = {
                ...value,
                requesterId: req.user.id,
                requesterRole: req.user.role,
                requestedAt: new Date().toISOString()
            };

            const matches = await matchingService.findBestExperts(consultationRequest);

            res.json({
                success: true,
                ...matches
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get expert profile
    router.get('/expert/:expertId', async (req, res) => {
        try {
            const { expertId } = req.params;
            const includeStats = req.query.includeStats === 'true';
            
            const profile = await matchingService.getExpertProfile(expertId);
            
            let response = {
                success: true,
                profile
            };

            // Include additional statistics for certain roles
            if (includeStats && ['admin', 'surgeon', 'doctor'].includes(req.user.role)) {
                const history = await matchingService.getMatchingHistory(expertId, 10);
                response.recentHistory = history;
                response.statistics = {
                    totalConsultations: history.length,
                    averageRating: history.reduce((sum, h) => sum + h.rating, 0) / history.length || 0
                };
            }

            res.json(response);

        } catch (error) {
            res.status(404).json({
                success: false,
                error: error.message
            });
        }
    });

    // Quick match for emergency cases
    router.post('/emergency-match', async (req, res) => {
        try {
            const emergencyRequestSchema = joi.object({
                patientInfo: joi.object({
                    currentCondition: joi.string().required(),
                    severity: joi.string().valid('severe', 'critical').required()
                }).required(),
                caseType: joi.string().required(),
                requiredSpecializations: joi.array().items(joi.string()).required(),
                locationPreference: joi.object({
                    country: joi.string(),
                    timezone: joi.string()
                })
            });

            const { error, value } = emergencyRequestSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid emergency request',
                    details: error.details[0].message
                });
            }

            const emergencyRequest = {
                id: `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                ...value,
                urgency: 'emergency',
                complexity: 'high',
                requesterId: req.user.id,
                requestedAt: new Date().toISOString()
            };

            const matches = await matchingService.findBestExperts(emergencyRequest);
            
            // For emergency cases, only return top 3 matches
            const emergencyMatches = matches.matches.slice(0, 3);

            res.json({
                success: true,
                matches: emergencyMatches,
                isEmergency: true,
                requestId: emergencyRequest.id,
                message: emergencyMatches.length > 0 
                    ? 'Emergency experts found'
                    : 'No emergency experts available - escalating to admin'
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Update expert availability
    router.patch('/expert/:expertId/availability', authService.requireRole(['admin', 'surgeon', 'doctor']), async (req, res) => {
        try {
            const { expertId } = req.params;
            
            // Verify user can update this expert's availability
            if (req.user.id !== expertId && !req.user.roles?.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Permission denied. Can only update own availability.'
                });
            }

            const availabilitySchema = joi.object({
                status: joi.string().valid('available', 'busy', 'unavailable', 'inactive'),
                currentLoad: joi.number().integer().min(0),
                scheduledUnavailability: joi.array().items(joi.object({
                    start: joi.date().iso().required(),
                    end: joi.date().iso().required(),
                    reason: joi.string().required()
                }))
            });

            const { error, value } = availabilitySchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid availability data',
                    details: error.details[0].message
                });
            }

            await matchingService.updateExpertAvailability(expertId, value);

            res.json({
                success: true,
                message: 'Availability updated successfully',
                expertId,
                updatedAt: new Date().toISOString()
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // Submit feedback
    router.post('/feedback', async (req, res) => {
        try {
            const { error, value } = feedbackSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid feedback data',
                    details: error.details[0].message
                });
            }

            const feedbackData = {
                ...value,
                submitterId: req.user.id,
                submittedAt: new Date().toISOString()
            };

            await matchingService.recordMatchingFeedback(
                value.consultationId,
                value.expertId,
                feedbackData
            );

            res.json({
                success: true,
                message: 'Feedback recorded successfully',
                feedbackId: `feedback_${Date.now()}`
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get matching history for current user
    router.get('/history', async (req, res) => {
        try {
            const { limit = 20, expertId } = req.query;
            
            let history;
            if (expertId) {
                // Get history for specific expert (if user has permission)
                if (req.user.id !== expertId && !['admin', 'surgeon'].includes(req.user.role)) {
                    return res.status(403).json({
                        success: false,
                        error: 'Permission denied'
                    });
                }
                history = await matchingService.getMatchingHistory(expertId, parseInt(limit));
            } else {
                // Get user's own consultation history
                // In production, implement user-specific history retrieval
                history = [];
            }

            res.json({
                success: true,
                history,
                count: history.length
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get available specializations
    router.get('/specializations', async (req, res) => {
        try {
            // In production, this would come from a database or configuration
            const specializations = {
                surgical: {
                    'cardiothoracic_surgery': 'Cardiothoracic Surgery',
                    'neurosurgery': 'Neurosurgery',
                    'orthopedic_surgery': 'Orthopedic Surgery',
                    'plastic_surgery': 'Plastic Surgery',
                    'general_surgery': 'General Surgery',
                    'minimally_invasive_surgery': 'Minimally Invasive Surgery'
                },
                medical: {
                    'emergency_medicine': 'Emergency Medicine',
                    'internal_medicine': 'Internal Medicine',
                    'pediatrics': 'Pediatrics',
                    'psychiatry': 'Psychiatry',
                    'radiology': 'Radiology',
                    'anesthesiology': 'Anesthesiology'
                },
                subspecialty: {
                    'trauma_surgery': 'Trauma Surgery',
                    'cardiac_surgery': 'Cardiac Surgery',
                    'vascular_surgery': 'Vascular Surgery',
                    'critical_care': 'Critical Care',
                    'pain_management': 'Pain Management'
                }
            };

            res.json({
                success: true,
                specializations
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Search experts by criteria
    router.get('/search', async (req, res) => {
        try {
            const searchSchema = joi.object({
                specialization: joi.string(),
                minRating: joi.number().min(1).max(5),
                availability: joi.string().valid('available', 'busy'),
                language: joi.string(),
                location: joi.string(),
                maxCost: joi.number().min(0),
                minExperience: joi.number().min(0),
                emergencyAvailable: joi.boolean(),
                limit: joi.number().integer().min(1).max(50).default(10)
            });

            const { error, value } = searchSchema.validate(req.query);
            if (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid search parameters',
                    details: error.details[0].message
                });
            }

            // Create a consultation request for search
            const searchRequest = {
                id: `search_${Date.now()}`,
                patientInfo: {
                    currentCondition: 'search_query',
                    severity: 'mild'
                },
                caseType: 'consultation',
                urgency: 'normal',
                complexity: 'medium',
                requiredSpecializations: value.specialization ? [value.specialization] : [],
                maxBudget: value.maxCost,
                preferredLanguages: value.language ? [value.language] : ['english'],
                requesterId: req.user.id
            };

            const matches = await matchingService.findBestExperts(searchRequest);

            // Filter results based on search criteria
            let filteredMatches = matches.matches || [];

            if (value.minRating) {
                filteredMatches = filteredMatches.filter(m => 
                    m.profile.ratings.overall >= value.minRating
                );
            }

            if (value.minExperience) {
                filteredMatches = filteredMatches.filter(m => 
                    m.profile.experience.yearsOfPractice >= value.minExperience
                );
            }

            if (value.emergencyAvailable !== undefined) {
                filteredMatches = filteredMatches.filter(m => 
                    m.profile.availability?.emergencyAvailable === value.emergencyAvailable
                );
            }

            // Apply limit
            filteredMatches = filteredMatches.slice(0, value.limit);

            res.json({
                success: true,
                experts: filteredMatches,
                searchCriteria: value,
                totalFound: filteredMatches.length
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Get system statistics (admin only)
    router.get('/stats', authService.requireRole(['admin']), async (req, res) => {
        try {
            const stats = matchingService.getSystemStatistics();
            
            res.json({
                success: true,
                statistics: stats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Recommend experts based on consultation history
    router.get('/recommendations/:userId', authService.requireRole(['admin', 'surgeon', 'doctor']), async (req, res) => {
        try {
            const { userId } = req.params;
            const { limit = 5 } = req.query;

            // Check permission to access recommendations for this user
            if (req.user.id !== userId && !req.user.roles?.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    error: 'Permission denied'
                });
            }

            // Get user's consultation history and recommend similar experts
            const history = await matchingService.getMatchingHistory(userId, 50);
            
            // Simple recommendation: experts with high ratings from similar cases
            const recommendations = [];
            const processedExperts = new Set();

            for (const consultation of history) {
                if (consultation.rating >= 4 && !processedExperts.has(consultation.expertId)) {
                    try {
                        const profile = await matchingService.getExpertProfile(consultation.expertId);
                        recommendations.push({
                            expert: profile,
                            reason: `Highly rated (${consultation.rating}/5) in previous consultation`,
                            previousRating: consultation.rating,
                            consultationDate: consultation.timestamp
                        });
                        processedExperts.add(consultation.expertId);
                    } catch (error) {
                        // Skip if expert profile not found
                    }
                }
                
                if (recommendations.length >= limit) break;
            }

            res.json({
                success: true,
                recommendations: recommendations.slice(0, limit),
                basedOn: `${history.length} previous consultations`
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Health check
    router.get('/health', async (req, res) => {
        try {
            const stats = matchingService.getSystemStatistics();
            const isHealthy = stats.totalExperts > 0 && stats.availableExperts > 0;

            res.json({
                success: true,
                healthy: isHealthy,
                timestamp: new Date().toISOString(),
                stats: {
                    totalExperts: stats.totalExperts,
                    availableExperts: stats.availableExperts,
                    systemLoad: stats.systemLoad
                }
            });

        } catch (error) {
            res.status(500).json({
                success: false,
                healthy: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createMatchingRoutes;