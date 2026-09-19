FROM node:22

# Create app directory and set ownership
RUN mkdir -p /usr/src/node-app && chown -R node:node /usr/src/node-app

WORKDIR /usr/src/node-app

# Copy package files first for Docker layer caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy application source code
COPY --chown=node:node . .

# Build TypeScript
RUN npm run build

# Run as non-root user
USER node

EXPOSE 5020

# Start production application
CMD ["node", "build/src/index.js"]