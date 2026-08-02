FROM node:24-alpine

WORKDIR /app

# Install deps WITHOUT postinstall — the postinstall script lives in
# ./scripts which we haven't copied yet. --ignore-scripts skips it.
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# Now copy the rest of the code, including the script postinstall needed.
COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts

# Run the vendor-copy step manually now that scripts/ is in place.
RUN node scripts/setup-vendor.js

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Render assigns PORT via env; backend/lib/config.js reads process.env.PORT.
EXPOSE 3000

# A persistent volume for SQLite so data survives container restarts.
VOLUME ["/app/backend/data"]

CMD ["node", "--experimental-sqlite", "backend/server.js"]
