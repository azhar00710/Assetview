# Build stage
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=/api/v1
ARG VITE_AI_ANNOTATE_PILOT_ENABLED=false
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_AI_ANNOTATE_PILOT_ENABLED=$VITE_AI_ANNOTATE_PILOT_ENABLED

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage — lightweight nginx serving built assets
FROM nginx:alpine

# Add .mjs MIME type so pdf.js worker loads correctly
RUN sed -i '/application\/javascript/s/;/ mjs;/' /etc/nginx/mime.types

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
