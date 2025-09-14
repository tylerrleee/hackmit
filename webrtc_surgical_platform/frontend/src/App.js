import React, { useState, useEffect } from 'react';
import axios from 'axios';
import RoomVideoConsultation from './components/RoomVideoConsultation';
import externalConfig from './config/externalConfig';
import './App.css';

function App() {
  const [backendStatus, setBackendStatus] = useState('checking');
  const [loginData, setLoginData] = useState({ username: '', password: '' });
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [activeTab, setActiveTab] = useState('login');
  const [systemStats, setSystemStats] = useState(null);
  
  // Room video consultation state
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [isInVideoCall, setIsInVideoCall] = useState(false);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [createRoomLoading, setCreateRoomLoading] = useState(false);

  // Check backend health on component mount
  useEffect(() => {
    checkBackendHealth();
  }, []);

  // Auto-login if token exists
  useEffect(() => {
    if (token && !user) {
      // Verify token is still valid by making an authenticated request
      axios.get(`${externalConfig.getApiUrl()}/api/webrtc-config`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(() => {
        // Token is valid, but we need user info
        setActiveTab('dashboard');
      }).catch(() => {
        // Token is invalid, clear it
        localStorage.removeItem('token');
        setToken(null);
      });
    }
  }, [token, user]);

  const checkBackendHealth = async () => {
    try {
      const response = await axios.get(`${externalConfig.getApiUrl()}/health`);
      setBackendStatus('online');
      console.log('Backend health:', response.data);
    } catch (error) {
      setBackendStatus('offline');
      console.error('Backend health check failed:', error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${externalConfig.getApiUrl()}/api/auth/login`, loginData);
      
      if (response.data.success) {
        setUser(response.data.user);
        setToken(response.data.tokens.accessToken);
        localStorage.setItem('token', response.data.tokens.accessToken);
        setActiveTab('dashboard');
        
        // Load system stats
        loadSystemStats(response.data.tokens.accessToken);
      }
    } catch (error) {
      alert('Login failed: ' + (error.response?.data?.error || error.message));
    }
  };

  const loadSystemStats = async (authToken) => {
    try {
      const [webrtcConfig, aiHealth] = await Promise.all([
        axios.get(`${externalConfig.getApiUrl()}/api/webrtc-config`, {
          headers: { Authorization: `Bearer ${authToken}` }
        }),
        axios.get(`${externalConfig.getApiUrl()}/api/ai/health`, {
          headers: { Authorization: `Bearer ${authToken}` }
        })
      ]);

      setSystemStats({
        webrtc: webrtcConfig.data,
        ai: aiHealth.data
      });
    } catch (error) {
      console.error('Failed to load system stats:', error);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    setSystemStats(null);
    localStorage.removeItem('token');
    setActiveTab('login');
  };

  const testExpertMatching = async () => {
    try {
      const response = await axios.post(`${externalConfig.getApiUrl()}/api/matching/find-experts`, {
        patientInfo: {
          currentCondition: 'cardiac surgery consultation',
          severity: 'moderate'
        },
        caseType: 'consultation',
        urgency: 'normal',
        requiredSpecializations: ['cardiothoracic_surgery']
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(`Found ${response.data.matches.length} expert matches!\nTop match: ${response.data.matches[0]?.profile.name}`);
    } catch (error) {
      alert('Expert matching failed: ' + error.response?.data?.error);
    }
  };

  // Room management functions
  const createRoom = async () => {
    try {
      setCreateRoomLoading(true);
      const response = await axios.post(`${externalConfig.getApiUrl()}/api/rooms/create`, {
        roomType: 'ar-consultation',
        metadata: {
          medicalSpecialty: 'surgery',
          arAnnotations: true,
          createdBy: user.name
        }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const roomId = response.data.room.id;
      
      // Automatically join the created room
      setCurrentRoomId(roomId);
      setIsInVideoCall(true);
      setActiveTab('video-call');
      
    } catch (error) {
      alert('Room creation failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setCreateRoomLoading(false);
    }
  };

  const joinRoom = async (roomId) => {
    try {
      // Validate room exists and user has access
      const response = await axios.get(`${externalConfig.getApiUrl()}/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setCurrentRoomId(roomId);
        setIsInVideoCall(true);
        setActiveTab('video-call');
      }
    } catch (error) {
      alert('Failed to join room: ' + (error.response?.data?.error || error.message));
    }
  };

  const leaveRoom = () => {
    setCurrentRoomId(null);
    setIsInVideoCall(false);
    setActiveTab('dashboard');
  };

  const loadAvailableRooms = async () => {
    try {
      const response = await axios.get(`${externalConfig.getApiUrl()}/api/rooms/user/rooms`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setAvailableRooms(response.data.rooms || []);
      }
    } catch (error) {
      console.error('Failed to load rooms:', error);
    }
  };

  return (
    <div className="App">
      <header className="medical-header">
        <h1>🏥 WebRTC Surgical Guidance Platform</h1>
        <div className="status-bar">
          <span className={`status-indicator ${backendStatus === 'online' ? 'status-online' : 'status-offline'}`}></span>
          Backend: {backendStatus === 'online' ? 'Online' : 'Offline'}
          {user && (
            <>
              <span style={{margin: '0 20px'}}>|</span>
              <span>👤 {user.name} ({user.role})</span>
              <button onClick={handleLogout} style={{marginLeft: '10px', padding: '5px 10px'}}>
                Logout
              </button>
            </>
          )}
        </div>
      </header>

      <div className="container">
        {backendStatus === 'offline' && (
          <div className="alert alert-error">
            <h3>⚠️ Backend Server Offline</h3>
            <p>Please make sure the backend server is running on port 3001:</p>
            <pre>cd backend && npm run dev</pre>
            <button onClick={checkBackendHealth}>Retry Connection</button>
          </div>
        )}

        {backendStatus === 'online' && (
          <div className="tabs">
            <div className="tab-buttons">
              {!user && (
                <button 
                  className={activeTab === 'login' ? 'active' : ''} 
                  onClick={() => setActiveTab('login')}
                >
                  Login
                </button>
              )}
              {user && (
                <>
                  <button 
                    className={activeTab === 'dashboard' ? 'active' : ''} 
                    onClick={() => setActiveTab('dashboard')}
                  >
                    Dashboard
                  </button>
                  <button 
                    className={activeTab === 'features' ? 'active' : ''} 
                    onClick={() => setActiveTab('features')}
                  >
                    Features
                  </button>
                  {isInVideoCall && (
                    <button 
                      className={activeTab === 'video-call' ? 'active' : ''} 
                      onClick={() => setActiveTab('video-call')}
                    >
                      📹 Video Call
                    </button>
                  )}
                </>
              )}
              <button 
                className={activeTab === 'api-test' ? 'active' : ''} 
                onClick={() => setActiveTab('api-test')}
              >
                API Test
              </button>
            </div>

            <div className="tab-content">
              {activeTab === 'login' && !user && (
                <div className="login-form">
                  <h2>🔐 Medical Professional Login</h2>
                  <form onSubmit={handleLogin}>
                    <div className="form-group">
                      <label>Username:</label>
                      <input
                        type="text"
                        value={loginData.username}
                        onChange={(e) => setLoginData({...loginData, username: e.target.value})}
                        placeholder="dr.smith"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Password:</label>
                      <input
                        type="password"
                        value={loginData.password}
                        onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                        placeholder="SecurePass123!"
                        required
                      />
                    </div>
                    <button type="submit" className="btn-primary">Login</button>
                  </form>
                  
                  <div className="test-accounts">
                    <h3>Test Accounts:</h3>
                    <div className="account-list">
                      <div onClick={() => setLoginData({username: 'dr.smith', password: 'SecurePass123!'})}>
                        <strong>Dr. Sarah Smith</strong> (Surgeon)<br/>
                        <code>dr.smith / SecurePass123!</code>
                      </div>
                      <div onClick={() => setLoginData({username: 'dr.johnson', password: 'SecurePass123!'})}>
                        <strong>Dr. Michael Johnson</strong> (Doctor)<br/>
                        <code>dr.johnson / SecurePass123!</code>
                      </div>
                      <div onClick={() => setLoginData({username: 'nurse.williams', password: 'SecurePass123!'})}>
                        <strong>Emily Williams</strong> (Nurse)<br/>
                        <code>nurse.williams / SecurePass123!</code>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'dashboard' && user && (
                <div className="dashboard">
                  <h2>🏥 Medical Dashboard</h2>
                  <div className="user-info">
                    <h3>Welcome, {user.name}!</h3>
                    <p><strong>Role:</strong> {user.role}</p>
                    <p><strong>Specialization:</strong> {user.specialization || 'General'}</p>
                    <p><strong>Permissions:</strong> {user.permissions?.length || 0} granted</p>
                  </div>

                  {systemStats && (
                    <div className="system-stats">
                      <h3>🔧 System Status</h3>
                      <div className="stats-grid">
                        <div className="stat-card">
                          <h4>WebRTC Configuration</h4>
                          <p>ICE Servers: {systemStats.webrtc.iceServers?.length || 0}</p>
                          <p>Status: ✅ Ready</p>
                        </div>
                        <div className="stat-card">
                          <h4>AI Processing</h4>
                          <p>Models: {systemStats.ai.models?.length || 0}</p>
                          <p>Queue: {systemStats.ai.stats?.queueSize || 0} jobs</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'features' && user && (
                <div className="features">
                  <h2>🚀 Platform Features</h2>
                  <div className="feature-grid">
                    <div className="feature-card">
                      <h3>📹 Video Consultation</h3>
                      <p>Real-time WebRTC video calls with medical-grade quality</p>
                      <button 
                        onClick={createRoom} 
                        className="btn-primary"
                        disabled={createRoomLoading}
                      >
                        {createRoomLoading ? '⏳ Creating...' : '🆕 Create New Room'}
                      </button>
                    </div>
                    <div className="feature-card">
                      <h3>🤖 AI Analysis</h3>
                      <p>Surgical video analysis with anatomy and instrument recognition</p>
                      <button className="btn-primary" disabled>Analyze Video</button>
                    </div>
                    <div className="feature-card">
                      <h3>👨‍⚕️ Expert Matching</h3>
                      <p>AI-powered expert recommendations for complex cases</p>
                      <button onClick={testExpertMatching} className="btn-primary">Find Experts</button>
                    </div>
                    <div className="feature-card">
                      <h3>🔐 Security</h3>
                      <p>HIPAA-compliant authentication and data encryption</p>
                      <button className="btn-primary" disabled>Security Settings</button>
                    </div>
                  </div>

                  {/* Room Management Section */}
                  <div className="room-management">
                    <h3>🏥 Active Consultation Rooms</h3>
                    <div className="room-controls">
                      <button 
                        onClick={loadAvailableRooms} 
                        className="btn-secondary"
                      >
                        🔄 Refresh Rooms
                      </button>
                      <button 
                        onClick={createRoom} 
                        className="btn-primary"
                        disabled={createRoomLoading}
                      >
                        {createRoomLoading ? '⏳ Creating...' : '➕ New AR Consultation Room'}
                      </button>
                    </div>

                    <div className="rooms-grid">
                      {availableRooms.length === 0 ? (
                        <div className="empty-rooms">
                          <p>🔍 No active rooms found</p>
                          <p>Create a new AR consultation room to begin collaborating with field medics.</p>
                        </div>
                      ) : (
                        availableRooms.map(room => (
                          <div key={room.id} className="room-card">
                            <div className="room-header">
                              <h4>🔗 Room {room.id.substring(0, 8)}...</h4>
                              <span className={`room-status ${room.status || 'active'}`}>
                                {room.status === 'active' ? '🟢 Active' : '🔴 Inactive'}
                              </span>
                            </div>
                            <div className="room-details">
                              <p><strong>Type:</strong> {room.roomType || 'ar-consultation'}</p>
                              <p><strong>Created:</strong> {new Date(room.createdAt).toLocaleTimeString()}</p>
                              <p><strong>Participants:</strong> {room.participants?.length || 0}</p>
                              <p><strong>Specialty:</strong> {room.metadata?.medicalSpecialty || 'General'}</p>
                            </div>
                            <div className="room-actions">
                              <button 
                                onClick={() => joinRoom(room.id)}
                                className="btn-primary"
                              >
                                🎥 Join Video Call
                              </button>
                              {room.metadata?.arAnnotations && (
                                <span className="ar-badge">🌟 AR Enabled</span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'video-call' && isInVideoCall && (
                <RoomVideoConsultation
                  roomId={currentRoomId}
                  userToken={token}
                  user={user}
                  onLeaveRoom={leaveRoom}
                  onError={(error) => {
                    console.error('Video consultation error:', error);
                    alert('Video consultation error: ' + error);
                  }}
                />
              )}

              {activeTab === 'api-test' && (
                <div className="api-test">
                  <h2>🧪 API Testing</h2>
                  <div className="api-endpoints">
                    <h3>Available Endpoints:</h3>
                    <ul>
                      <li><code>GET /health</code> - Server health check</li>
                      <li><code>GET /api</code> - API documentation</li>
                      <li><code>POST /api/auth/login</code> - User authentication</li>
                      <li><code>GET /api/webrtc-config</code> - WebRTC configuration</li>
                      <li><code>POST /api/rooms/create</code> - Create consultation room</li>
                      <li><code>POST /api/matching/find-experts</code> - Expert matching</li>
                      <li><code>GET /api/ai/health</code> - AI service status</li>
                    </ul>
                  </div>
                  <button onClick={checkBackendHealth} className="btn-primary">
                    Test Backend Connection
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;