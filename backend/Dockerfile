FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache poppler-utils

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .

EXPOSE 3001

CMD ["node", "src/server.js"]
