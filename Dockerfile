FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts
RUN node scripts/setup-vendor.js

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

# A persistent volume for SQLite so data survives container restarts.
VOLUME ["/app/backend/data"]

CMD ["node", "--experimental-sqlite", "backend/server.js"]
