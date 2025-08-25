FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# Install all dependencies (needed for build)
RUN npm install && npm cache clean --force

# Copy source code and public files
COPY src/ ./src/
COPY public/ ./public/

# Build the application
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Health check using curl
RUN apk add --no-cache curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV ENVIRONMENT=production

# Run the application
CMD ["npm", "run", "start:prod"]