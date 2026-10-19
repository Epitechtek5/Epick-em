# Image commune aux binaires du workspace : docker build --build-arg BIN=api-public backend/
FROM rust:1-slim-bookworm AS build
ARG BIN
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --bin "${BIN}" \
 && cp "target/release/${BIN}" /app

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /app /app
ENTRYPOINT ["/app"]
