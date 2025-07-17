# Use the official Node.js 18 image
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Bundle app source
COPY . .

# Create logs directory with write permissions
RUN mkdir -p logs && chown -R node:node logs

# Use non-root user
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Expose the health check port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
