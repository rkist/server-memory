FROM node:22-alpine AS builder

WORKDIR /app

# Copy configuration and source files
COPY package.json ./
COPY package-lock.json ./
COPY tsconfig.json ./
COPY index.ts ./

# Install all dependencies and build the project
# The "prepare" script in package.json (npm run build) will be triggered
RUN npm install

# ---- Release Stage ----
FROM node:22-alpine AS release

WORKDIR /app

# Copy package.json and package-lock.json from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]