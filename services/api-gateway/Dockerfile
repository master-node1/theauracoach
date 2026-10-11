# Build from the repository root: docker build -f services/api-gateway/Dockerfile .
FROM nginx:1.28-alpine
RUN apk upgrade --no-cache
ENV GATEWAY_RATE_PER_SECOND=20 \
    NGINX_ENVSUBST_FILTER="^(GATEWAY_|[A-Z]+_UPSTREAM$)"
COPY services/api-gateway/default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
EXPOSE 8080
