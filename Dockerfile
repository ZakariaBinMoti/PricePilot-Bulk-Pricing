FROM node:20-alpine

EXPOSE 3000
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

CMD ["npm", "run", "docker-start"]
