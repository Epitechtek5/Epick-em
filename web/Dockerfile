# Image du front web : docker build -t epickem-web web/
# Étape 1 : build statique Vite
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

# Étape 2 : service des fichiers statiques (non-root, port 8080)
FROM nginxinc/nginx-unprivileged:stable-alpine
# Rendu au démarrage en /etc/nginx/conf.d/default.conf (envsubst de l'image)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=api-public:8080 \
    NGINX_RESOLVER=127.0.0.11
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
