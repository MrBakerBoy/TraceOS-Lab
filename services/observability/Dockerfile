FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

ENV GOPROXY=https://goproxy.cn,direct

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o /out/server ./cmd/server

FROM golang:1.22-alpine

RUN apk add --no-cache ca-certificates tzdata curl \
    && addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=builder /out/server .

USER app
EXPOSE 9091

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
    CMD curl -sf http://localhost:9091/healthz || exit 1

ENTRYPOINT ["./server"]
