FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Render exposes the assigned public URL as build arguments. These values are
# public deployment metadata, not secrets, and let React Router compile the
# correct action origin into the production bundle.
ARG SHOPIFY_APP_URL
ARG RENDER_EXTERNAL_URL
ARG RENDER_EXTERNAL_HOSTNAME
ENV SHOPIFY_APP_URL=$SHOPIFY_APP_URL
ENV RENDER_EXTERNAL_URL=$RENDER_EXTERNAL_URL
ENV RENDER_EXTERNAL_HOSTNAME=$RENDER_EXTERNAL_HOSTNAME

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
