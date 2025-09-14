/**
 * Google Cloud Translation Service
 * Integrates with WebRTC platform audio capture for real-time translation
 */

const speech = require('@google-cloud/speech');
const translate = require('@google-cloud/translate').v2;
const textToSpeech = require('@google-cloud/text-to-speech');

class TranslationService {
    constructor(logger) {
        this.logger = logger;
        this.speechClient = new speech.SpeechClient();
        this.translateClient = new translate.Translate();
        this.ttsClient = new textToSpeech.TextToSpeechClient();
        
        // Audio stream processing settings
        this.audioStreamSettings = {
            sampleRateHertz: 16000,
            languageCode: 'en-US',
            encoding: 'LINEAR16',
            enableWordTimeOffsets: true,
            enableWordConfidence: true,
            maxAlternatives: 3,
            profanityFilter: false,
            speechContexts: [{
                phrases: [
                    // Medical terminology contexts
                    'scalpel', 'forceps', 'clamp', 'suture', 'incision', 'cautery',
                    'patient', 'blood pressure', 'heart rate', 'oxygen', 'IV',
                    'emergency', 'surgery', 'operation', 'procedure', 'anesthesia'
                ]
            }]
        };
        
        // Active translation sessions
        this.activeSessions = new Map();
        
        // Supported languages for medical translation
        this.supportedLanguages = {
            'en': { name: 'English', code: 'en-US' },
            'es': { name: 'Spanish', code: 'es-ES' },
            'fr': { name: 'French', code: 'fr-FR' },
            'de': { name: 'German', code: 'de-DE' },
            'it': { name: 'Italian', code: 'it-IT' },
            'pt': { name: 'Portuguese', code: 'pt-BR' },
            'zh': { name: 'Chinese', code: 'zh-CN' },
            'ja': { name: 'Japanese', code: 'ja-JP' },
            'ko': { name: 'Korean', code: 'ko-KR' },
            'ar': { name: 'Arabic', code: 'ar-XA' }
        };
    }

    /**
     * Create audio data structure for Google Cloud Speech-to-Text
     * @param {Buffer|ArrayBuffer|Uint8Array} audioBuffer - Raw audio data from WebRTC
     * @param {Object} options - Audio configuration options
     * @returns {Object} Formatted request for Google Cloud Speech API
     */
    createSpeechRequest(audioBuffer, options = {}) {
        const defaultOptions = {
            sourceLanguage: 'en-US',
            sampleRate: 16000,
            encoding: 'LINEAR16',
            channels: 1,
            medicalContext: true
        };

        const config = { ...defaultOptions, ...options };

        // Convert audio buffer to proper format
        let audioContent;
        if (Buffer.isBuffer(audioBuffer)) {
            audioContent = audioBuffer;
        } else if (audioBuffer instanceof ArrayBuffer) {
            audioContent = Buffer.from(audioBuffer);
        } else if (audioBuffer instanceof Uint8Array) {
            audioContent = Buffer.from(audioBuffer);
        } else {
            throw new Error('Unsupported audio buffer format');
        }

        // Create Google Cloud Speech request structure
        const speechRequest = {
            audio: {
                content: audioContent.toString('base64')
            },
            config: {
                encoding: config.encoding,
                sampleRateHertz: config.sampleRate,
                languageCode: config.sourceLanguage,
                audioChannelCount: config.channels,
                enableWordTimeOffsets: true,
                enableWordConfidence: true,
                enableSpeakerDiarization: true,
                diarizationSpeakerCount: 2, // Doctor and field medic
                maxAlternatives: 3,
                profanityFilter: false,
                useEnhanced: true,
                model: config.medicalContext ? 'medical_conversation' : 'latest_long',
                speechContexts: [{
                    phrases: this.getMedicalPhrases(),
                    boost: 10.0
                }],
                metadata: {
                    interactionType: 'DISCUSSION',
                    industryNaicsCodeOfAudio: 621111, // Offices of physicians
                    microphoneDistance: 'NEARFIELD',
                    originalMediaType: 'AUDIO',
                    recordingDeviceType: 'PC'
                }
            }
        };

        return speechRequest;
    }

    /**
     * Create streaming speech recognition session
     * @param {Object} options - Streaming configuration
     * @returns {Object} Streaming session data structure
     */
    createStreamingSession(options = {}) {
        const sessionConfig = {
            config: {
                encoding: options.encoding || 'LINEAR16',
                sampleRateHertz: options.sampleRate || 16000,
                languageCode: options.sourceLanguage || 'en-US',
                enableWordTimeOffsets: true,
                enableWordConfidence: true,
                enableSpeakerDiarization: true,
                diarizationSpeakerCount: 2,
                profanityFilter: false,
                useEnhanced: true,
                model: 'medical_conversation',
                speechContexts: [{
                    phrases: this.getMedicalPhrases(),
                    boost: 10.0
                }]
            },
            interimResults: true,
            enableVoiceActivityEvents: true,
            voiceActivityTimeout: {
                speechStartTimeout: '1s',
                speechEndTimeout: '2s'
            }
        };

        const sessionId = this.generateSessionId();
        const session = {
            id: sessionId,
            config: sessionConfig,
            stream: null,
            isActive: false,
            startTime: new Date(),
            results: [],
            participants: options.participants || [],
            targetLanguages: options.targetLanguages || ['es'],
            callbacks: {
                onResult: options.onResult || (() => {}),
                onError: options.onError || (() => {}),
                onEnd: options.onEnd || (() => {})
            }
        };

        this.activeSessions.set(sessionId, session);
        return session;
    }

    /**
     * Process WebRTC audio stream for real-time translation
     * @param {ReadableStream} audioStream - WebRTC audio stream
     * @param {Object} translationOptions - Translation configuration
     */
    async processAudioStream(audioStream, translationOptions = {}) {
        const sessionId = this.generateSessionId();
        
        try {
            // Create streaming recognition session
            const session = this.createStreamingSession({
                sourceLanguage: translationOptions.sourceLanguage || 'en-US',
                targetLanguages: translationOptions.targetLanguages || ['es'],
                participants: translationOptions.participants || [],
                onResult: (result) => this.handleSpeechResult(sessionId, result, translationOptions),
                onError: (error) => this.handleStreamError(sessionId, error),
                onEnd: () => this.handleStreamEnd(sessionId)
            });

            // Start Google Cloud Speech streaming
            const speechStream = this.speechClient
                .streamingRecognize(session.config)
                .on('data', (data) => this.processSpeechData(sessionId, data, translationOptions))
                .on('error', (error) => session.callbacks.onError(error))
                .on('end', () => session.callbacks.onEnd());

            session.stream = speechStream;
            session.isActive = true;

            // Pipe WebRTC audio to Google Cloud Speech
            audioStream.on('data', (audioChunk) => {
                if (session.isActive && speechStream.writable) {
                    speechStream.write({ audioContent: audioChunk });
                }
            });

            audioStream.on('end', () => {
                if (speechStream.writable) {
                    speechStream.end();
                }
            });

            this.logger.info('Audio stream processing started', { sessionId });
            return sessionId;

        } catch (error) {
            this.logger.error('Failed to process audio stream', { error: error.message, sessionId });
            throw error;
        }
    }

    /**
     * Handle speech recognition results and trigger translation
     * @param {string} sessionId - Session identifier
     * @param {Object} speechResult - Google Cloud Speech result
     * @param {Object} options - Translation options
     */
    async processSpeechData(sessionId, speechResult) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        try {
            if (speechResult.results && speechResult.results.length > 0) {
                const result = speechResult.results[0];
                
                if (result.isFinal) {
                    const transcript = result.alternatives[0].transcript;
                    const confidence = result.alternatives[0].confidence;
                    const speakerTag = result.alternatives[0].words?.[0]?.speakerTag || 0;

                    // Create structured result
                    const processedResult = {
                        sessionId,
                        timestamp: new Date(),
                        speaker: speakerTag === 1 ? 'doctor' : 'field_medic',
                        originalText: transcript,
                        confidence: confidence,
                        language: session.config.config.languageCode,
                        wordTimestamps: result.alternatives[0].words || [],
                        translations: {}
                    };

                    // Translate to target languages
                    for (const targetLang of session.targetLanguages) {
                        try {
                            const translation = this.translateText(transcript, targetLang);
                            processedResult.translations[targetLang] = translation;
                        } catch (translationError) {
                            this.logger.error('Translation failed', { 
                                error: translationError.message, 
                                targetLang,
                                sessionId 
                            });
                        }
                    }

                    // Store result
                    session.results.push(processedResult);

                    // Execute callback
                    session.callbacks.onResult(processedResult);

                    this.logger.info('Speech processed and translated', {
                        sessionId,
                        speaker: processedResult.speaker,
                        originalLength: transcript.length,
                        confidence,
                        targetLanguages: session.targetLanguages
                    });
                }
            }
        } catch (error) {
            this.logger.error('Failed to process speech data', { 
                error: error.message, 
                sessionId 
            });
        }
    }

    /**
     * Translate text using Google Cloud Translation API
     * @param {string} text - Text to translate
     * @param {string} targetLanguage - Target language code
     * @param {string} sourceLanguage - Source language code (optional)
     * @returns {Object} Translation result with metadata
     */
    async translateText(text, targetLanguage, sourceLanguage = null) {
        try {
            const request = {
                q: text,
                target: targetLanguage,
                format: 'text'
            };

            if (sourceLanguage) {
                request.source = sourceLanguage;
            }

            const [translation] = await this.translateClient.translate(text, targetLanguage);
            const [detection] = sourceLanguage ? [null] : await this.translateClient.detect(text);

            return {
                originalText: text,
                translatedText: translation,
                sourceLanguage: sourceLanguage || detection?.language,
                targetLanguage: targetLanguage,
                confidence: detection?.confidence || 1.0,
                timestamp: new Date()
            };
        } catch (error) {
            this.logger.error('Translation failed', { 
                error: error.message, 
                text: text.substring(0, 50), 
                targetLanguage 
            });
            throw error;
        }
    }

    /**
     * Convert text to speech for audio playback
     * @param {string} text - Text to synthesize
     * @param {Object} options - TTS options
     * @returns {Buffer} Audio buffer for playback
     */
    async synthesizeSpeech(text, options = {}) {
        const request = {
            input: { text: text },
            voice: {
                languageCode: options.languageCode || 'en-US',
                ssmlGender: options.gender || 'NEUTRAL',
                name: options.voiceName || null
            },
            audioConfig: {
                audioEncoding: options.encoding || 'LINEAR16',
                sampleRateHertz: options.sampleRate || 16000,
                speakingRate: options.speakingRate || 1.0,
                pitch: options.pitch || 0.0,
                volumeGainDb: options.volumeGain || 0.0
            }
        };

        const [response] = await this.ttsClient.synthesizeSpeech(request);
        return response.audioContent;
    }

    /**
     * Get medical terminology phrases for speech context
     * @returns {Array<string>} Medical phrases for improved recognition
     */
    getMedicalPhrases() {
        return [
            // Surgical instruments
            'scalpel', 'forceps', 'clamp', 'retractor', 'suture', 'cautery', 'scissors',
            'hemostats', 'needle holder', 'speculum', 'trocar', 'cannula',
            
            // Medical procedures
            'incision', 'suturing', 'intubation', 'catheterization', 'injection',
            'biopsy', 'drainage', 'resection', 'anastomosis', 'debridement',
            
            // Vital signs and measurements
            'blood pressure', 'heart rate', 'pulse', 'temperature', 'oxygen saturation',
            'respiratory rate', 'blood glucose', 'ECG', 'EKG', 'pulse oximetry',
            
            // Medical conditions
            'hemorrhage', 'shock', 'cardiac arrest', 'respiratory distress',
            'pneumothorax', 'embolism', 'thrombosis', 'sepsis', 'trauma',
            
            // Medications and treatments
            'epinephrine', 'morphine', 'lidocaine', 'atropine', 'dopamine',
            'normal saline', 'lactated ringers', 'oxygen therapy', 'IV fluids',
            
            // Emergency terms
            'emergency', 'urgent', 'critical', 'stable', 'unstable', 'code blue',
            'trauma alert', 'rapid response', 'intensive care', 'operating room'
        ];
    }

    /**
     * Generate unique session ID
     * @returns {string} Unique session identifier
     */
    generateSessionId() {
        return `translation_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Get session information
     * @param {string} sessionId - Session ID
     * @returns {Object} Session data
     */
    getSession(sessionId) {
        return this.activeSessions.get(sessionId);
    }

    /**
     * Stop translation session
     * @param {string} sessionId - Session ID to stop
     */
    async stopSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.isActive = false;
            if (session.stream && session.stream.writable) {
                session.stream.end();
            }
            this.activeSessions.delete(sessionId);
            
            this.logger.info('Translation session stopped', { 
                sessionId, 
                duration: Date.now() - session.startTime.getTime(),
                resultCount: session.results.length
            });
        }
    }

    /**
     * Get supported languages
     * @returns {Object} Supported languages map
     */
    getSupportedLanguages() {
        return this.supportedLanguages;
    }

    /**
     * Error handlers
     */
    handleSpeechResult(sessionId, result) {
        // Override in implementation
        this.logger.info('Speech result received', { sessionId, result });
    }

    handleStreamError(sessionId, error) {
        this.logger.error('Stream error', { sessionId, error: error.message });
    }

    handleStreamEnd(sessionId) {
        this.logger.info('Stream ended', { sessionId });
        this.stopSession(sessionId);
    }
}

module.exports = TranslationService;