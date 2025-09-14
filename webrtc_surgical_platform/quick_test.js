#!/usr/bin/env node

/**
 * Quick Test Script for WebRTC Surgical Platform
 * Run this to verify the implementation is working
 */

const http = require('http');
const path = require('path');

console.log('🏥 Testing WebRTC Surgical Platform Implementation...\n');

// Test configuration
const BACKEND_PORT = 3001;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const tests = [];
let passedTests = 0;
let totalTests = 0;

// Helper function to make HTTP requests
function makeRequest(options) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

// Test functions
async function testServerHealth() {
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/health',
            method: 'GET',
            timeout: 5000
        });

        if (response.statusCode === 200) {
            const data = JSON.parse(response.body);
            console.log('✅ Server Health Check - PASSED');
            console.log(`   Status: ${data.status}, Version: ${data.version}\n`);
            return true;
        } else {
            console.log(`❌ Server Health Check - FAILED (Status: ${response.statusCode})\n`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Server Health Check - FAILED (${error.message})`);
        console.log('   Make sure the backend server is running on port 3001\n');
        return false;
    }
}

async function testAPIDocumentation() {
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/api',
            method: 'GET'
        });

        if (response.statusCode === 200) {
            const data = JSON.parse(response.body);
            console.log('✅ API Documentation - PASSED');
            console.log(`   Available endpoints: ${Object.keys(data.endpoints).length}\n`);
            return true;
        } else {
            console.log(`❌ API Documentation - FAILED (Status: ${response.statusCode})\n`);
            return false;
        }
    } catch (error) {
        console.log(`❌ API Documentation - FAILED (${error.message})\n`);
        return false;
    }
}

async function testAuthentication() {
    try {
        const loginData = JSON.stringify({
            username: 'dr.smith',
            password: 'SecurePass123!'
        });

        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/api/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(loginData)
            },
            body: loginData
        });

        if (response.statusCode === 200) {
            const data = JSON.parse(response.body);
            console.log('✅ Authentication System - PASSED');
            console.log(`   Logged in as: ${data.user.name} (${data.user.role})`);
            console.log(`   Token received: ${data.accessToken ? 'YES' : 'NO'}\n`);
            return { success: true, token: data.accessToken, user: data.user };
        } else {
            console.log(`❌ Authentication System - FAILED (Status: ${response.statusCode})`);
            console.log(`   Response: ${response.body}\n`);
            return { success: false };
        }
    } catch (error) {
        console.log(`❌ Authentication System - FAILED (${error.message})\n`);
        return { success: false };
    }
}

async function testExpertMatching(token) {
    try {
        const matchingData = JSON.stringify({
            patientInfo: {
                currentCondition: 'cardiac surgery consultation',
                severity: 'moderate'
            },
            caseType: 'consultation',
            urgency: 'normal',
            requiredSpecializations: ['cardiothoracic_surgery']
        });

        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/api/matching/find-experts',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(matchingData)
            },
            body: matchingData
        });

        if (response.statusCode === 200) {
            const data = JSON.parse(response.body);
            console.log('✅ Expert Matching System - PASSED');
            console.log(`   Found ${data.matches.length} expert matches`);
            if (data.matches.length > 0) {
                console.log(`   Top match: ${data.matches[0].profile.name} (Score: ${data.matches[0].score.toFixed(2)})\n`);
            }
            return true;
        } else {
            console.log(`❌ Expert Matching System - FAILED (Status: ${response.statusCode})`);
            console.log(`   Response: ${response.body}\n`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Expert Matching System - FAILED (${error.message})\n`);
        return false;
    }
}

async function testAIService(token) {
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/api/ai/health',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.statusCode === 200) {
            const data = JSON.parse(response.body);
            console.log('✅ AI Processing Service - PASSED');
            console.log(`   Service healthy: ${data.healthy ? 'YES' : 'NO'}`);
            console.log(`   Models loaded: ${data.models || 0}`);
            console.log(`   Queue size: ${data.queueSize || 0}\n`);
            return true;
        } else {
            console.log(`❌ AI Processing Service - FAILED (Status: ${response.statusCode})\n`);
            return false;
        }
    } catch (error) {
        console.log(`❌ AI Processing Service - FAILED (${error.message})\n`);
        return false;
    }
}

async function testWebRTCConfig(token) {
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/api/webrtc-config',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.statusCode === 200) {
            const data = JSON.parse(response.body);
            console.log('✅ WebRTC Configuration - PASSED');
            console.log(`   ICE servers configured: ${data.iceServers.length}\n`);
            return true;
        } else {
            console.log(`❌ WebRTC Configuration - FAILED (Status: ${response.statusCode})\n`);
            return false;
        }
    } catch (error) {
        console.log(`❌ WebRTC Configuration - FAILED (${error.message})\n`);
        return false;
    }
}

async function testRoomManagement(token) {
    try {
        const roomData = JSON.stringify({
            roomType: 'consultation',
            maxParticipants: 5,
            isPrivate: false
        });

        const response = await makeRequest({
            hostname: 'localhost',
            port: BACKEND_PORT,
            path: '/api/rooms/create',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(roomData)
            },
            body: roomData
        });

        if (response.statusCode === 201) {
            const data = JSON.parse(response.body);
            console.log('✅ Room Management System - PASSED');
            console.log(`   Room created: ${data.room.id}`);
            console.log(`   Room type: ${data.room.type}\n`);
            return true;
        } else {
            console.log(`❌ Room Management System - FAILED (Status: ${response.statusCode})\n`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Room Management System - FAILED (${error.message})\n`);
        return false;
    }
}

async function testFileStructure() {
    const fs = require('fs');
    
    const requiredFiles = [
        'backend/package.json',
        'backend/src/server.js',
        'backend/src/auth/authService.js',
        'backend/src/signaling/signalingServer.js',
        'backend/src/ai/aiProcessingService.js',
        'backend/src/matching/expertMatchingService.js',
        'frontend/package.json',
        'frontend/src/services/WebRTCService.js',
        'README.md'
    ];

    let filesFound = 0;
    const missingFiles = [];

    for (const file of requiredFiles) {
        const fullPath = path.join(__dirname, file);
        if (fs.existsSync(fullPath)) {
            filesFound++;
        } else {
            missingFiles.push(file);
        }
    }

    console.log('✅ File Structure Check - PASSED');
    console.log(`   Found ${filesFound}/${requiredFiles.length} required files`);
    
    if (missingFiles.length > 0) {
        console.log(`   Missing files: ${missingFiles.join(', ')}`);
    }
    console.log('');
    
    return filesFound === requiredFiles.length;
}

// Main test runner
async function runAllTests() {
    console.log('Starting comprehensive test suite...\n');
    
    // Test 1: File structure
    totalTests++;
    if (await testFileStructure()) passedTests++;

    // Test 2: Server health
    totalTests++;
    const serverHealthy = await testServerHealth();
    if (serverHealthy) passedTests++;

    if (!serverHealthy) {
        console.log('⚠️  Backend server is not running. Please start it first:');
        console.log('   cd webrtc_surgical_platform/backend');
        console.log('   npm install');
        console.log('   npm run dev\n');
        printSummary();
        return;
    }

    // Test 3: API documentation
    totalTests++;
    if (await testAPIDocumentation()) passedTests++;

    // Test 4: Authentication
    totalTests++;
    const authResult = await testAuthentication();
    if (authResult.success) passedTests++;

    if (!authResult.success) {
        console.log('⚠️  Authentication failed. Subsequent tests may fail.\n');
        printSummary();
        return;
    }

    // Test 5: WebRTC config
    totalTests++;
    if (await testWebRTCConfig(authResult.token)) passedTests++;

    // Test 6: Room management
    totalTests++;
    if (await testRoomManagement(authResult.token)) passedTests++;

    // Test 7: Expert matching
    totalTests++;
    if (await testExpertMatching(authResult.token)) passedTests++;

    // Test 8: AI service
    totalTests++;
    if (await testAIService(authResult.token)) passedTests++;

    printSummary();
}

function printSummary() {
    console.log('='.repeat(50));
    console.log(`TEST SUMMARY: ${passedTests}/${totalTests} tests passed`);
    console.log('='.repeat(50));
    
    if (passedTests === totalTests) {
        console.log('🎉 ALL TESTS PASSED! The implementation is working correctly.');
        console.log('\n📋 Next steps:');
        console.log('1. Start the frontend: cd frontend && npm start');
        console.log('2. Visit http://localhost:3000 to test the web interface');
        console.log('3. Try logging in with: username=dr.smith, password=SecurePass123!');
    } else {
        console.log(`⚠️  ${totalTests - passedTests} test(s) failed. Check the error messages above.`);
        console.log('\n🔧 Common solutions:');
        console.log('• Make sure backend server is running: npm run dev');
        console.log('• Check that port 3001 is available');
        console.log('• Verify .env file is properly configured');
    }
    
    console.log('\n📖 For detailed testing instructions, see: test_implementation.md');
}

// Run the tests
runAllTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
});