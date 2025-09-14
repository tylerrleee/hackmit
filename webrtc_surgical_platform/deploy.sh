#!/bin/bash

# WebRTC Surgical Platform Deployment Script
# Automates the deployment process for containerized application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-"development"}
DOCKER_COMPOSE_FILE="docker-compose.yml"

if [ "$ENVIRONMENT" = "production" ]; then
    DOCKER_COMPOSE_FILE="docker-compose.prod.yml"
fi

echo -e "${BLUE}🚀 WebRTC Surgical Platform Deployment${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Docker Compose File: ${DOCKER_COMPOSE_FILE}${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

print_status "Docker is running"

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    print_error "docker-compose is not installed. Please install docker-compose and try again."
    exit 1
fi

print_status "docker-compose is available"

# Check if environment file exists for production
if [ "$ENVIRONMENT" = "production" ]; then
    if [ ! -f ".env.production" ]; then
        print_error ".env.production file not found!"
        echo "Please copy .env.production.example to .env.production and configure it."
        exit 1
    fi
    print_status ".env.production file found"
    export $(grep -v '^#' .env.production | xargs)
fi

echo ""
echo -e "${BLUE}🔄 Starting deployment process...${NC}"

# Stop existing containers
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f $DOCKER_COMPOSE_FILE down --remove-orphans || true

# Remove unused Docker resources
echo -e "${YELLOW}Cleaning up Docker resources...${NC}"
docker system prune -f

# Build images
echo -e "${YELLOW}Building Docker images...${NC}"
docker-compose -f $DOCKER_COMPOSE_FILE build --no-cache

# Verify images were built
echo -e "${YELLOW}Verifying built images...${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    EXPECTED_IMAGES=(
        "surgical-platform-backend-prod"
        "surgical-platform-frontend-prod"
        "surgical-platform-bridge-prod"
    )
else
    EXPECTED_IMAGES=(
        "surgical-platform-backend"
        "surgical-platform-frontend"
        "surgical-platform-bridge"
    )
fi

for image in "${EXPECTED_IMAGES[@]}"; do
    if docker images | grep -q "$image"; then
        print_status "Image $image built successfully"
    else
        print_warning "Image $image not found, continuing..."
    fi
done

# Start services
echo -e "${YELLOW}Starting services...${NC}"
docker-compose -f $DOCKER_COMPOSE_FILE up -d

# Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to become healthy...${NC}"
sleep 30

# Check service health
echo -e "${YELLOW}Checking service health...${NC}"

# Function to check service health
check_service_health() {
    local service_name=$1
    local health_url=$2
    local max_attempts=10
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$health_url" > /dev/null 2>&1; then
            print_status "$service_name is healthy"
            return 0
        fi
        echo -e "${YELLOW}Attempt $attempt/$max_attempts: Waiting for $service_name...${NC}"
        sleep 10
        ((attempt++))
    done
    
    print_error "$service_name health check failed"
    return 1
}

# Health checks
if [ "$ENVIRONMENT" = "production" ]; then
    BACKEND_URL="http://localhost:3001"
    FRONTEND_URL="http://localhost:80"
    BRIDGE_URL="http://localhost:8766"
else
    BACKEND_URL="http://localhost:3001"
    FRONTEND_URL="http://localhost:3000"
    BRIDGE_URL="http://localhost:8766"
fi

# Check backend health
check_service_health "Backend API" "$BACKEND_URL/api/health"

# Check frontend health
check_service_health "Frontend" "$FRONTEND_URL/health"

# Check bridge health
check_service_health "WebRTC Bridge" "$BRIDGE_URL/health"

# Show running containers
echo ""
echo -e "${BLUE}📊 Running containers:${NC}"
docker-compose -f $DOCKER_COMPOSE_FILE ps

# Show resource usage
echo ""
echo -e "${BLUE}💾 Resource usage:${NC}"
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

echo ""
print_status "Deployment completed successfully!"
echo ""
echo -e "${BLUE}🌐 Access URLs:${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    echo -e "Frontend: ${GREEN}http://localhost:80${NC}"
    echo -e "Backend API: ${GREEN}http://localhost:3001${NC}"
    echo -e "WebRTC Bridge: ${GREEN}ws://localhost:8765${NC}"
else
    echo -e "Frontend: ${GREEN}http://localhost:3000${NC}"
    echo -e "Backend API: ${GREEN}http://localhost:3001${NC}"
    echo -e "WebRTC Bridge: ${GREEN}ws://localhost:8765${NC}"
fi
echo ""
echo -e "${BLUE}📝 Test accounts:${NC}"
echo -e "Surgeon: ${GREEN}dr.smith / SecurePass123!${NC}"
echo -e "Doctor: ${GREEN}dr.johnson / SecurePass123!${NC}"
echo -e "Nurse: ${GREEN}nurse.williams / SecurePass123!${NC}"
echo ""
echo -e "${BLUE}🔧 Management commands:${NC}"
echo -e "View logs: ${GREEN}docker-compose -f $DOCKER_COMPOSE_FILE logs -f${NC}"
echo -e "Stop services: ${GREEN}docker-compose -f $DOCKER_COMPOSE_FILE down${NC}"
echo -e "Restart service: ${GREEN}docker-compose -f $DOCKER_COMPOSE_FILE restart <service>${NC}"
echo ""
print_status "WebRTC Surgical Platform is ready for use!"