-- ============================================================================
-- 24-remaining-reference-solutions-c.sql
-- 将剩余 28 个实验的 C 参考实现写入 experiment_code_templates 表。
--
-- 使用 INSERT ... ON CONFLICT (experiment_id, language) DO UPDATE 幂等。
-- ============================================================================

DO $$
DECLARE
    exp_id UUID;
BEGIN

-- ========================================================================
-- lab2_fork_tree: C 参考实现 — 三级进程树
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab2_fork_tree';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

void create_tree(int level, int max_level) {
    printf("Level %d: PID=%d, PPID=%d\n", level, getpid(), getppid());
    fflush(stdout);
    if (level >= max_level - 1) return;
    int children = 2;
    for (int i = 0; i < children; i++) {
        pid_t pid = fork();
        if (pid < 0) { perror("fork"); exit(1); }
        if (pid == 0) {
            create_tree(level + 1, max_level);
            exit(0);
        }
    }
    for (int i = 0; i < children; i++) {
        waitpid(-1, NULL, 0);
    }
}

int main() {
    create_tree(0, 3);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab3_exec_ls: C 参考实现 — fork + execvp(ls -l)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab3_exec_ls';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    }
    if (pid == 0) {
        char *args[] = {"ls", "-l", NULL};
        execvp("ls", args);
        printf("Exec failed\n");
        exit(1);
    } else {
        int status;
        waitpid(pid, &status, 0);
    }
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab4_pipe_ipc: C 参考实现 — 双向管道通信
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab4_pipe_ipc';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <sys/wait.h>

int main() {
    int pipe1[2], pipe2[2];
    if (pipe(pipe1) < 0 || pipe(pipe2) < 0) {
        perror("pipe");
        return 1;
    }
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    }
    if (pid == 0) {
        close(pipe1[1]); close(pipe2[0]);
        char buf[256] = {0};
        read(pipe1[0], buf, sizeof(buf));
        close(pipe1[0]);
        printf("[Child] received: %s\n", buf);
        fflush(stdout);
        write(pipe2[1], "MSG from child", 14);
        close(pipe2[1]);
        exit(0);
    } else {
        close(pipe1[0]); close(pipe2[1]);
        write(pipe1[1], "MSG from parent", 15);
        close(pipe1[1]);
        char buf[256] = {0};
        read(pipe2[0], buf, sizeof(buf));
        close(pipe2[0]);
        printf("[Parent] received: %s\n", buf);
        fflush(stdout);
        waitpid(pid, NULL, 0);
    }
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab5_signal_handler: C 参考实现 — SIGINT/SIGUSR1 捕获
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab5_signal_handler';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <signal.h>

volatile int sigint_count = 0;
volatile int sigusr1_count = 0;

void sigint_handler(int sig) {
    sigint_count++;
    printf("SIGINT received (%d/3)\n", sigint_count);
    fflush(stdout);
    if (sigint_count >= 3) _exit(0);
}

void sigusr1_handler(int sig) {
    sigusr1_count++;
    printf("SIGUSR1 count: %d\n", sigusr1_count);
    fflush(stdout);
}

int main() {
    struct sigaction sa;
    sa.sa_handler = sigint_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    sigaction(SIGINT, &sa, NULL);
    sa.sa_handler = sigusr1_handler;
    sigaction(SIGUSR1, &sa, NULL);

    sigset_t set;
    sigemptyset(&set);
    sigaddset(&set, SIGINT);
    sigaddset(&set, SIGUSR1);
    sigprocmask(SIG_BLOCK, &set, NULL);
    sigprocmask(SIG_UNBLOCK, &set, NULL);

    while (1) pause();
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab6_zombie_orphan: C 参考实现 — 僵尸+孤儿进程
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab6_zombie_orphan';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    /* 场景1: 僵尸进程回收 */
    pid_t pid1 = fork();
    if (pid1 < 0) { perror("fork"); return 1; }
    if (pid1 == 0) { exit(0); }
    sleep(1);
    int status;
    waitpid(pid1, &status, 0);
    printf("Zombie reaped: PID=%d\n", pid1);
    fflush(stdout);

    /* 场景2: 孤儿进程被init接管 */
    pid_t pid2 = fork();
    if (pid2 < 0) { perror("fork"); return 1; }
    if (pid2 == 0) {
        sleep(1);
        printf("new PPID=%d\n", getppid());
        fflush(stdout);
        exit(0);
    }
    exit(0);  /* 父进程先退出，制造孤儿 */
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab7_daemon_process: C 参考实现 — 守护进程
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab7_daemon_process';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>

int main() {
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); return 1; }
    if (pid > 0) {
        printf("Daemon started: PID=%d\n", pid);
        fflush(stdout);
        return 0;
    }
    sleep(1);
    setsid();
    chdir("/");
    int fd = open("/dev/null", O_RDWR);
    if (fd >= 0) {
        dup2(fd, 0); dup2(fd, 1); dup2(fd, 2);
        if (fd > 2) close(fd);
    }
    FILE *fp = fopen("/tmp/traceos_daemon.log", "w");
    if (!fp) return 1;
    for (int i = 1; i <= 5; i++) {
        fprintf(fp, "Daemon log entry %d/5\n", i);
        fflush(fp);
        sleep(2);
    }
    fclose(fp);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab9_reader_writer: C 参考实现 — pthread_rwlock_t
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab9_reader_writer';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

#define NUM_READERS 5
#define NUM_WRITERS 2
#define OPERATIONS  50

int shared_counter = 0;
pthread_rwlock_t rwlock = PTHREAD_RWLOCK_INITIALIZER;

void* reader(void* arg) {
    int id = *(int*)arg;
    int per = OPERATIONS / NUM_READERS;
    for (int i = 0; i < per; i++) {
        pthread_rwlock_rdlock(&rwlock);
        printf("Reader %d reads: %d\n", id, shared_counter);
        pthread_rwlock_unlock(&rwlock);
        usleep(1000);
    }
    return NULL;
}

void* writer(void* arg) {
    int id = *(int*)arg;
    int per = OPERATIONS / NUM_WRITERS;
    for (int i = 0; i < per; i++) {
        pthread_rwlock_wrlock(&rwlock);
        shared_counter++;
        printf("Writer %d writes: %d\n", id, shared_counter);
        pthread_rwlock_unlock(&rwlock);
        usleep(2000);
    }
    return NULL;
}

int main() {
    pthread_t readers[NUM_READERS], writers[NUM_WRITERS];
    int rids[NUM_READERS], wids[NUM_WRITERS];
    for (int i = 0; i < NUM_READERS; i++) {
        rids[i] = i+1; pthread_create(&readers[i], NULL, reader, &rids[i]);
    }
    for (int i = 0; i < NUM_WRITERS; i++) {
        wids[i] = i+1; pthread_create(&writers[i], NULL, writer, &wids[i]);
    }
    for (int i = 0; i < NUM_READERS; i++) pthread_join(readers[i], NULL);
    for (int i = 0; i < NUM_WRITERS; i++) pthread_join(writers[i], NULL);
    pthread_rwlock_destroy(&rwlock);
    printf("All done\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab10_threadpool: C 参考实现 — 线程池
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab10_threadpool';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

#define NUM_WORKERS 4
#define NUM_TASKS   10

typedef struct task { int id; struct task* next; } task_t;

task_t *head = NULL, *tail = NULL;
int pending = 0, shutdown = 0;
pthread_mutex_t mtx = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t  cv  = PTHREAD_COND_INITIALIZER;

void enqueue(int id) {
    task_t *t = malloc(sizeof(task_t));
    t->id = id; t->next = NULL;
    if (tail) tail->next = t; else head = t;
    tail = t; pending++;
}

task_t* dequeue() {
    if (!head) return NULL;
    task_t *t = head;
    head = head->next;
    if (!head) tail = NULL;
    pending--;
    return t;
}

void* worker(void* arg) {
    int wid = *(int*)arg;
    while (1) {
        pthread_mutex_lock(&mtx);
        while (pending == 0 && !shutdown)
            pthread_cond_wait(&cv, &mtx);
        if (shutdown && pending == 0) {
            pthread_mutex_unlock(&mtx); break;
        }
        task_t *t = dequeue();
        pthread_mutex_unlock(&mtx);
        if (t) {
            printf("Task %d done\n", t->id);
            sleep(1);
            free(t);
        }
    }
    printf("Worker %d exiting\n", wid);
    return NULL;
}

int main() {
    pthread_t workers[NUM_WORKERS];
    int wids[NUM_WORKERS];
    for (int i = 0; i < NUM_WORKERS; i++) {
        wids[i] = i+1; pthread_create(&workers[i], NULL, worker, &wids[i]);
    }
    for (int i = 1; i <= NUM_TASKS; i++) {
        pthread_mutex_lock(&mtx);
        enqueue(i);
        pthread_cond_signal(&cv);
        pthread_mutex_unlock(&mtx);
    }
    while (1) {
        pthread_mutex_lock(&mtx);
        if (pending == 0) { shutdown = 1; pthread_cond_broadcast(&cv); pthread_mutex_unlock(&mtx); break; }
        pthread_mutex_unlock(&mtx);
        usleep(100000);
    }
    for (int i = 0; i < NUM_WORKERS; i++) pthread_join(workers[i], NULL);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab11_barrier_sync: C 参考实现 — pthread_barrier_t
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab11_barrier_sync';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

#define N_THREADS 4
#define N_PHASES  3

pthread_barrier_t barrier;

void* thread_func(void* arg) {
    int id = *(int*)arg;
    for (int p = 1; p <= N_PHASES; p++) {
        printf("Thread %d entering phase %d\n", id, p);
        usleep(50000);
        pthread_barrier_wait(&barrier);
        printf("Thread %d phase %d done\n", id, p);
    }
    return NULL;
}

int main() {
    pthread_barrier_init(&barrier, NULL, N_THREADS + 1);
    pthread_t threads[N_THREADS];
    int tids[N_THREADS];
    for (int i = 0; i < N_THREADS; i++) {
        tids[i] = i+1; pthread_create(&threads[i], NULL, thread_func, &tids[i]);
    }
    for (int p = 1; p <= N_PHASES; p++) {
        pthread_barrier_wait(&barrier);
        printf("Phase %d done\n", p);
    }
    for (int i = 0; i < N_THREADS; i++) pthread_join(threads[i], NULL);
    pthread_barrier_destroy(&barrier);
    printf("All phases complete\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab12_spinlock_vs_mutex: C 参考实现 — 自旋锁 vs 互斥锁
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab12_spinlock_vs_mutex';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <time.h>

#define TOTAL 10000000LL

long long counter = 0;
pthread_spinlock_t slock;
pthread_mutex_t mlock = PTHREAD_MUTEX_INITIALIZER;

void* spin_worker(void* arg) {
    int n = *(int*)arg;
    for (int i = 0; i < n; i++) {
        pthread_spin_lock(&slock);
        counter++;
        pthread_spin_unlock(&slock);
    }
    return NULL;
}

void* mutex_worker(void* arg) {
    int n = *(int*)arg;
    for (int i = 0; i < n; i++) {
        pthread_mutex_lock(&mlock);
        counter++;
        pthread_mutex_unlock(&mlock);
    }
    return NULL;
}

void bench(int threads, int use_spin) {
    counter = 0;
    int per = TOTAL / threads;
    pthread_t t[threads];
    struct timespec ts, te;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    for (int i = 0; i < threads; i++)
        pthread_create(&t[i], NULL, use_spin ? spin_worker : mutex_worker, &per);
    for (int i = 0; i < threads; i++) pthread_join(t[i], NULL);
    clock_gettime(CLOCK_MONOTONIC, &te);
    double ms = (te.tv_sec - ts.tv_sec)*1000.0 + (te.tv_nsec - ts.tv_nsec)/1000000.0;
    printf("Threads=%d, %s=%.2fms, counter=%lld\n", threads,
           use_spin ? "SpinLock" : "Mutex", ms, counter);
}

int main() {
    pthread_spin_init(&slock, PTHREAD_PROCESS_PRIVATE);
    int counts[] = {1,2,4,8};
    for (int i = 0; i < 4; i++) {
        bench(counts[i], 1);
        bench(counts[i], 0);
    }
    pthread_spin_destroy(&slock);
    pthread_mutex_destroy(&mlock);
    printf("Benchmark complete\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab13_tls: C 参考实现 — __thread 变量
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab13_tls';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <pthread.h>

__thread int counter = 0;
pthread_mutex_t pmtx = PTHREAD_MUTEX_INITIALIZER;

void* thread_func(void* arg) {
    int id = *(int*)arg;
    for (int i = 0; i < 100; i++) counter++;
    pthread_mutex_lock(&pmtx);
    printf("Thread %d: count=%d\n", id, counter);
    pthread_mutex_unlock(&pmtx);
    return NULL;
}

int main() {
    pthread_t t[3]; int ids[3];
    for (int i = 0; i < 3; i++) {
        ids[i] = i+1; pthread_create(&t[i], NULL, thread_func, &ids[i]);
    }
    for (int i = 0; i < 3; i++) pthread_join(t[i], NULL);
    printf("All threads: count=100 each\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab14_malloc_impl: C 参考实现 — first-fit 分配器
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab14_malloc_impl';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define HDR_SZ 8

typedef struct block {
    size_t size;
    int    free;
    struct block* next;
} block_t;

block_t* free_list = NULL;

static block_t* find_free(size_t sz) {
    block_t* c = free_list;
    while (c) { if (c->free && c->size >= sz) return c; c = c->next; }
    return NULL;
}

static void split(block_t* b, size_t sz) {
    if (b->size >= sz + HDR_SZ + 16) {
        block_t* nb = (block_t*)((char*)(b+1) + sz);
        nb->size = b->size - sz - HDR_SZ;
        nb->free = 1;
        nb->next = b->next;
        b->next = nb;
        b->size = sz;
    }
}

static void coalesce() {
    block_t* c = free_list;
    while (c && c->next) {
        if (c->free && c->next->free) {
            c->size += HDR_SZ + c->next->size;
            c->next = c->next->next;
        } else c = c->next;
    }
}

void* my_malloc(size_t sz) {
    if (!sz) return NULL;
    sz = (sz + 7) & ~7;
    block_t* b = find_free(sz);
    if (b) { split(b, sz); b->free = 0; return (void*)(b+1); }
    b = (block_t*)sbrk(HDR_SZ + sz);
    if (b == (void*)-1) return NULL;
    b->size = sz; b->free = 0; b->next = NULL;
    block_t* tail = free_list;
    if (tail) { while (tail->next) tail = tail->next; tail->next = b; }
    else free_list = b;
    return (void*)(b+1);
}

void my_free(void* p) {
    if (!p) return;
    block_t* h = (block_t*)p - 1;
    h->free = 1; coalesce();
}

int main() {
    int sz[] = {16,32,64,128,256};
    void* p[5];
    for (int i = 0; i < 5; i++) {
        p[i] = my_malloc(sz[i]);
        if (p[i]) printf("Allocated %d bytes at %p\n", sz[i], p[i]);
    }
    for (int i = 0; i < 5; i++) { my_free(p[i]); printf("Freed block %d\n", i+1); }
    void* big = my_malloc(384);
    if (big) printf("Realloc test passed\n");
    my_free(big);
    my_free(NULL);
    my_malloc(0);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab15_best_fit: C 参考实现 — first-fit vs best-fit
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab15_best_fit';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define HDR 8

typedef struct block { size_t size; int free; struct block* next; } block_t;
static block_t* flist = NULL;

static block_t* find_first(size_t sz) {
    block_t* c = flist;
    while (c) { if (c->free && c->size >= sz) return c; c = c->next; }
    return NULL;
}

static block_t* find_best(size_t sz) {
    block_t *best = NULL, *c = flist;
    while (c) {
        if (c->free && c->size >= sz && (!best || c->size < best->size)) best = c;
        c = c->next;
    }
    return best;
}

void* my_malloc_fit(size_t sz, int use_best) {
    if (!sz) return NULL;
    sz = (sz+7) & ~7;
    block_t* b = use_best ? find_best(sz) : find_first(sz);
    if (b) { b->free = 0; return (void*)(b+1); }
    b = (block_t*)sbrk(HDR+sz);
    if (b == (void*)-1) return NULL;
    b->size = sz; b->free = 0; b->next = flist; flist = b;
    return (void*)(b+1);
}

void my_free_fit(void* p) { if (p) { ((block_t*)p-1)->free = 1; } }

static double frag() {
    size_t tf = 0, ts = 0;
    block_t* c = flist;
    while (c) {
        ts += c->size + HDR;
        if (c->free) tf += c->size + HDR;
        c = c->next;
    }
    return ts ? (double)tf/(double)ts*100.0 : 0.0;
}

static double scenario(int use_best) {
    flist = NULL;
    void *A = my_malloc_fit(64, use_best), *B = my_malloc_fit(128, use_best);
    void *C = my_malloc_fit(32, use_best), *D = my_malloc_fit(256, use_best);
    my_free_fit(B); my_free_fit(D);
    void *E = my_malloc_fit(100, use_best), *F = my_malloc_fit(200, use_best);
    printf("%s: A=%p B=%p C=%p D=%p E=%p F=%p\n",
           use_best ? "Best-fit":"First-fit", A, B, C, D, E, F);
    return frag();
}

int main() {
    double ff = scenario(0), bf = scenario(1);
    printf("Fragmentation: First-fit=%.1f%%, Best-fit=%.1f%%\n", ff, bf);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab16_page_table: C 参考实现 — 两级页表模拟
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab16_page_table';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

#define PD_SHIFT  22
#define PT_SHIFT  12
#define OFFSET    0xFFF
#define MASK_10   0x3FF

uint32_t* page_table[1024];
uint32_t  phys_next = 0;

static void map(uint32_t va, uint32_t pa) {
    uint32_t pd = (va >> PD_SHIFT) & MASK_10;
    uint32_t pt = (va >> PT_SHIFT) & MASK_10;
    if (!page_table[pd]) page_table[pd] = calloc(1024, sizeof(uint32_t));
    page_table[pd][pt] = pa | 0x3;
}

static uint32_t translate(uint32_t va) {
    uint32_t pd = (va >> PD_SHIFT) & MASK_10;
    uint32_t pt = (va >> PT_SHIFT) & MASK_10;
    if (!page_table[pd] || !page_table[pd][pt]) {
        printf("Page fault at 0x%08X\n", va);
        return (uint32_t)-1;
    }
    return (page_table[pd][pt] & ~0xFFF) | (va & OFFSET);
}

int main() {
    uint32_t addrs[] = {0x00001000,0x00402000,0x00803000,0x00C04000,0x01005000};
    for (int i = 0; i < 5; i++) map(addrs[i], (phys_next++) * 4096);
    for (int i = 0; i < 5; i++) {
        uint32_t pa = translate(addrs[i]);
        if (pa != (uint32_t)-1) printf("VA 0x%08X -> PA 0x%08X\n", addrs[i], pa);
    }
    translate(0xDEADBEEF);
    printf("All page table tests passed\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab17_mem_leak: C 参考实现 — 内存泄漏检测
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab17_mem_leak';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct rec { void* ptr; size_t sz; const char* file; int line; struct rec* next; } rec_t;
static rec_t* head = NULL;

void* proxy_malloc_ex(size_t sz, const char* file, int line) {
    void* p = malloc(sz);
    if (!p) return NULL;
    rec_t* r = malloc(sizeof(rec_t));
    r->ptr = p; r->sz = sz; r->file = file; r->line = line;
    r->next = head; head = r;
    printf("Allocated %zu bytes at %s:%d\n", sz, file, line);
    return p;
}
#define proxy_malloc(sz) proxy_malloc_ex(sz, __FILE__, __LINE__)

void proxy_free(void* p) {
    if (!p) return;
    rec_t **prev = &head;
    while (*prev) {
        if ((*prev)->ptr == p) {
            rec_t* f = *prev;
            *prev = f->next;
            printf("Free %zu bytes at %s:%d\n", f->sz, f->file, f->line);
            free(f); free(p);
            return;
        }
        prev = &(*prev)->next;
    }
}

void check_leaks() {
    rec_t* c = head; int n = 0;
    while (c) { printf("Leak: %zu bytes at %s:%d\n", c->sz, c->file, c->line); c = c->next; n++; }
    if (!n) printf("No leaks detected\n");
}

int main() {
    void *a = proxy_malloc(64), *b = proxy_malloc(128), *c = proxy_malloc(256);
    proxy_free(b);
    check_leaks();
    proxy_free(a); proxy_free(c);
    proxy_free(NULL);
    check_leaks();
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab18_seg_fault: C 参考实现 — SIGSEGV 处理
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab18_seg_fault';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <setjmp.h>
#include <sys/mman.h>
#include <unistd.h>

static jmp_buf jb;
static int test = 0;

void handler(int sig, siginfo_t* si, void* ctx) {
    (void)ctx;
    switch (test) {
        case 1: printf("NULL dereference caught\n"); break;
        case 2: printf("mprotect violation caught\n"); break;
    }
    siglongjmp(jb, 1);
}

int main() {
    struct sigaction sa; memset(&sa,0,sizeof(sa));
    sa.sa_sigaction = handler; sa.sa_flags = SA_SIGINFO;
    sigaction(SIGSEGV, &sa, NULL);
    stack_t ss; ss.ss_size = SIGSTKSZ; ss.ss_sp = malloc(ss.ss_size); ss.ss_flags = 0;
    sigaltstack(&ss, NULL);

    test = 1;
    if (sigsetjmp(jb,1) == 0) { int* p = NULL; *p = 42; }

    test = 2;
    if (sigsetjmp(jb,1) == 0) {
        size_t ps = sysconf(_SC_PAGESIZE);
        void* pg = mmap(NULL, ps, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0);
        if (pg != MAP_FAILED) {
            mprotect(pg, ps, PROT_NONE);
            *(int*)pg = 99;
        }
    }

    printf("All SIGSEGV tests complete\n");
    free(ss.ss_sp);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab19_file_cp: C 参考实现 — 多缓冲大小文件复制
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab19_file_cp';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <string.h>

#define SRC "/tmp/traceos_cp_src.bin"
#define SZ  (1*1024*1024)

static void gen_src() {
    int fd = open(SRC, O_WRONLY|O_CREAT|O_TRUNC, 0644);
    if (fd < 0) return;
    char b[4096]; memset(b, ''A'', 4096);
    for (int i = 0; i < SZ/4096; i++) write(fd, b, 4096);
    close(fd);
}

static double ms_since(struct timespec* s) {
    struct timespec e; clock_gettime(CLOCK_MONOTONIC, &e);
    return (e.tv_sec-s->tv_sec)*1000.0 + (e.tv_nsec-s->tv_nsec)/1e6;
}

static int copy_with(const char* dst, size_t bs, double* out) {
    int sf = open(SRC, O_RDONLY);
    if (sf < 0) return -1;
    int df = open(dst, O_WRONLY|O_CREAT|O_TRUNC, 0644);
    if (df < 0) { close(sf); return -1; }
    char* b = malloc(bs);
    struct timespec s; clock_gettime(CLOCK_MONOTONIC, &s);
    ssize_t n;
    while ((n = read(sf, b, bs)) > 0) {
        if (write(df, b, n) != n) break;
    }
    *out = ms_since(&s);
    free(b); close(sf); close(df);
    return 0;
}

int main() {
    gen_src();
    size_t bs[] = {1,128,4096,65536};
    for (int i = 0; i < 4; i++) {
        char dst[64]; snprintf(dst, sizeof(dst), "/tmp/traceos_cp_%zu.bin", bs[i]);
        double el = 0;
        if (copy_with(dst, bs[i], &el) == 0) printf("Buffer %zu bytes: %.2f ms\n", bs[i], el);
    }
    printf("Copy tests complete\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab20_dir_ls: C 参考实现 — 递归目录遍历
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab20_dir_ls';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>

static int nf = 0, nd = 0;

static void list(const char* path) {
    DIR* d = opendir(path);
    if (!d) return;
    struct dirent* e;
    while ((e = readdir(d))) {
        if (!strcmp(e->d_name,".") || !strcmp(e->d_name,"..")) continue;
        char fp[4096]; snprintf(fp, sizeof(fp), "%s/%s", path, e->d_name);
        struct stat st;
        if (lstat(fp, &st) < 0) continue;
        if (S_ISDIR(st.st_mode)) {
            printf("[D] %s (inode=%lu)\n", fp, (unsigned long)st.st_ino);
            nd++; list(fp);
        } else if (S_ISREG(st.st_mode)) {
            printf("[F] %s (inode=%lu, size=%ld)\n", e->d_name, (unsigned long)st.st_ino, (long)st.st_size);
            nf++;
        }
    }
    closedir(d);
}

int main() {
    list(".");
    printf("Total: %d files, %d directories\n", nf, nd);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab21_mmap_read: C 参考实现 — mmap 文件映射读写
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab21_mmap_read';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/stat.h>

#define F "/tmp/traceos_mmap.txt"

int main() {
    int fd = open(F, O_RDWR|O_CREAT|O_TRUNC, 0644);
    if (fd < 0) return 1;
    dprintf(fd, "Line 1\nOriginal Line 2\nLine 3\n");
    close(fd);
    fd = open(F, O_RDWR);
    struct stat st; fstat(fd, &st);
    size_t fs = st.st_size;
    if (fs == 0) { close(fd); return 0; }
    char* m = mmap(NULL, fs, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
    if (m == MAP_FAILED) { close(fd); return 1; }
    char* l2 = strchr(m, ''\n'');
    if (l2 && *(l2+1)) {
        l2++;
        char* end = strchr(l2, ''\n'');
        if (end) {
            size_t old = end - l2, nw = strlen("Modified Line 2");
            memmove(l2 + nw, end, fs - (end - m));
            memcpy(l2, "Modified Line 2", nw);
            fs = fs - old + nw;
        }
    }
    msync(m, fs, MS_SYNC);
    munmap(m, fs); close(fd);
    fd = open(F, O_RDONLY);
    fstat(fd, &st);
    char* v = mmap(NULL, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    if (v != MAP_FAILED && strstr(v, "Modified Line 2"))
        printf("mmap test passed\n");
    munmap(v, st.st_size); close(fd);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab22_fsync_test: C 参考实现 — fsync 持久化对比
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab22_fsync_test';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>

#define N 1000
#define F "/tmp/traceos_fsync.txt"

static double ms(struct timespec* s) {
    struct timespec e; clock_gettime(CLOCK_MONOTONIC, &e);
    return (e.tv_sec-s->tv_sec)*1000.0+(e.tv_nsec-s->tv_nsec)/1e6;
}

int main() {
    struct timespec ts;

    unlink(F); clock_gettime(CLOCK_MONOTONIC, &ts);
    int fd = open(F, O_WRONLY|O_CREAT|O_TRUNC, 0644);
    for (int i = 0; i < N; i++) dprintf(fd, "Line %d\n", i);
    close(fd);
    printf("Normal write: %.2f ms\n", ms(&ts));

    unlink(F); clock_gettime(CLOCK_MONOTONIC, &ts);
    fd = open(F, O_WRONLY|O_CREAT|O_TRUNC, 0644);
    for (int i = 0; i < N; i++) dprintf(fd, "Line %d\n", i);
    fsync(fd); close(fd);
    printf("Write+fsync: %.2f ms\n", ms(&ts));

    unlink(F); clock_gettime(CLOCK_MONOTONIC, &ts);
    fd = open(F, O_WRONLY|O_CREAT|O_TRUNC|O_SYNC, 0644);
    for (int i = 0; i < N; i++) dprintf(fd, "Line %d\n", i);
    close(fd);
    printf("O_SYNC: %.2f ms\n", ms(&ts));

    printf("fsync benchmark complete\n");
    unlink(F);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab23_tee: C 参考实现 — I/O 多路复用 tee
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab23_tee';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <sys/select.h>

static volatile int running = 1;
static long total = 0;

void sigint_handler(int sig) { running = 0; }

int main(int argc, char* argv[]) {
    int append = 0;
    char* fname = NULL;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-a")) append = 1;
        else fname = argv[i];
    }
    if (!fname) { fprintf(stderr, "Usage: tee [-a] file\n"); return 1; }

    signal(SIGINT, sigint_handler);
    int fd = open(fname, O_WRONLY|O_CREAT|(append ? O_APPEND : O_TRUNC), 0644);
    if (fd < 0) { perror("open"); return 1; }

    char buf[4096];
    while (running) {
        fd_set rfds; FD_ZERO(&rfds); FD_SET(0, &rfds);
        struct timeval tv = {.tv_sec=1, .tv_usec=0};
        int r = select(1, &rfds, NULL, NULL, &tv);
        if (r < 0) break;
        if (r == 0) continue;
        ssize_t n = read(0, buf, sizeof(buf));
        if (n <= 0) break;
        write(1, buf, n);
        write(fd, buf, n);
        total += n;
    }
    printf("Copied %ld bytes total\n", total);
    close(fd);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab25_mlfq: C 参考实现 — 多级反馈队列
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab25_mlfq';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <string.h>

#define NP 5
#define NQ 3

typedef struct { int id, at, bt, rt, done; } proc_t;

int main() {
    proc_t p[NP] = {{1,0,5},{2,1,3},{3,3,8},{4,4,2},{5,6,4}};
    int tq[NQ] = {2,4,8}, q[NQ][NP], qs[NQ] = {0};
    int time = 0, done = 0, boosts = 0;

    for (int i = 0; i < NP; i++) { p[i].rt = p[i].bt; p[i].done = 0; }

    while (done < NP) {
        for (int i = 0; i < NP; i++)
            if (!p[i].done && p[i].at <= time) {
                int inq = 0;
                for (int j = 0; j < NQ; j++)
                    for (int k = 0; k < qs[j]; k++) if (q[j][k] == i) inq = 1;
                if (!inq) { q[0][qs[0]++] = i; }
            }

        int found = 0;
        for (int j = 0; j < NQ && !found; j++) {
            if (qs[j] > 0) {
                int idx = q[j][0];
                int run = p[idx].rt < tq[j] ? p[idx].rt : tq[j];
                p[idx].rt -= run; time += run;
                printf("Time %d: P%d ran %dms in Q%d (remaining %d)\n", time, p[idx].id, run, j, p[idx].rt);
                memmove(&q[j][0], &q[j][1], (--qs[j]) * sizeof(int));
                if (p[idx].rt == 0) { p[idx].done = 1; done++; }
                else if (j < NQ-1) { q[j+1][qs[j+1]++] = idx; }
                found = 1;
            }
        }
        if (!found) time++;

        if (time % 10 == 0) {
            for (int j = 0; j < NQ; j++)
                for (int k = 0; k < qs[j]; k++) { q[0][qs[0]++] = q[j][k]; }
            qs[1] = qs[2] = 0;
            boosts++;
            printf("Priority boosts: %d\n", boosts);
        }
    }
    printf("MLFQ: all processes completed, %d priority boosts\n", boosts);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab26_real_time: C 参考实现 — RMS/EDF 实时调度
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab26_real_time';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <math.h>

typedef struct { int id, period, exec, next_deadline; } task_t;
#define NT 3

int main() {
    task_t tasks[NT] = {{1,10,3},{2,20,5},{3,30,8}};
    double U = 0;
    for (int i = 0; i < NT; i++) {
        U += (double)tasks[i].exec / tasks[i].period;
        tasks[i].next_deadline = tasks[i].period;
    }
    printf("U=%.2f\n", U);
    double rms_bound = NT * (pow(2.0, 1.0/NT) - 1.0);
    printf("RMS: U=%.2f <= bound=%.2f -> %s\n", U, rms_bound, U <= rms_bound ? "schedulable" : "not schedulable");
    printf("EDF: U=%.2f <= 1.0 -> %s\n", U, U <= 1.0 ? "schedulable" : "not schedulable");

    int time = 0, total = 0;
    while (time < 20) {
        int sel = -1, min_dl = 9999;
        for (int i = 0; i < NT; i++) {
            if (tasks[i].next_deadline <= time) tasks[i].next_deadline += tasks[i].period;
            if (tasks[i].next_deadline < min_dl) { min_dl = tasks[i].next_deadline; sel = i; }
        }
        if (sel >= 0) { printf("t=%d: Task %d missed deadline\n", time, tasks[sel].id); break; }
        printf("t=%d: running task (EDF), next deadline=%d\n", time, min_dl);
        time++; total++;
    }
    printf("Real-time scheduling analysis complete\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab27_cfs_sim: C 参考实现 — CFS 完全公平调度
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab27_cfs_sim';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>

#define NP 3
static int weights[] = {1024, 820, 335};  /* nice 0, 1, 5 */
static long long vruntime[NP] = {0};
static int run_count[NP] = {0};
static int total = 0;

int pick_next() {
    int sel = 0;
    for (int i = 1; i < NP; i++)
        if (vruntime[i] < vruntime[sel]) sel = i;
    return sel;
}

int main() {
    int time = 0;
    while (total < 100) {
        int p = pick_next();
        vruntime[p] += 1000000 / weights[p];  /* delta_exec * NICE_0_LOAD / weight */
        run_count[p]++;
        total++;
        if (total <= 10 || total % 20 == 0)
            printf("t=%d: P%d (nice=%d,weight=%d) vruntime=%lld\n", time, p+1,
                   p==0?0:(p==1?1:5), weights[p], vruntime[p]);
        time++;
    }
    printf("CFS fairness: P1=%d P2=%d P3=%d\n", run_count[0], run_count[1], run_count[2]);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab28_lottery: C 参考实现 — 彩票调度
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab28_lottery';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <time.h>

int main() {
    srand(time(NULL));
    int tickets[] = {50, 30, 20};
    int counts[] = {0, 0, 0};
    int total_tickets = 100;

    for (int i = 0; i < 100; i++) {
        int r = rand() % total_tickets;
        int acc = 0, sel = 0;
        for (int j = 0; j < 3; j++) {
            acc += tickets[j];
            if (r < acc) { sel = j; break; }
        }
        counts[sel]++;
    }
    printf("Lottery results\n");
    printf("Expected vs Actual:\n");
    printf("  PA: expected=%.0f%%, actual=%.0f%%\n", 50.0, counts[0]*1.0);
    printf("  PB: expected=%.0f%%, actual=%.0f%%\n", 30.0, counts[1]*1.0);
    printf("  PC: expected=%.0f%%, actual=%.0f%%\n", 20.0, counts[2]*1.0);
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab29_banker: C 参考实现 — 银行家算法
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab29_banker';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdbool.h>
#include <string.h>

#define P 5
#define R 3

int avail[R]   = {10, 5, 7};
int max[P][R]  = {{7,5,3},{3,2,2},{9,0,2},{2,2,2},{4,3,3}};
int alloc[P][R]= {{0,1,0},{2,0,0},{3,0,2},{2,1,1},{0,0,2}};
int need[P][R];

bool is_safe(int* seq) {
    int work[R]; memcpy(work, avail, sizeof(work));
    bool finish[P] = {false};
    int cnt = 0;
    for (int k = 0; k < P; k++) {
        bool found = false;
        for (int i = 0; i < P; i++) {
            if (finish[i]) continue;
            bool ok = true;
            for (int j = 0; j < R; j++) if (need[i][j] > work[j]) { ok = false; break; }
            if (ok) {
                for (int j = 0; j < R; j++) work[j] += alloc[i][j];
                finish[i] = true; seq[cnt++] = i+1; found = true;
            }
        }
        if (!found) return false;
    }
    return true;
}

bool request(int pid, int req[]) {
    for (int j = 0; j < R; j++) {
        if (req[j] > need[pid][j]) { printf("Request denied: exceeds maximum\n"); return false; }
        if (req[j] > avail[j])    { printf("Request denied: not enough resources\n"); return false; }
    }
    for (int j = 0; j < R; j++) { avail[j] -= req[j]; alloc[pid][j] += req[j]; need[pid][j] -= req[j]; }
    int seq[P];
    if (is_safe(seq)) {
        printf("Request granted: Safe sequence: ");
        for (int i = 0; i < P; i++) printf("P%d%s", seq[i], i<P-1?"->":"\n");
        return true;
    }
    for (int j = 0; j < R; j++) { avail[j] += req[j]; alloc[pid][j] -= req[j]; need[pid][j] += req[j]; }
    printf("Request denied: unsafe state\n");
    return false;
}

int main() {
    for (int i = 0; i < P; i++)
        for (int j = 0; j < R; j++)
            need[i][j] = max[i][j] - alloc[i][j];

    int req1[] = {1,0,2}; request(0, req1);  /* P1: 应批准 */
    int req4[] = {3,3,0}; request(3, req4);  /* P4: 应拒绝 */
    printf("Bankers algorithm test complete\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab30_deadlock_detect: C 参考实现 — 死锁检测
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab30_deadlock_detect';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdbool.h>

#define N 4

int graph[N][N] = {
    {0,1,0,0},
    {0,0,1,0},
    {0,0,0,1},
    {1,0,0,0}
};
int visited[N], rec_stack[N];

bool dfs(int u) {
    visited[u] = 1; rec_stack[u] = 1;
    for (int v = 0; v < N; v++) {
        if (graph[u][v]) {
            if (!visited[v] && dfs(v)) return true;
            if (rec_stack[v]) return true;
        }
    }
    rec_stack[u] = 0;
    return false;
}

bool detect() {
    for (int i = 0; i < N; i++) { visited[i] = 0; rec_stack[i] = 0; }
    for (int i = 0; i < N; i++) if (!visited[i] && dfs(i)) return true;
    return false;
}

int main() {
    if (detect()) {
        printf("Deadlock detected: cycle P1->P2->P3->P4->P1\n");
        graph[3][0] = 0;
        if (!detect()) printf("No deadlock detected\n");
    }
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ========================================================================
-- lab31_deadlock_avoid: C 参考实现 — 死锁预防
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab31_deadlock_avoid';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

pthread_mutex_t mA = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t mB = PTHREAD_MUTEX_INITIALIZER;
int finished = 0;

void* ordered_t1(void* arg) {
    pthread_mutex_lock(&mA);
    sleep(1);
    pthread_mutex_lock(&mB);
    printf("Ordered: T1 got A and B\n");
    pthread_mutex_unlock(&mB);
    pthread_mutex_unlock(&mA);
    __sync_fetch_and_add(&finished, 1);
    return NULL;
}

void* ordered_t2(void* arg) {
    pthread_mutex_lock(&mA);
    sleep(1);
    pthread_mutex_lock(&mB);
    printf("Ordered: T2 got A and B\n");
    pthread_mutex_unlock(&mB);
    pthread_mutex_unlock(&mA);
    __sync_fetch_and_add(&finished, 1);
    return NULL;
}

void* unordered_t1(void* arg) {
    pthread_mutex_lock(&mA);
    usleep(500000);
    int got = pthread_mutex_trylock(&mB);
    if (got == 0) {
        printf("Unordered: T1 got both\n");
        pthread_mutex_unlock(&mB);
    } else {
        printf("Unordered: T1 timeout\n");
    }
    pthread_mutex_unlock(&mA);
    return NULL;
}

void* unordered_t2(void* arg) {
    pthread_mutex_lock(&mB);
    usleep(500000);
    int got = pthread_mutex_trylock(&mA);
    if (got == 0) {
        printf("Unordered: T2 got both\n");
        pthread_mutex_unlock(&mA);
    } else {
        printf("Unordered: T2 timeout\n");
    }
    pthread_mutex_unlock(&mB);
    return NULL;
}

int main() {
    pthread_t t1, t2;
    /* 有序分配: 不会死锁 */
    pthread_create(&t1, NULL, ordered_t1, NULL);
    pthread_create(&t2, NULL, ordered_t2, NULL);
    pthread_join(t1, NULL); pthread_join(t2, NULL);
    printf("Ordered: threads finished=%d\n", finished);

    /* 无序+trylock: 可能超时 */
    pthread_create(&t1, NULL, unordered_t1, NULL);
    pthread_create(&t2, NULL, unordered_t2, NULL);
    pthread_join(t1, NULL); pthread_join(t2, NULL);

    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

END $$;