FROM golang:1.22-alpine AS builder
RUN sed -i "s|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g" /etc/apk/repositories
RUN apk add --no-cache git ca-certificates tzdata gcc musl-dev
ENV GOPROXY=https://goproxy.cn/,direct
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN date > /build/build_time.txt
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/server ./cmd/server

FROM ubuntu:22.04
RUN sed -i "s/archive.ubuntu.com/mirrors.cloud.aliyuncs.com/g" /etc/apt/sources.list &&     apt-get update && apt-get install -y --no-install-recommends     ca-certificates tzdata gcc g++ make strace bpftrace wget     libnl-3-200 libnl-route-3-200 libprotobuf23     && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /out/server .
COPY --from=builder /build/build_time.txt .
COPY nsjail /usr/local/bin/nsjail
RUN chmod +x /usr/local/bin/nsjail
EXPOSE 8080
ENTRYPOINT ["./server"]
