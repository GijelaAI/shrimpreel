# 成片后处理容器（Cloudflare Containers 要求 linux/amd64）
# c2patool 的 Linux 预编译包需要 glibc 2.39，bookworm（2.36）跑不了，所以用 trixie。
FROM node:24-trixie-slim

ARG C2PATOOL_VERSION=0.27.22
ARG C2PATOOL_SHA256=6f138ad53da1a62f1cd6ee71c60727efa27d13b811f4c0ea8c2a8528968b358b

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl \
  && curl -fsSL -o /tmp/c2patool.tar.gz \
    "https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v${C2PATOOL_VERSION}/c2patool-v${C2PATOOL_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
  && echo "${C2PATOOL_SHA256}  /tmp/c2patool.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/c2patool.tar.gz -C /tmp \
  && install -m 0755 /tmp/c2patool/c2patool /usr/local/bin/c2patool \
  && rm -rf /tmp/c2patool* \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs ./
ENV NODE_ENV=production PORT=8080 FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
