FROM node:20-bookworm-slim AS base
# Solo para redes con proxy que intercepta TLS (certificado autofirmado). Dejar vacio en produccion.
ARG NODE_TLS_REJECT_UNAUTHORIZED
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
ARG NODE_TLS_REJECT_UNAUTHORIZED
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime
ARG NODE_TLS_REJECT_UNAUTHORIZED
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
# Volumen persistente de fotografias
RUN mkdir -p /storage/uploads && chown -R node:node /storage /app
USER node
EXPOSE 3001
CMD ["npm", "run", "start:prod"]
