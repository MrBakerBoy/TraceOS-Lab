# TraceOS Lab 进程实验镜像
# 基于基础镜像，添加进程管理相关工具

FROM traceos-lab/base:latest

LABEL maintainer="TraceOS Lab <traceos@lab.com>"
LABEL description="进程实验镜像 - 进程管理工具集"

USER root

# 安装进程管理相关工具
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    psmisc \
    procps \
    sysvinit-utils \
    htop \
    iotop \
    lsof \
    strace \
    ltrace \
    && rm -rf /var/lib/apt/lists/*

# 添加常用工具脚本
RUN mkdir -p /opt/lab/bin && \
    echo '#!/bin/bash' > /opt/lab/bin/ps-tree && \
    echo 'ps -ef --forest' >> /opt/lab/bin/ps-tree && \
    chmod +x /opt/lab/bin/ps-tree && \
    echo '#!/bin/bash' > /opt/lab/bin/list-fds && \
    echo 'pid=${1:-$$}' && \
    echo 'echo "Process $pid file descriptors:"' && \
    echo 'ls -l /proc/$pid/fd/' >> /opt/lab/bin/list-fds && \
    chmod +x /opt/lab/bin/list-fds

# 设置 student 用户为 owner
RUN chown -R student:student /opt/lab

USER student

# 设置工作目录
WORKDIR /home/student/lab

CMD ["/bin/bash"]