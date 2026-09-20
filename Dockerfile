FROM node:20-alpine

EXPOSE 3000
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run setup
CMD ["npm", "run", "docker-start"]
