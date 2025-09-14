const { performance } = require('perf_hooks');

class ExpertMatchingService {
    constructor(logger, authService) {
        this.logger = logger;
        this.authService = authService;
        
        // Expert profiles and performance data
        this.expertProfiles = new Map();
        this.expertAvailability = new Map();
        this.matchingHistory = new Map();
        this.performanceMetrics = new Map();
        
        // Matching algorithms
        this.algorithms = {
            contentBased: new ContentBasedMatcher(),
            collaborative: new CollaborativeFilterMatcher(),
            expertise: new ExpertiseBasedMatcher(),
            availability: new AvailabilityMatcher(),
            performance: new PerformanceBasedMatcher()
        };
        
        // Matching weights (configurable)
        this.matchingWeights = {
            specialization: 0.25,
            experience: 0.20,
            availability: 0.20,
            performance: 0.15,
            location: 0.10,
            language: 0.05,
            cost: 0.05
        };

        // System configuration
        this.config = {
            minMatchScore: 0.6,
            maxRecommendations: 10,
            cacheTimeout: 15 * 60 * 1000, // 15 minutes
            enableRealTimeMatching: true,
            learningRate: 0.1,
            diversityFactor: 0.3
        };

        // Initialize the service
        this.initialize();
    }

    async initialize() {
        try {
            this.logger.info('Initializing Expert Matching Service...');
            
            // Load expert profiles
            await this.loadExpertProfiles();
            
            // Initialize availability tracking
            this.setupAvailabilityTracking();
            
            // Start performance monitoring
            this.setupPerformanceMonitoring();
            
            // Initialize learning algorithms
            this.initializeLearningAlgorithms();
            
            this.logger.info('Expert Matching Service initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize Expert Matching Service:', error);
            throw error;
        }
    }

    async loadExpertProfiles() {
        // In production, load from database
        // For now, create sample expert profiles
        const sampleExperts = [
            {
                id: 'surgeon-001',
                name: 'Dr. Sarah Smith',
                role: 'surgeon',
                specializations: ['cardiothoracic_surgery', 'minimally_invasive_surgery'],
                subSpecializations: ['heart_valve_repair', 'coronary_bypass', 'aortic_surgery'],
                experience: {
                    yearsOfPractice: 15,
                    totalSurgeries: 2500,
                    complexSurgeries: 800,
                    teachingExperience: 8
                },
                education: {
                    medicalSchool: 'Harvard Medical School',
                    residency: 'Johns Hopkins Hospital',
                    fellowship: 'Cleveland Clinic',
                    boardCertifications: ['American Board of Thoracic Surgery']
                },
                languages: ['english', 'spanish'],
                location: {
                    country: 'US',
                    timezone: 'America/New_York',
                    hospital: 'Massachusetts General Hospital'
                },
                availability: {
                    status: 'available',
                    hoursPerWeek: 40,
                    preferredHours: ['09:00-17:00'],
                    emergencyAvailable: true
                },
                ratings: {
                    overall: 4.8,
                    communication: 4.9,
                    expertise: 4.7,
                    responsiveness: 4.6
                },
                consultationRate: 500,
                preferences: {
                    caseTypes: ['complex_cardiac', 'emergency_cardiac'],
                    maxConcurrentCases: 3,
                    preferredCommMethod: 'video'
                }
            },
            {
                id: 'doctor-001',
                name: 'Dr. Michael Johnson',
                role: 'doctor',
                specializations: ['emergency_medicine', 'trauma_surgery'],
                subSpecializations: ['acute_care', 'critical_care', 'trauma_resuscitation'],
                experience: {
                    yearsOfPractice: 12,
                    totalCases: 5000,
                    emergencyCases: 3500,
                    teachingExperience: 5
                },
                education: {
                    medicalSchool: 'Stanford University School of Medicine',
                    residency: 'UCLA Medical Center',
                    fellowship: 'Shock Trauma Center',
                    boardCertifications: ['American Board of Emergency Medicine']
                },
                languages: ['english', 'mandarin'],
                location: {
                    country: 'US',
                    timezone: 'America/Los_Angeles',
                    hospital: 'Stanford Medical Center'
                },
                availability: {
                    status: 'available',
                    hoursPerWeek: 50,
                    preferredHours: ['24/7'], // Emergency medicine
                    emergencyAvailable: true
                },
                ratings: {
                    overall: 4.6,
                    communication: 4.5,
                    expertise: 4.8,
                    responsiveness: 4.9
                },
                consultationRate: 350,
                preferences: {
                    caseTypes: ['trauma', 'emergency', 'critical_care'],
                    maxConcurrentCases: 5,
                    preferredCommMethod: 'voice'
                }
            }
        ];

        for (const expert of sampleExperts) {
            this.expertProfiles.set(expert.id, {
                ...expert,
                lastUpdated: new Date(),
                totalConsultations: 0,
                successfulConsultations: 0,
                averageResponseTime: 0,
                patientSatisfactionScore: 0
            });

            // Initialize availability
            this.expertAvailability.set(expert.id, {
                status: expert.availability.status,
                currentLoad: 0,
                maxLoad: expert.preferences.maxConcurrentCases,
                lastActivity: new Date(),
                scheduledUnavailability: []
            });

            // Initialize performance metrics
            this.performanceMetrics.set(expert.id, {
                consultationSuccess: 0.95,
                averageRating: expert.ratings.overall,
                responseTime: 120, // seconds
                patientOutcomes: 0.92,
                peerRecommendations: 0.85
            });
        }

        this.logger.info(`Loaded ${this.expertProfiles.size} expert profiles`);
    }

    // Main matching function
    async findBestExperts(consultationRequest) {
        try {
            const startTime = performance.now();
            
            // Validate request
            this.validateConsultationRequest(consultationRequest);
            
            // Get available experts
            const availableExperts = this.getAvailableExperts(consultationRequest);
            
            if (availableExperts.length === 0) {
                return {
                    matches: [],
                    message: 'No available experts found for this consultation',
                    requestId: consultationRequest.id
                };
            }

            // Apply hybrid matching algorithm
            const matches = await this.applyHybridMatching(consultationRequest, availableExperts);
            
            // Rank and filter results
            const rankedMatches = this.rankMatches(matches, consultationRequest);
            const finalMatches = rankedMatches.slice(0, this.config.maxRecommendations);
            
            // Log matching result
            const processingTime = performance.now() - startTime;
            this.logMatchingResult(consultationRequest, finalMatches, processingTime);
            
            return {
                matches: finalMatches,
                totalCandidates: availableExperts.length,
                processingTime,
                algorithm: 'hybrid',
                requestId: consultationRequest.id
            };

        } catch (error) {
            this.logger.error('Expert matching failed:', error);
            throw error;
        }
    }

    validateConsultationRequest(request) {
        const required = ['id', 'patientInfo', 'caseType', 'urgency'];
        for (const field of required) {
            if (!request[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
    }

    getAvailableExperts(request) {
        const availableExperts = [];
        
        for (const [expertId, profile] of this.expertProfiles) {
            const availability = this.expertAvailability.get(expertId);
            
            // Check basic availability
            if (availability.status !== 'available') {
                continue;
            }

            // Check capacity
            if (availability.currentLoad >= availability.maxLoad) {
                continue;
            }

            // Check specialization match
            if (!this.hasRequiredSpecialization(profile, request)) {
                continue;
            }

            // Check emergency availability for urgent cases
            if (request.urgency === 'emergency' && !profile.availability.emergencyAvailable) {
                continue;
            }

            availableExperts.push({ expertId, profile, availability });
        }

        return availableExperts;
    }

    hasRequiredSpecialization(profile, request) {
        const requiredSpecs = request.requiredSpecializations || [];
        const preferredSpecs = request.preferredSpecializations || [];
        
        // Must have at least one required specialization
        if (requiredSpecs.length > 0) {
            const hasRequired = requiredSpecs.some(spec => 
                profile.specializations.includes(spec) ||
                profile.subSpecializations.includes(spec)
            );
            if (!hasRequired) return false;
        }

        return true;
    }

    async applyHybridMatching(request, experts) {
        const matches = [];

        for (const { expertId, profile } of experts) {
            // Calculate scores from different algorithms
            const scores = {
                content: this.algorithms.contentBased.calculateScore(profile, request),
                collaborative: await this.algorithms.collaborative.calculateScore(expertId, request),
                expertise: this.algorithms.expertise.calculateScore(profile, request),
                availability: this.algorithms.availability.calculateScore(expertId, request),
                performance: this.algorithms.performance.calculateScore(expertId, this.performanceMetrics.get(expertId))
            };

            // Calculate weighted hybrid score
            const hybridScore = this.calculateHybridScore(scores, request);
            
            if (hybridScore >= this.config.minMatchScore) {
                matches.push({
                    expertId,
                    profile: this.sanitizeProfileForClient(profile),
                    score: hybridScore,
                    scores: scores,
                    reasoning: this.generateMatchingReasoning(profile, scores),
                    estimatedResponseTime: this.estimateResponseTime(expertId),
                    cost: this.calculateConsultationCost(profile, request)
                });
            }
        }

        return matches;
    }

    calculateHybridScore(scores, request) {
        // Base weighted score
        let hybridScore = 0;
        hybridScore += scores.content * this.matchingWeights.specialization;
        hybridScore += scores.expertise * this.matchingWeights.experience;
        hybridScore += scores.availability * this.matchingWeights.availability;
        hybridScore += scores.performance * this.matchingWeights.performance;
        hybridScore += scores.collaborative * 0.15; // Additional collaborative weight

        // Apply urgency boost
        if (request.urgency === 'emergency') {
            hybridScore += scores.availability * 0.2;
        } else if (request.urgency === 'high') {
            hybridScore += scores.availability * 0.1;
        }

        // Apply case complexity adjustment
        if (request.complexity === 'high' || request.complexity === 'critical') {
            hybridScore += scores.expertise * 0.15;
            hybridScore += scores.performance * 0.1;
        }

        return Math.min(hybridScore, 1.0); // Cap at 1.0
    }

    rankMatches(matches, request) {
        // Sort by hybrid score
        matches.sort((a, b) => b.score - a.score);
        
        // Apply diversity if requested
        if (this.config.diversityFactor > 0) {
            matches = this.applyDiversityFilter(matches);
        }

        // Add ranking metadata
        matches.forEach((match, index) => {
            match.rank = index + 1;
            match.confidence = this.calculateConfidence(match.score, match.scores);
        });

        return matches;
    }

    applyDiversityFilter(matches) {
        // Ensure diversity in specializations and hospitals
        const diverseMatches = [];
        const usedSpecializations = new Set();
        const usedHospitals = new Set();
        
        for (const match of matches) {
            const primarySpec = match.profile.specializations[0];
            const hospital = match.profile.location.hospital;
            
            const specUsed = usedSpecializations.has(primarySpec);
            const hospitalUsed = usedHospitals.has(hospital);
            
            // Prioritize diverse matches
            if (!specUsed || !hospitalUsed || diverseMatches.length < 3) {
                diverseMatches.push(match);
                usedSpecializations.add(primarySpec);
                usedHospitals.add(hospital);
            } else if (Math.random() < this.config.diversityFactor) {
                // Still include some similar matches
                diverseMatches.push(match);
            }
        }

        return diverseMatches;
    }

    calculateConfidence(score, individualScores) {
        // Calculate confidence based on score consistency
        const scores = Object.values(individualScores);
        const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
        const consistency = 1 - Math.sqrt(variance);
        
        return (score + consistency) / 2;
    }

    generateMatchingReasoning(profile, scores) {
        const reasons = [];
        
        if (scores.expertise > 0.8) {
            reasons.push(`Highly experienced with ${profile.experience.totalSurgeries} procedures`);
        }
        
        if (scores.performance > 0.8) {
            reasons.push(`Excellent track record with ${profile.ratings.overall}/5 rating`);
        }
        
        if (scores.availability > 0.9) {
            reasons.push('Immediately available');
        }
        
        if (profile.availability.emergencyAvailable) {
            reasons.push('Available for emergency consultations');
        }

        const topSpecs = profile.specializations.slice(0, 2);
        reasons.push(`Specializes in ${topSpecs.join(' and ')}`);

        return reasons;
    }

    estimateResponseTime(expertId) {
        const metrics = this.performanceMetrics.get(expertId);
        const availability = this.expertAvailability.get(expertId);
        
        let baseTime = metrics?.responseTime || 300; // Default 5 minutes
        
        // Adjust based on current load
        const loadFactor = availability.currentLoad / availability.maxLoad;
        baseTime *= (1 + loadFactor);
        
        return Math.round(baseTime);
    }

    calculateConsultationCost(profile, request) {
        let baseCost = profile.consultationRate || 300;
        
        // Urgency premium
        if (request.urgency === 'emergency') {
            baseCost *= 2;
        } else if (request.urgency === 'high') {
            baseCost *= 1.5;
        }

        // Complexity premium
        if (request.complexity === 'critical') {
            baseCost *= 1.8;
        } else if (request.complexity === 'high') {
            baseCost *= 1.4;
        }

        // Duration estimate
        const duration = request.estimatedDuration || 30; // minutes
        const hourlyRate = baseCost * 2; // Assume base is for 30 min
        const finalCost = (hourlyRate / 60) * duration;

        return Math.round(finalCost);
    }

    sanitizeProfileForClient(profile) {
        // Remove sensitive information before sending to client
        return {
            id: profile.id,
            name: profile.name,
            role: profile.role,
            specializations: profile.specializations,
            subSpecializations: profile.subSpecializations,
            experience: {
                yearsOfPractice: profile.experience.yearsOfPractice,
                totalSurgeries: profile.experience.totalSurgeries
            },
            education: {
                medicalSchool: profile.education.medicalSchool,
                boardCertifications: profile.education.boardCertifications
            },
            languages: profile.languages,
            location: {
                country: profile.location.country,
                timezone: profile.location.timezone,
                hospital: profile.location.hospital
            },
            ratings: profile.ratings,
            totalConsultations: profile.totalConsultations,
            successfulConsultations: profile.successfulConsultations
        };
    }

    // Real-time availability updates
    updateExpertAvailability(expertId, availability) {
        try {
            const current = this.expertAvailability.get(expertId);
            if (!current) {
                throw new Error(`Expert ${expertId} not found`);
            }

            this.expertAvailability.set(expertId, {
                ...current,
                ...availability,
                lastActivity: new Date()
            });

            this.logger.info(`Updated availability for expert: ${expertId}`, availability);

        } catch (error) {
            this.logger.error(`Failed to update availability for ${expertId}:`, error);
            throw error;
        }
    }

    // Learning and feedback
    async recordMatchingFeedback(consultationId, expertId, feedback) {
        try {
            const feedbackData = {
                consultationId,
                expertId,
                rating: feedback.rating,
                wasHelpful: feedback.wasHelpful,
                responseTime: feedback.responseTime,
                expertise: feedback.expertise,
                communication: feedback.communication,
                overallSatisfaction: feedback.overallSatisfaction,
                timestamp: new Date()
            };

            // Store feedback
            if (!this.matchingHistory.has(consultationId)) {
                this.matchingHistory.set(consultationId, []);
            }
            this.matchingHistory.get(consultationId).push(feedbackData);

            // Update expert performance metrics
            await this.updateExpertMetrics(expertId, feedbackData);

            // Learn from feedback
            await this.updateMatchingAlgorithms(consultationId, feedbackData);

            this.logger.info(`Recorded feedback for consultation: ${consultationId}`, {
                expertId,
                rating: feedback.rating
            });

        } catch (error) {
            this.logger.error('Failed to record matching feedback:', error);
            throw error;
        }
    }

    async updateExpertMetrics(expertId, feedback) {
        const currentMetrics = this.performanceMetrics.get(expertId);
        if (!currentMetrics) return;

        // Update metrics using exponential moving average
        const alpha = this.config.learningRate;
        
        currentMetrics.averageRating = 
            (1 - alpha) * currentMetrics.averageRating + alpha * feedback.rating;
        
        if (feedback.responseTime) {
            currentMetrics.responseTime = 
                (1 - alpha) * currentMetrics.responseTime + alpha * feedback.responseTime;
        }

        currentMetrics.patientSatisfactionScore = 
            (1 - alpha) * currentMetrics.patientSatisfactionScore + alpha * feedback.overallSatisfaction;

        this.performanceMetrics.set(expertId, currentMetrics);
    }

    async updateMatchingAlgorithms(consultationId, feedback) {
        // Update collaborative filtering
        await this.algorithms.collaborative.updateFromFeedback(consultationId, feedback);
        
        // Update performance-based algorithm
        this.algorithms.performance.updateFromFeedback(feedback.expertId, feedback);
    }

    // Analytics and monitoring
    setupAvailabilityTracking() {
        // Update availability status every minute
        setInterval(() => {
            this.updateAllExpertAvailability();
        }, 60000);
    }

    updateAllExpertAvailability() {
        const now = new Date();
        
        for (const [expertId, availability] of this.expertAvailability) {
            // Auto-set to unavailable if no activity for 30 minutes
            const inactiveTime = now - availability.lastActivity;
            if (inactiveTime > 30 * 60 * 1000 && availability.status === 'available') {
                availability.status = 'inactive';
                this.logger.info(`Expert ${expertId} marked as inactive due to inactivity`);
            }
        }
    }

    setupPerformanceMonitoring() {
        setInterval(() => {
            this.logMatchingStatistics();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    logMatchingStatistics() {
        const totalExperts = this.expertProfiles.size;
        const availableExperts = Array.from(this.expertAvailability.values())
            .filter(a => a.status === 'available').length;
        
        const totalFeedback = Array.from(this.matchingHistory.values())
            .reduce((sum, feedback) => sum + feedback.length, 0);

        this.logger.info('Expert Matching Statistics', {
            totalExperts,
            availableExperts,
            utilizationRate: availableExperts / totalExperts,
            totalFeedbackRecords: totalFeedback
        });
    }

    logMatchingResult(request, matches, processingTime) {
        this.logger.info('Expert matching completed', {
            requestId: request.id,
            caseType: request.caseType,
            urgency: request.urgency,
            matchesFound: matches.length,
            topScore: matches[0]?.score || 0,
            processingTime: Math.round(processingTime)
        });
    }

    // Public API methods
    async getExpertProfile(expertId) {
        const profile = this.expertProfiles.get(expertId);
        if (!profile) {
            throw new Error(`Expert ${expertId} not found`);
        }
        
        return this.sanitizeProfileForClient(profile);
    }

    async getMatchingHistory(expertId, limit = 50) {
        const history = [];
        
        for (const [consultationId, feedbacks] of this.matchingHistory) {
            const expertFeedback = feedbacks.filter(f => f.expertId === expertId);
            if (expertFeedback.length > 0) {
                history.push(...expertFeedback);
            }
        }

        return history
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    getSystemStatistics() {
        return {
            totalExperts: this.expertProfiles.size,
            availableExperts: Array.from(this.expertAvailability.values())
                .filter(a => a.status === 'available').length,
            totalConsultations: Array.from(this.matchingHistory.values())
                .reduce((sum, feedback) => sum + feedback.length, 0),
            averageMatchingTime: 2500, // Mock average
            systemLoad: this.getCurrentSystemLoad()
        };
    }

    getCurrentSystemLoad() {
        const totalCapacity = Array.from(this.expertAvailability.values())
            .reduce((sum, a) => sum + a.maxLoad, 0);
        
        const currentLoad = Array.from(this.expertAvailability.values())
            .reduce((sum, a) => sum + a.currentLoad, 0);

        return totalCapacity > 0 ? currentLoad / totalCapacity : 0;
    }
}

// Individual matching algorithm classes
class ContentBasedMatcher {
    calculateScore(profile, request) {
        let score = 0;
        
        // Specialization match
        const specMatch = this.calculateSpecializationMatch(profile.specializations, request);
        score += specMatch * 0.6;
        
        // Experience relevance
        const expScore = this.calculateExperienceRelevance(profile.experience, request);
        score += expScore * 0.4;
        
        return Math.min(score, 1.0);
    }
    
    calculateSpecializationMatch(expertSpecs, request) {
        const requiredSpecs = request.requiredSpecializations || [];
        const preferredSpecs = request.preferredSpecializations || [];
        
        let matchScore = 0;
        
        // Required specializations (must have)
        for (const reqSpec of requiredSpecs) {
            if (expertSpecs.includes(reqSpec)) {
                matchScore += 0.5;
            }
        }
        
        // Preferred specializations (nice to have)
        for (const prefSpec of preferredSpecs) {
            if (expertSpecs.includes(prefSpec)) {
                matchScore += 0.2;
            }
        }
        
        return Math.min(matchScore, 1.0);
    }
    
    calculateExperienceRelevance(experience, request) {
        const complexityWeights = {
            'low': 0.3,
            'medium': 0.6,
            'high': 0.8,
            'critical': 1.0
        };
        
        const complexityWeight = complexityWeights[request.complexity] || 0.5;
        const experienceScore = Math.min(experience.yearsOfPractice / 20, 1.0);
        
        return experienceScore * complexityWeight;
    }
}

class CollaborativeFilterMatcher {
    constructor() {
        this.userItemMatrix = new Map(); // userId -> expertId -> rating
        this.itemSimilarity = new Map(); // expertId -> expertId -> similarity
    }
    
    async calculateScore(expertId, request) {
        // Simplified collaborative filtering
        // In production, implement proper matrix factorization
        return 0.7 + Math.random() * 0.3;
    }
    
    async updateFromFeedback(consultationId, feedback) {
        // Update user-item matrix for collaborative filtering
        // Implementation would depend on the specific CF algorithm used
    }
}

class ExpertiseBasedMatcher {
    calculateScore(profile, request) {
        const yearsWeight = Math.min(profile.experience.yearsOfPractice / 15, 1.0);
        const surgeryWeight = Math.min(profile.experience.totalSurgeries / 1000, 1.0);
        const ratingWeight = profile.ratings.expertise / 5.0;
        
        return (yearsWeight + surgeryWeight + ratingWeight) / 3;
    }
}

class AvailabilityMatcher {
    calculateScore(expertId, request) {
        // This would be calculated based on current availability
        // For now, return mock score
        return 0.8 + Math.random() * 0.2;
    }
}

class PerformanceBasedMatcher {
    calculateScore(expertId, metrics) {
        if (!metrics) return 0.5;
        
        const ratingScore = metrics.averageRating / 5.0;
        const successScore = metrics.consultationSuccess;
        const outcomeScore = metrics.patientOutcomes;
        
        return (ratingScore + successScore + outcomeScore) / 3;
    }
    
    updateFromFeedback(expertId, feedback) {
        // Update performance metrics based on feedback
    }
}

module.exports = ExpertMatchingService;