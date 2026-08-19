# ===== 后端多阶段构建 =====
FROM node:20-alpine AS build
WORKDIR /app
COPY apps/server/package*.json ./
RUN npm ci
COPY apps/server/ ./
RUN npm run build

# ===== 运行时（带产物 + Python 环境，供 edge-tts 语音合成）=====
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 py3-pip && \
    pip install --no-cache-dir --break-system-packages edge-tts && \
    ln -sf /usr/bin/python3 /usr/local/bin/python
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
