-- ============================================================================
-- 21-reference-solutions-c.sql
-- 将 3 个样板实验的 C 参考实现写入 experiment_code_templates 表。
--
-- 使用 INSERT ... ON CONFLICT (experiment_id, language) DO UPDATE
-- 以兼容重复执行（幂等）。
-- ============================================================================

DO $$
DECLARE
    exp_id UUID;
BEGIN

-- ============================================================================
-- lab1_fork_basic: C 参考实现
-- ============================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab1_fork_basic';
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
        /* 子进程 */
        printf("Child: PID=%d, PPID=%d\n", getpid(), getppid());
        return 0;
    } else {
        /* 父进程 */
        printf("Parent: PID=%d, Child PID=%d\n", getpid(), pid);
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

-- ============================================================================
-- lab8_producer_consumer: C 参考实现
-- ============================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab8_producer_consumer';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

#define BUFFER_SIZE 5
#define TOTAL_ITEMS 20

int buffer[BUFFER_SIZE];
int count = 0;
int in = 0, out = 0;
int next_produce = 1;
int total_consumed = 0;

pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t not_full = PTHREAD_COND_INITIALIZER;
pthread_cond_t not_empty = PTHREAD_COND_INITIALIZER;

void* producer(void* arg) {
    while (1) {
        pthread_mutex_lock(&mutex);
        if (next_produce > TOTAL_ITEMS) {
            pthread_mutex_unlock(&mutex);
            break;
        }
        while (count == BUFFER_SIZE) {
            pthread_cond_wait(&not_full, &mutex);
        }
        buffer[in] = next_produce++;
        in = (in + 1) % BUFFER_SIZE;
        count++;
        pthread_cond_signal(&not_empty);
        pthread_mutex_unlock(&mutex);
    }
    return NULL;
}

void* consumer(void* arg) {
    while (1) {
        pthread_mutex_lock(&mutex);
        if (total_consumed >= TOTAL_ITEMS) {
            pthread_mutex_unlock(&mutex);
            break;
        }
        while (count == 0) {
            pthread_cond_wait(&not_empty, &mutex);
        }
        int item = buffer[out];
        out = (out + 1) % BUFFER_SIZE;
        count--;
        total_consumed++;
        printf("Consumed: %d\n", item);
        pthread_cond_signal(&not_full);
        pthread_mutex_unlock(&mutex);
    }
    return NULL;
}

int main() {
    pthread_t producers[2], consumers[2];
    for (int i = 0; i < 2; i++) {
        pthread_create(&producers[i], NULL, producer, NULL);
        pthread_create(&consumers[i], NULL, consumer, NULL);
    }
    for (int i = 0; i < 2; i++) {
        pthread_join(producers[i], NULL);
        pthread_join(consumers[i], NULL);
    }
    printf("All items processed\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

-- ============================================================================
-- lab24_sched_sim: C 参考实现
-- ============================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab24_sched_sim';
IF exp_id IS NOT NULL THEN
    INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
    VALUES (
        exp_id, 'c', NULL,
        '#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

#define MAX_PROC 10

typedef struct {
    int pid, arrival, burst, priority;
    int remaining, completed, start_time, finish_time;
} Process;

void fcfs(Process p[], int n) {
    int time = 0, total_wait = 0, total_turnaround = 0;
    for (int i = 0; i < n; i++) {
        if (time < p[i].arrival) time = p[i].arrival;
        p[i].start_time = time;
        time += p[i].burst;
        p[i].finish_time = time;
        total_wait += p[i].start_time - p[i].arrival;
        total_turnaround += p[i].finish_time - p[i].arrival;
    }
    printf("FCFS: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

void sjf(Process p[], int n) {
    Process temp[MAX_PROC];
    memcpy(temp, p, sizeof(Process)*n);
    int done = 0, time = 0, total_wait = 0, total_turnaround = 0;
    int completed[MAX_PROC] = {0};
    while (done < n) {
        int idx = -1, min_burst = INT_MAX;
        for (int i = 0; i < n; i++) {
            if (!completed[i] && temp[i].arrival <= time && temp[i].burst < min_burst) {
                min_burst = temp[i].burst; idx = i;
            }
        }
        if (idx == -1) { time++; continue; }
        temp[idx].start_time = time;
        time += temp[idx].burst;
        temp[idx].finish_time = time;
        completed[idx] = 1; done++;
        total_wait += temp[idx].start_time - temp[idx].arrival;
        total_turnaround += temp[idx].finish_time - temp[idx].arrival;
    }
    printf("SJF: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

void rr(Process p[], int n, int quantum) {
    Process temp[MAX_PROC];
    memcpy(temp, p, sizeof(Process)*n);
    for (int i = 0; i < n; i++) temp[i].remaining = temp[i].burst;
    int done = 0, time = 0, total_wait = 0, total_turnaround = 0;
    int started[MAX_PROC] = {0};
    while (done < n) {
        int progressed = 0;
        for (int i = 0; i < n; i++) {
            if (temp[i].remaining > 0 && temp[i].arrival <= time) {
                if (!started[i]) {
                    temp[i].start_time = time;
                    started[i] = 1;
                }
                int run = temp[i].remaining < quantum ? temp[i].remaining : quantum;
                temp[i].remaining -= run;
                time += run;
                progressed = 1;
                if (temp[i].remaining == 0) {
                    temp[i].finish_time = time;
                    done++;
                    total_wait += temp[i].start_time - temp[i].arrival;
                    total_turnaround += temp[i].finish_time - temp[i].arrival;
                }
            }
        }
        if (!progressed) time++;
    }
    printf("RR: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

void priority_sched(Process p[], int n) {
    Process temp[MAX_PROC];
    memcpy(temp, p, sizeof(Process)*n);
    int done = 0, time = 0, total_wait = 0, total_turnaround = 0;
    int completed[MAX_PROC] = {0};
    while (done < n) {
        int idx = -1, highest = INT_MAX;
        for (int i = 0; i < n; i++) {
            if (!completed[i] && temp[i].arrival <= time && temp[i].priority < highest) {
                highest = temp[i].priority; idx = i;
            }
        }
        if (idx == -1) { time++; continue; }
        temp[idx].start_time = time;
        time += temp[idx].burst;
        temp[idx].finish_time = time;
        completed[idx] = 1; done++;
        total_wait += temp[idx].start_time - temp[idx].arrival;
        total_turnaround += temp[idx].finish_time - temp[idx].arrival;
    }
    printf("Priority: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

int main() {
    Process procs[] = {
        {1,0,8,2}, {2,1,4,1}, {3,2,9,3}, {4,3,5,2}
    };
    int n = 4;
    fcfs(procs, n);
    sjf(procs, n);
    rr(procs, n, 2);
    priority_sched(procs, n);
    printf("Scheduler simulation complete\n");
    return 0;
}',
        true
    )
    ON CONFLICT (experiment_id, language)
    DO UPDATE SET reference_solution = EXCLUDED.reference_solution,
                  updated_at = NOW();
END IF;

END $$;