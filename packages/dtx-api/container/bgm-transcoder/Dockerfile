FROM oven/bun:1.3.9-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY server.ts .

USER bun
EXPOSE 8080

CMD ["bun", "server.ts"]
