# 基于云原生架构与 AI 协同的操作系统在线学习平台设计与实现

Design and Implementation of an Online Learning Platform for Operating Systems Based on Cloud-Native Architecture and AI Collaboration

## 一、赛题背景

操作系统是计算机类专业核心课程，是培养学生系统思维、底层调试与工程实践能力的关键环节。当前操作系统实验教学普遍存在三大痛点：

1. 实验环境难以统一

   本地配置、虚拟机、特定内核版本等环境差异大，实验可复现性差，维护成本高。

2. 传统评测仅重结果

   通用在线评测系统只判断输出是否正确，无法观测系统调用、并发竞争、资源泄漏、死锁等系统级运行过程，难以定位深层错误。

3. 智能反馈与教学脱节

   现有 AI 辅导多为通用问答，未结合操作系统运行轨迹与实验逻辑，无法提供精准、启发式、可解释的教学引导。

本赛题面向操作系统实验教学真实需求，以云原生容器保障环境一致性、以系统调用观测实现运行过程可解释、以测试约束 + AI 协同提供启发式诊断反馈，构建可评测、可教学的操作系统实验在线平台，提升实验教学效率与学习效果，强化学生操作系统底层理解与系统能力。

## 二、赛题任务

本赛题要求参赛队伍实现一个基于云原生容器与系统调用观测的操作系统实验在线评测与 AI 辅助诊断平台，完成从实验提交、环境运行、行为采集、自动评测到智能反馈的全流程支撑。

1. 设计并实现容器化实验运行沙箱，基于容器技术完成操作系统实验环境封装、资源限制、安全隔离与多任务并发调度，确保实验环境统一、可复现、运行稳定。
2. 基于 `strace` 实现非侵入式运行时观测，采集进程系统调用序列、错误调用、资源操作与并发行为，提取可用于教学诊断的关键运行特征。
3. 构建 **测试用例判定 + 系统轨迹分析 + AI 协同** 的混合反馈机制，生成启发式、分层级教学提示，不直接给出答案，重点引导学生理解错误根因与排查思路。
4. 实现代码提交、编译运行、数据采集、自动评分、反馈返回的完整评测链路，支持进程、线程、内存管理、文件系统、同步互斥等典型 OS 实验。
5. 提供基础教学数据管理功能，包括实验记录、错误统计、日志查询，支持教师快速查看学情与共性问题。

## 三、赛题特征

1. **运行环境**：基于虚拟机环境，采用容器隔离，不依赖专用硬件，可在标准服务器或云平台部署。
2. **技术要求**：后端语言不限（推荐 Go/Python）；使用容器化技术实现环境封装与隔离；采用 `strace` 进行系统调用采集；数据库与存储自选，以简洁可用为准；支持接入主流大模型接口。
3. **实验覆盖**：覆盖进程管理、线程同步、内存分配、文件 I/O、处理机调度、死锁等操作系统核心实验场景，包含常规、异常、边界测试用例。
4. **评测特点**：以系统行为观测和教学级反馈为核心考查点，强调可复现、可评测、可教学，难度适中，贴合本科操作系统课程实验要求。
5. **能力导向**：重点考察容器技术、系统观测、OS 原理理解、自动化评测设计与 AI 教学应用能力，突出系统能力与工程实践。

## 四、参考资料

- Docker 官方文档：[https://docs.docker.com/](https://link.wtturl.cn/?target=https%3A%2F%2Fdocs.docker.com%2F&scene=im&aid=497858&lang=zh)
- strace 官方手册：[https://man7.org/linux/manpages/man1/strace.1.html](https://link.wtturl.cn/?target=https%3A%2F%2Fman7.org%2Flinux%2Fmanpages%2Fman1%2Fstrace.1.html&scene=im&aid=497858&lang=zh)
- ptrace 官方手册（Linux 权威）：[https://man7.org/linux/man-pages/man2/ptrace.2.html](https://link.wtturl.cn/?target=https%3A%2F%2Fman7.org%2Flinux%2Fman-pages%2Fman2%2Fptrace.2.html&scene=im&aid=497858&lang=zh)
- Go 语言官方文档：[https://go.dev/doc/Go](https://link.wtturl.cn/?target=https%3A%2F%2Fgo.dev%2Fdoc%2FGo&scene=im&aid=497858&lang=zh)
- PostgreSQL 官方部署文档：[https://www.postgresql.org/docs/current/installation.html](https://link.wtturl.cn/?target=https%3A%2F%2Fwww.postgresql.org%2Fdocs%2Fcurrent%2Finstallation.html&scene=im&aid=497858&lang=zh)
- MinIO 官方部署文档：https://minio/docs/minio/linux/operations/installation.html

