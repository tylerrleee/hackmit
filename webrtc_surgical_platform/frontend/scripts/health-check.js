#!/usr/bin/env node
/**
 * Health Check Script for Frontend Deployment
 * Tests API connectivity and deployment configuration
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Import deployment config (simplified version for Node.js)
const deploymentConfig = {
    getApiUrl: () => {
        const target = process.env.REACT_APP_DEPLOYMENT_TARGET || 'local';
        const configs = {
            local: 'http://localhost:3001',
            vercel: process.env.REACT_APP_API_URL || 'https://webrtc-surgical-backend.railway.app',
            railway: 'https://webrtc-surgical-backend.railway.app',
            render: 'https://webrtc-surgical-backend.onrender.com',
            ngrok: process.env.REACT_APP_API_URL || 'https://your-backend.ngrok-free.app'
        };
        return configs[target];
    }
};

async function checkApiHealth() {
    const apiUrl = deploymentConfig.getApiUrl();
    console.log(`🔍 Checking API health: ${apiUrl}/api/health`);
    
    try {
        const response = await axios.get(`${apiUrl}/api/health`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'WebRTC-Surgical-Platform-HealthCheck/1.0'
            }
        });
        
        console.log('✅ API Health Check: PASSED');
        console.log('   Status:', response.status);
        console.log('   Data:', response.data);
        return true;
    } catch (error) {
        console.log('❌ API Health Check: FAILED');
        console.log('   Error:', error.message);
        if (error.response) {
            console.log('   Status:', error.response.status);
            console.log('   Data:', error.response.data);
        }
        return false;
    }
}

async function checkBuildStatus() {
    console.log('🏗️  Checking build configuration...');
    
    const buildDir = path.join(__dirname, '../build');
    const indexPath = path.join(buildDir, 'index.html');
    
    if (fs.existsSync(buildDir) && fs.existsSync(indexPath)) {
        console.log('✅ Build Status: READY');
        
        const stats = fs.statSync(buildDir);
        console.log('   Build Directory:', buildDir);
        console.log('   Last Modified:', stats.mtime.toISOString());
        
        // Check build size
        const buildSize = getBuildSize(buildDir);
        console.log('   Build Size:', formatBytes(buildSize));
        
        return true;
    } else {
        console.log('❌ Build Status: NOT FOUND');
        console.log('   Run "npm run build" to create production build');
        return false;
    }
}

function getBuildSize(dir) {
    let size = 0;
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
            size += getBuildSize(filePath);
        } else {
            size += stats.size;
        }
    }
    
    return size;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function checkEnvironmentConfiguration() {
    console.log('⚙️  Checking environment configuration...');
    
    const deploymentTarget = process.env.REACT_APP_DEPLOYMENT_TARGET || 'local';
    const environment = process.env.NODE_ENV || 'development';
    
    console.log('✅ Environment Configuration:');
    console.log('   Deployment Target:', deploymentTarget);
    console.log('   Node Environment:', environment);
    console.log('   API URL:', deploymentConfig.getApiUrl());
    console.log('   WebSocket URL:', process.env.REACT_APP_WS_URL || 'Not configured');
    console.log('   AR Bridge URL:', process.env.REACT_APP_AR_BRIDGE_URL || 'Not configured');
    
    return true;
}

async function runHealthChecks() {
    console.log('🏥 WebRTC Surgical Platform - Frontend Health Check');
    console.log('================================================');
    
    const checks = [
        { name: 'Environment Configuration', fn: checkEnvironmentConfiguration },
        { name: 'Build Status', fn: checkBuildStatus },
        { name: 'API Connectivity', fn: checkApiHealth }
    ];
    
    const results = {};
    let allPassed = true;
    
    for (const check of checks) {
        console.log(`\n🔄 Running ${check.name}...`);
        try {
            results[check.name] = await check.fn();
            allPassed = allPassed && results[check.name];
        } catch (error) {
            console.log(`❌ ${check.name}: ERROR - ${error.message}`);
            results[check.name] = false;
            allPassed = false;
        }
    }
    
    console.log('\n📊 Health Check Summary:');
    console.log('========================');
    
    Object.entries(results).forEach(([name, passed]) => {
        const status = passed ? '✅ PASSED' : '❌ FAILED';
        console.log(`${name}: ${status}`);
    });
    
    console.log(`\nOverall Status: ${allPassed ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
    
    if (!allPassed) {
        console.log('\n🚨 Some health checks failed. Please review the errors above.');
        process.exit(1);
    } else {
        console.log('\n🎉 All health checks passed! System is ready for deployment.');
        process.exit(0);
    }
}

// Run health checks if this script is executed directly
if (require.main === module) {
    runHealthChecks().catch(error => {
        console.error('💥 Health check script failed:', error);
        process.exit(1);
    });
}

module.exports = {
    checkApiHealth,
    checkBuildStatus,
    checkEnvironmentConfiguration,
    runHealthChecks
};