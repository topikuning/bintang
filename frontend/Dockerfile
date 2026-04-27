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
# Use the templates feature: any *.template under /etc/nginx/templates is
# run through envsubst at container start. So ${PORT} below is substituted
# from the runtime env. Default to 80 if PORT is not provided.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=80
EXPOSE 80
