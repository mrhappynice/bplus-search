FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libstdc++6 libgcc-s1 \
  && rm -rf /var/lib/apt/lists/*

COPY exes/ /usr/local/bin/

RUN chmod +x /usr/local/bin/* || true
WORKDIR /usr/local/bin

ENV SEARXNG_URL=http://localhost:8080 \
    USE_NATIVE=1

EXPOSE 3001
CMD ["./bplus-search"]
