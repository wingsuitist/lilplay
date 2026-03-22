FROM denoland/deno:2.3.3

WORKDIR /app

# Copy server and public files
COPY server/ ./server/
COPY public/ ./public/

# Cache dependencies
RUN deno cache server/main.ts

# Data volume will be mounted at /data
VOLUME ["/data"]

ENV DATA_PATH=/data/data.json
ENV PORT=8080
ENV PUBLIC_DIR=/app/public

EXPOSE 8080

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "server/main.ts"]
