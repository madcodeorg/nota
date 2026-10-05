FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY api ./api
COPY public ./public
COPY server/google-oauth-broker ./server/google-oauth-broker

EXPOSE 8080

CMD ["node", "server/google-oauth-broker/standalone.cjs"]
