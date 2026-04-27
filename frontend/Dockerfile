FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json .npmrc* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY . .
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
