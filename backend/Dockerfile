# Image commune aux binaires du workspace : docker build --build-arg BIN=api-public backend/
FROM rust:1-slim-bookworm AS build
ARG BIN
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked --bin "${BIN}" \
 && cp "target/release/${BIN}" /app

FROM gcr.io/distroless/cc-debian12:nonroot
# Argon2 alloue 19 Mio par hachage (inscription, connexion). Sans seuil fixe, glibc relève son
# seuil mmap dès la première libération : ces blocs restent ensuite dans le tas et ne sont pas
# rendus au système. Mesuré sur k8s : 1,2 à 1,8 Go de RSS après 100 connexions (OOMKilled à
# 512 Mio) contre 67 Mo (pic 220 Mo) avec ce réglage. Voir docs/exploitation/deploiement.md.
ENV MALLOC_MMAP_THRESHOLD_=131072
COPY --from=build /app /app
ENTRYPOINT ["/app"]
