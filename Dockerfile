# -------------------
# Development stage
# -------------------
FROM node:18-alpine AS development

WORKDIR /usr/src/app

# Copy package files first
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose port
EXPOSE 3000

# Use dev start command (watch mode)
CMD ["npm", "run", "start:dev"]

# -------------------
# Production stage
# -------------------
FROM node:18-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built files from development stage
COPY --from=development /usr/src/app/dist ./dist

EXPOSE 3000

# Start production server
CMD ["node", "dist/main"]
