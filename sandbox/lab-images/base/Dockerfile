# TraceOS Lab 基础实验镜像
# 提供完整的 C/C++ 开发环境，支持各种操作系统实验

FROM ubuntu:22.04

LABEL maintainer="TraceOS Lab <traceos@lab.com>"
LABEL description="基础实验镜像 - C/C++ 开发环境"

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV TZ=Asia/Shanghai

# 创建 student 用户
RUN groupadd -r student && \
    useradd -r -g student -m -s /bin/bash student && \
    echo 'student:student' | chpasswd && \
    mkdir -p /home/student/lab && \
    chown -R student:student /home/student

# 安装基础工具
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    clang \
    clang-format \
    make \
    cmake \
    gdb \
    valgrind \
    strace \
    ltrace \
    perf \
    bpfcc-tools \
    bpftrace \
    linux-tools-generic \
    linux-headers-generic \
    libcap-dev \
    libseccomp-dev \
    libc6-dev \
    libc-devtools \
    binutils \
    binutils-common \
    binutils-x86-64-linux-gnu \
    libc-bin \
    libc6 \
    locales \
    tzdata \
    curl \
    wget \
    vim \
    nano \
    less \
    tree \
    htop \
    procps \
    psmisc \
    file \
    time \
    bc \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 生成 locale
RUN locale-gen en_US.UTF-8

# 安装 Python 工具（可选，用于某些实验）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    && pip3 install --no-cache-dir \
    psutil \
    && rm -rf /var/lib/apt/lists/*

# 安装 Rust 工具链（可选）
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal && \
    /root/.cargo/env && \
    echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> /root/.bashrc && \
    echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> /home/student/.bashrc

# 安装 Go 工具链（可选）
RUN wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz -O /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz && \
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /root/.bashrc && \
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /home/student/.bashrc

# 配置环境变量
ENV PATH="/usr/local/go/bin:/root/.cargo/bin:$PATH"

# 创建实验目录结构
RUN mkdir -p /opt/lab/{bin,lib,include,data}

# 设置工作目录
WORKDIR /home/student/lab

# 配置 bashrc
RUN echo 'export PS1="\[\e[1;32m\]\u@traceos:\w\$\[\e[0m\] "' >> /home/student/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/student/.bashrc && \
    echo 'alias l="ls -laF"' >> /home/student/.bashrc && \
    echo 'alias ..="cd .."' >> /home/student/.bashrc && \
    echo 'alias ...="cd ../.."' >> /home/student/.bashrc && \
    echo 'export EDITOR=vim' >> /home/student/.bashrc

# 切换到 student 用户
USER student

# 暴露工作目录
VOLUME ["/home/student/lab"]

# 默认命令
CMD ["/bin/bash"]