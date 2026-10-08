# --- build stage: compile TypeScript ---
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage: production dependencies + compiled output only ---
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    STORAGE_DIR=/app/storage
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
