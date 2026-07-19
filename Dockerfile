FROM docker.io/cloudflare/sandbox:0.8.14

RUN apt-get update \
  && apt-get install -y --no-install-recommends imagemagick \
  && rm -rf /var/lib/apt/lists/*
