FROM node:20-bullseye

ENV npm_config_loglevel=warn \
    npm_config_fund=false \
    npm_config_audit=false

# ---- Add system deps required to build node-canvas ----
RUN apt-get update && apt-get install -y \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

# Serverless CLI for offline
RUN npm i -g serverless@^3

# Build context == repo root (compose uses ../)
WORKDIR /app
COPY . .

WORKDIR /app/coins
CMD [ "sh", "-lc", "serverless offline start --stage ${STAGE:-local} --region ${AWS_REGION:-us-east-1}" ]
