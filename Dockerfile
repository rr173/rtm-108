FROM node:18-alpine

WORKDIR /app

COPY server/package.json ./
COPY server/package-lock.json* ./

RUN npm install --production

COPY server/ ./

EXPOSE 3000

CMD ["node", "src/index.js"]
