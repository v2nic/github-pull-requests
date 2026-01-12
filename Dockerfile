# Use Node.js 20 Alpine as base image
FROM node:20-alpine

# Install GitHub CLI using specific version binary for Alpine
RUN apk add --no-cache \
    curl \
    bash \
    git \
    && GH_VERSION="2.40.1" \
    && curl -L "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o gh.tar.gz \
    && tar xzvf gh.tar.gz \
    && mv "gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/ \
    && rm -rf gh.tar.gz "gh_${GH_VERSION}_linux_amd64"

# Create directory for GitHub CLI configuration persistence
RUN mkdir -p /home/nextjs/.config/gh

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies for build
RUN npm ci

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Install only production dependencies to reduce image size
RUN npm prune --production

# Expose port 4477
EXPOSE 4477

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership of the app directory
RUN chown -R nextjs:nodejs /app

# Create GitHub CLI config directory with proper ownership before switching users
RUN mkdir -p /home/nextjs/.config/gh && chown -R nextjs:nodejs /home/nextjs

# Switch to non-root user
USER nextjs

# Set HOME environment variable
ENV HOME=/home/nextjs

# Start the application
CMD ["npm", "start"]
