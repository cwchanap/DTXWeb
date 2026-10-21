FROM oven/bun:1.4.3-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY server.ts classifyFailure.ts ./

USER bun
EXPOSE 8080

CMD ["bun", "server.ts"]
