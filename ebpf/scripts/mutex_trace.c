/*
 * mutex_trace.c — LD_PRELOAD pthread_mutex 追踪库
 * TraceOS Lab eBPF 观测引擎
 *
 * 追踪所有 pthread_mutex_lock / unlock 调用，
 * 输出 JSONL 格式到 stderr 供分析脚本消费。
 *
 * 编译: gcc -shared -fPIC -o mutex_trace.so mutex_trace.c -ldl -pthread
 * 使用: LD_PRELOAD=./mutex_trace.so ./student_program
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/syscall.h>

/* ── 原始函数指针 ── */
static int (*real_mutex_lock)(pthread_mutex_t *) = NULL;
static int (*real_mutex_unlock)(pthread_mutex_t *) = NULL;
static int (*real_mutex_trylock)(pthread_mutex_t *) = NULL;
static pthread_mutex_t init_lock = PTHREAD_MUTEX_INITIALIZER;
static int initialized = 0;

/* ── 懒初始化 ── */
static void ensure_init(void) {
    if (__sync_bool_compare_and_swap(&initialized, 0, 1)) {
        real_mutex_lock   = dlsym(RTLD_NEXT, "pthread_mutex_lock");
        real_mutex_unlock = dlsym(RTLD_NEXT, "pthread_mutex_unlock");
        real_mutex_trylock = dlsym(RTLD_NEXT, "pthread_mutex_trylock");
        if (!real_mutex_lock || !real_mutex_unlock) {
            fprintf(stderr, "mutex_trace: dlsym failed\n");
            _exit(1);
        }
    }
}

/* ── 获取线程 ID ── */
static unsigned long get_tid(void) {
    return (unsigned long)syscall(SYS_gettid);
}

/* ── JSONL 事件输出 ── */
static void emit(const char *op, pthread_mutex_t *mtx, int ret) {
    fprintf(stderr,
        "{\"op\":\"%s\",\"tid\":%lu,\"mtx\":\"%p\",\"ret\":%d}\n",
        op, get_tid(), (void *)mtx, ret);
}

/* ══════════════════════════════════════════════════════
 *  包装函数
 * ══════════════════════════════════════════════════════ */

int pthread_mutex_lock(pthread_mutex_t *mtx) {
    ensure_init();
    emit("LOCK", mtx, 0);
    int ret = real_mutex_lock(mtx);
    emit("LOCKED", mtx, ret);
    return ret;
}

int pthread_mutex_unlock(pthread_mutex_t *mtx) {
    ensure_init();
    emit("UNLOCK", mtx, 0);
    int ret = real_mutex_unlock(mtx);
    return ret;
}

int pthread_mutex_trylock(pthread_mutex_t *mtx) {
    ensure_init();
    emit("TRYLOCK", mtx, 0);
    int ret = real_mutex_trylock(mtx);
    emit("TRYLOCKED", mtx, ret);
    return ret;
}
