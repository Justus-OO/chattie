FROM golang:1.26.8-bookworm AS build

WORKDIR /src

COPY Chattie-Server/go.mod Chattie-Server/go.sum ./
RUN go mod download

COPY Chattie-Server/ ./
RUN mkdir -p /out \
    && CGO_ENABLED=0 GOOS=linux go build -tags netgo -ldflags="-s -w" -o /out/chattie-server .

FROM debian:bookworm-slim

ENV PORT=8080 \
    CHROME_BIN=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-liberation \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 chattie \
    && useradd --system --uid 10001 --gid chattie --home-dir /app --no-create-home chattie \
    && mkdir -p /app/uploads /app/exports \
    && chown -R chattie:chattie /app

WORKDIR /app

COPY --from=build --chown=chattie:chattie /out/chattie-server ./chattie-server
COPY --from=build --chown=chattie:chattie /src/locales ./locales
COPY --from=build --chown=chattie:chattie /src/templates ./templates

USER chattie

EXPOSE 8080

CMD ["./chattie-server"]
