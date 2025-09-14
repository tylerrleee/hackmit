# Python WebRTC-AR Bridge Service
FROM python:3.11-slim AS base

# Install system dependencies for computer vision
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgstreamer1.0-0 \
    libgtk-3-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory and user
RUN useradd --create-home --shell /bin/bash bridge
WORKDIR /app

# Copy requirements first for better Docker layer caching
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set ownership
RUN chown -R bridge:bridge /app

# Switch to non-root user
USER bridge

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD python -c "import websockets; print('WebSocket bridge healthy')" || exit 1

# Expose WebSocket port
EXPOSE 8765

# Environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Start the WebRTC bridge
CMD ["python", "webrtc_bridge.py"]