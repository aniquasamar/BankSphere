# ---- build the Vite app
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite bakes VITE_* variables into the bundle, so the API URL is a BUILD argument.
ARG VITE_BASEURL=http://localhost:8080
ENV VITE_BASEURL=$VITE_BASEURL
RUN npm run build

# ---- serve the static files with nginx (non-root)
FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080