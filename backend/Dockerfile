FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --include=dev

COPY prisma ./prisma

COPY prisma7.config.ts tsconfig.json ./

COPY lua ./lua

COPY src ./src

RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate \
    && npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production \
    STOCKFISH_PATH=/usr/games/stockfish \
    NODE_OPTIONS=--max-old-space-size=300

USER node

RUN printf 'uci\nquit\n' | /usr/games/stockfish | grep -q 'option name UCI_ShowWDL type check'

RUN node --import tsx --eval "require('argon2'); require('./src/generated/prisma/client.ts')"

EXPOSE 3000

CMD ["node", "--import", "tsx", "src/index.ts"]
