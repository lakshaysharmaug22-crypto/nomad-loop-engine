FROM node:22-slim
WORKDIR /app
COPY package.json server.js bugs.manifest.json ./
RUN npm install --omit=dev
ENV PORT=4100
CMD ["node", "server.js"]
