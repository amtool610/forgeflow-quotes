FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY lib ./lib
COPY public ./public
COPY server.js ./
COPY README.md ./

RUN mkdir -p /app/data /app/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_ROOT=/var/forgeflow

EXPOSE 3000

CMD ["node", "server.js"]
