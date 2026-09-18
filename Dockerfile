FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY cornerstone-package/src ./cornerstone-package/src
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
