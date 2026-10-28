# MinIO Community has no pullable official image; build the upstream source tags.
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git
ARG MINIO_TAG=RELEASE.2025-10-15T17-29-55Z
ARG MC_TAG=RELEASE.2025-08-13T08-35-41Z
RUN git clone --depth 1 --branch "$MINIO_TAG" https://github.com/minio/minio /src/minio \
 && git clone --depth 1 --branch "$MC_TAG" https://github.com/minio/mc /src/mc
WORKDIR /src/minio
RUN CGO_ENABLED=0 go build -trimpath -o /out/minio .
WORKDIR /src/mc
RUN CGO_ENABLED=0 go build -trimpath -o /out/mc .

FROM alpine:3.22 AS minio
RUN apk add --no-cache ca-certificates curl
COPY --from=build /out/minio /usr/bin/minio
ENTRYPOINT ["/usr/bin/minio"]

FROM alpine:3.22 AS mc
RUN apk add --no-cache ca-certificates
COPY --from=build /out/mc /usr/bin/mc
