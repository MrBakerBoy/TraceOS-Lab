package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/achievement"
	"github.com/traceos-lab/core-service/internal/config"
	"github.com/traceos-lab/core-service/internal/ebpf"
	"github.com/traceos-lab/core-service/internal/evaluator"
	"github.com/traceos-lab/core-service/internal/handler"
	"github.com/traceos-lab/core-service/internal/handler/teacher"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/nats"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/sandbox"
	"github.com/traceos-lab/core-service/internal/adaptive"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/ws"
)

func main() {
	cfg := config.Load()

	// ── Database ──────────────────────────────────────────────────────
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.PGUser, cfg.PGPass, cfg.PGHost, cfg.PGPort, cfg.PGDB)

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	log.Println("Connected to PostgreSQL")

	// ── NATS (real connection with LogBus fallback) ───────────────────
	var eventBus nats.EventBus
	natsBus, err := nats.NewNatsBus(cfg.NATSUrl)
	if err != nil {
		log.Printf("NATS connection failed, falling back to LogBus: %v", err)
		eventBus = nats.NewLogBus()
	} else {
		log.Println("Connected to NATS")
		eventBus = natsBus
	}

	// ── Sandbox Manager (Dual-Mode Container Architecture) ─────────
	// Supports nsjail (namespace-based) and Docker (full container) backends.
	// Select via SANDBOX_BACKEND env: "nsjail" (default), "docker", or "local".
	sandboxFactory := sandbox.NewSandboxFactory()
	baseManager := sandboxFactory.GetDefaultManager()
	sandboxPool := sandbox.NewPool(baseManager, 5)
	sandboxPool.StartPrealloc(context.Background(), 3, sandbox.LevelStandard)
	sandboxMgr := sandbox.SandboxManager(sandboxPool)
	log.Printf("Sandbox manager initialized (backend=%s, pooled max=5)", sandboxFactory.DefaultBackend())

	// ── Repositories ──────────────────────────────────────────────────
	userRepo := repository.NewUserRepo(pool)
	courseRepo := repository.NewCourseRepo(pool)
	expRepo := repository.NewExperimentRepo(pool)
	codeTemplateRepo := repository.NewCodeTemplateRepo(pool)
	subRepo := repository.NewSubmissionRepo(pool)
	deadlockRepo := repository.NewDeadlockReportRepo(pool)
	progressRepo := repository.NewProgressRepo(pool)
	commentRepo := repository.NewCommentRepo(pool)
	auditLogRepo := repository.NewAuditLogRepo(pool)
	reportRepo := repository.NewReportRepo(pool)
	achievementRepo := achievement.NewRepository(pool)
	achievementSvc := achievement.NewService(achievementRepo)

	// ── Observability Services ──────────────────────────────────────
	obsContextBuilder := services.NewObsContextBuilder()
	semanticEngine := services.NewSemanticEngine()
	spanBuilder := services.NewSpanBuilder()
	riskIndicator := services.NewRiskIndicator()
	teachingEngine := services.NewTeachingNarrativeEngine()
	compositeTrigger := services.NewCompositeTrigger()
	eventLinker := services.NewEventLinker()
	timelineCalibrator := services.NewTimelineCalibrator()
	log.Println("ObsContext builder + Semantic engine + Span builder + Risk indicator + Teaching narrative + Composite trigger initialized")

	// ── eBPF tracing (global singleton, loaded at startup) ────────────
	bpfDir := os.Getenv("EBPF_OBJECT_DIR")
	if bpfDir == "" {
		bpfDir = "bpf" // default: services/core-service/bpf
	}
	var ebpfAdapter *ebpf.Adapter
	if mode, ok := ebpf.IsEBPFAvailable(bpfDir); ok {
		log.Printf("eBPF available (mode=%s), attempting to load global tracer...", mode)
		loader, err := ebpf.LoadV2(bpfDir)
		if err != nil {
			log.Printf("eBPF load failed: %v — falling back to strace", err)
		} else {
			ebpfAdapter = ebpf.NewAdapter(loader, sandboxMgr, bpfDir)
			log.Printf("eBPF global tracer loaded (mode=%s)", mode)
		}
	} else {
		log.Printf("eBPF not available — using strace for all tracing")
	}

	// ── Evaluation Pipeline (M3) ──────────────────────────────────────
	pipeline := evaluator.NewPipeline(subRepo, expRepo, codeTemplateRepo, sandboxMgr, eventBus, obsContextBuilder, ebpfAdapter)
	log.Println("Evaluation pipeline initialized")

	// ── Evaluator Worker Pool ────────────────────────────────────────
	workerPool := evaluator.NewWorkerPool(pipeline, subRepo, 4)
	workerPool.Start()
	workerPool.SetOnComplete(func(task evaluator.Task) {
		_, err := achievementSvc.Evaluate(context.Background(), task.StudentID)
		if err != nil {
			log.Printf("[Achievements] evaluate failed for %s: %v", task.StudentID, err)
		}
	})

	// Recover stale submissions from previous runs
	go recoverStaleSubmissions(subRepo)

	// ── WebSocket Hub ─────────────────────────────────────────────────
	wsHub := ws.NewHub()
	log.Println("WebSocket hub initialized")

	// ── Experiment Cache (memory feature) ─────────────────────────────
	cacheHandler := handler.NewExperimentCacheHandler(pool)
	cacheHandler.StartCacheCleanup()
	log.Println("Experiment cache handler initialized with hourly cleanup")

	// ── Handlers ──────────────────────────────────────────────────────
	ebpfHandler := handler.NewEBPFHandler("/ebpf", deadlockRepo)
	log.Println("eBPF observation handler initialized")
	authHandler := handler.NewAuthHandler(userRepo, cfg.JWTSecret)
	expHandler := handler.NewExperimentHandler(expRepo, subRepo, codeTemplateRepo)
	subHandler := handler.NewSubmissionHandler(subRepo, expRepo, pipeline, eventBus, workerPool)
	progressHandler := handler.NewProgressHandler(progressRepo, courseRepo)
	commentHandler := handler.NewCommentHandler(commentRepo, pool, cfg.AIServiceURL)
	teacherStatsHandler := teacher.NewStatsHandler(pool)
	courseHandler := handler.NewCourseHandler(courseRepo)
	teacherAIAnalysisHandler := teacher.NewAIAnalysisHandler(pool)
	dashboardHandler := teacher.NewDashboardHandler(pool)
	aiChatHandler := handler.NewAIChatHandler(pool, cfg.AIServiceURL)
	workspaceHandler := handler.NewWorkspaceHandler(pool)
	userPrefsHandler := handler.NewUserPrefsHandler(pool)
	conversationHandler := handler.NewConversationHandler(pool, cfg.AIServiceURL)
	achievementHandler := handler.NewAchievementHandler(achievementSvc)

	fgHandler := handler.NewFlameGraphHandler(subRepo, expRepo, cfg.FlamegraphServiceURL, cacheHandler)

	adaptiveProfiler := adaptive.NewProfiler(pool)
	adaptiveSelector := adaptive.NewSelector(pool, adaptiveProfiler)
	adaptiveHandler := handler.NewAdaptiveHandler(adaptiveSelector, adaptiveProfiler)

	codeAuditHandler := handler.NewCodeAuditHandler(pool, cfg.AIServiceURL, cacheHandler)
	traceDiffHandler := handler.NewTraceDiffHandler()
	obsContextHandler := handler.NewObsContextHandler(subRepo, obsContextBuilder, compositeTrigger, eventLinker, timelineCalibrator)
	semanticHandler := handler.NewSemanticHandler(subRepo, semanticEngine)
	spanHandler := handler.NewSpanHandler(subRepo, spanBuilder)
	riskHandler := handler.NewRiskHandler(subRepo, riskIndicator)
	metricsHandler := handler.NewMetricsHandler(subRepo)
	teachingHandler := handler.NewTeachingHandler(subRepo, teachingEngine)
	leakHandler := handler.NewLeakHandler(subRepo)
	allocFlamegraphHandler := handler.NewAllocFlamegraphHandler(subRepo)
	memoryTrendHandler := handler.NewMemoryTrendHandler(subRepo)
	raceHandler := handler.NewRaceHandler(subRepo)
	deadlockEvolverHandler := handler.NewDeadlockHandler(subRepo)
	log.Println("Adaptive difficulty + Code audit + Semantic + Span + Risk + Metrics + Teaching + Leak + Race + Deadlock handlers initialized")

	adminHandler := handler.NewAdminHandler(pool, subRepo, expRepo)
	adminUserHandler := handler.NewAdminUserHandler(userRepo, auditLogRepo)

	auditLogHandler := handler.NewAuditLogHandler(auditLogRepo)
	reportHandler := handler.NewReportHandler(reportRepo)

	// ── Rate Limiters ─────────────────────────────────────────────────
	loginLimiter := middleware.RateLimit(5, 1*time.Minute)
	submitLimiter := middleware.RateLimit(120, 1*time.Minute)
	writeLimiter := middleware.RateLimit(30, 1*time.Minute)

	// ── Router ────────────────────────────────────────────────────────
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	r.Use(func(c *gin.Context) {
		origin := cfg.FrontendURL
		if origin == "" {
			origin = "http://localhost:3000"
		}
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH")
		c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Request-ID")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Audit log middleware
	r.Use(func(c *gin.Context) {
		c.Next()
		method := c.Request.Method
		if method == "GET" || method == "OPTIONS" || method == "HEAD" {
			return
		}
		urlPath := c.Request.URL.Path
		if len(urlPath) < 8 || urlPath[:8] != "/api/v1/" {
			return
		}
		userID, _ := c.Get("user_id")
		var uid *string
		if uidStr, ok := userID.(string); ok && uidStr != "" {
			uid = &uidStr
		}
		ip := c.ClientIP()
		ua := c.Request.UserAgent()
		status := c.Writer.Status()

		action := method + " " + urlPath
		resType := "api"
		resourceID := c.Param("id")
		var rid *string
		if resourceID != "" {
			rid = &resourceID
		}

		if urlPath == "/api/v1/auth/login" {
			action = "login"
		} else if len(urlPath) > 20 && urlPath[:20] == "/api/v1/submissions" {
			action = "submit_code"
			resType = "submission"
		} else if len(urlPath) > 19 && urlPath[:19] == "/api/v1/experiments" && method == "POST" {
			action = "create_experiment"
			resType = "experiment"
		} else if len(urlPath) > 19 && urlPath[:19] == "/api/v1/experiments" && method == "PUT" {
			action = "update_experiment"
			resType = "experiment"
		}

		auditLogRepo.LogAction(c.Request.Context(), uid, action, &resType, rid, &ip, &ua, &status)
	})

	// WebSocket endpoint
	wsGroup := r.Group("/ws")
	wsGroup.Use(middleware.Auth(cfg.JWTSecret))
	wsGroup.GET("/experiments/:id", wsHub.HandleWebSocket())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "core-service"})
	})

	api := r.Group("/api/v1")
	{
		api.POST("/auth/register", authHandler.Register)
		api.POST("/auth/login", loginLimiter, authHandler.Login)
		api.GET("/experiments", expHandler.List)
		api.POST("/auth/refresh", authHandler.RefreshToken)
	}

	internal := api.Group("/internal")
	{
		internal.GET("/submissions/:id", subHandler.GetResult)
		internal.GET("/experiments/:id", expHandler.Get)
	}

	protected := api.Group("")
	protected.Use(middleware.Auth(cfg.JWTSecret))
	{
		protected.POST("/auth/logout", authHandler.Logout)
		protected.GET("/auth/me", authHandler.Me)

		protected.GET("/courses", courseHandler.ListMyCourses)
		protected.POST("/courses/join", courseHandler.JoinByInviteCode)

		// AI Chat with code context
		protected.POST("/experiments/:id/ai-chat", writeLimiter, aiChatHandler.Chat)

		// Workspace drafts
		protected.GET("/experiments/:id/draft", workspaceHandler.GetDraft)
		protected.PUT("/experiments/:id/draft", writeLimiter, workspaceHandler.SaveDraft)
		protected.DELETE("/experiments/:id/draft", workspaceHandler.DeleteDraft)
		protected.PUT("/experiments/:id/dock-state", writeLimiter, workspaceHandler.SaveDockState)

		// AI Chat history persistence
		protected.GET("/experiments/:id/ai-chat-history", workspaceHandler.GetAIChat)
		protected.PUT("/experiments/:id/ai-chat-history", writeLimiter, workspaceHandler.SaveAIChat)

		// Diagnosis persistence
		protected.GET("/submissions/:id/diagnosis", workspaceHandler.GetDiagnosis)
		protected.POST("/submissions/:id/diagnosis", writeLimiter, workspaceHandler.SaveDiagnosis)

		// User preferences
		protected.GET("/user/preferences", userPrefsHandler.Get)
		protected.PUT("/user/preferences", writeLimiter, userPrefsHandler.Save)

		// Experiment Cache (memory feature)
		protected.GET("/experiments/:id/cache", cacheHandler.GetExperimentCache)
		protected.POST("/experiments/:id/cache", writeLimiter, cacheHandler.SaveCache)
		protected.DELETE("/experiments/:id/cache", cacheHandler.DeleteCache)

		// Conversations
		protected.GET("/conversations", conversationHandler.ListConversations)
		protected.POST("/conversations", writeLimiter, conversationHandler.CreateConversation)
		protected.PATCH("/conversations/:id", writeLimiter, conversationHandler.UpdateConversation)
		protected.DELETE("/conversations/:id", conversationHandler.DeleteConversation)
		protected.GET("/conversations/:id/messages", conversationHandler.GetMessages)
		protected.POST("/conversations/:id/messages", writeLimiter, conversationHandler.SendMessage)
		protected.GET("/conversations/:id/monitoring", conversationHandler.GetConversationMonitoring)

		protected.GET("/courses/:id/experiments", expHandler.ListByCourse)
		protected.GET("/experiments/:id", expHandler.Get)

		teacherGroup := protected.Group("")
		teacherGroup.Use(middleware.RequireRole("teacher", "admin"))
		{
			teacherGroup.POST("/experiments", writeLimiter, expHandler.Create)
			teacherGroup.PUT("/experiments/:id", writeLimiter, expHandler.Update)
			teacherGroup.DELETE("/experiments/:id", writeLimiter, expHandler.Delete)
			teacherGroup.POST("/test-cases", writeLimiter, expHandler.CreateTestCase)
			teacherGroup.PUT("/test-cases/:id", writeLimiter, expHandler.UpdateTestCase)
			teacherGroup.DELETE("/test-cases/:id", writeLimiter, expHandler.DeleteTestCase)
		}

		protected.POST("/submissions", submitLimiter, subHandler.Submit)
		protected.GET("/submissions", subHandler.ListAll)
		protected.GET("/submissions/:id", subHandler.GetResult)
		protected.GET("/experiments/:id/submissions", subHandler.List)

		protected.GET("/submissions/:id/traces", subHandler.GetTraces)

		// Experiment reports
		protected.POST("/submissions/:id/report", reportHandler.Submit)
		protected.GET("/submissions/:id/report", reportHandler.Get)
		teacherGroup.PUT("/reports/:id/grade", reportHandler.Grade)

		protected.GET("/progress/:experiment_id", progressHandler.GetExperimentProgress)
		protected.GET("/progress", progressHandler.GetMyProgress)
		protected.GET("/achievements", achievementHandler.List)
		protected.POST("/achievements/evaluate", writeLimiter, achievementHandler.Evaluate)

		teacherGroup.GET("/progress/course/:id", progressHandler.GetCourseProgress)

		// Comments
		protected.GET("/experiments/:id/comments", commentHandler.List)
		protected.POST("/experiments/:id/comments", writeLimiter, commentHandler.Create)
		protected.PUT("/comments/:id", writeLimiter, commentHandler.Update)
		protected.DELETE("/comments/:id", writeLimiter, commentHandler.Delete)
		protected.POST("/experiments/:id/comments/ai-ask", writeLimiter, commentHandler.AIAsk)
		teacherGroup.PUT("/comments/:id/pin", writeLimiter, commentHandler.TogglePin)

		// Teacher Dashboard
		teacherGroup.GET("/teacher/dashboard", dashboardHandler.GetDashboard)
		teacherGroup.GET("/teacher/stats/overview", teacherStatsHandler.GetOverview)
		teacherGroup.GET("/teacher/stats/errors", teacherStatsHandler.GetTopErrors)
		teacherGroup.GET("/teacher/stats/heatmap", teacherStatsHandler.GetErrorHeatmap)
		teacherGroup.GET("/teacher/stats/common-issues", teacherStatsHandler.GetCommonIssues)
		teacherGroup.GET("/teacher/students", teacherStatsHandler.GetStudents)
		teacherGroup.GET("/teacher/students/:id", teacherStatsHandler.GetStudentDetail)
		teacherGroup.PUT("/teacher/students/:id/password", writeLimiter, teacherStatsHandler.ResetStudentPassword)
		teacherGroup.GET("/teacher/export", teacherStatsHandler.ExportData)
		teacherGroup.POST("/courses", writeLimiter, courseHandler.Create)
		teacherGroup.GET("/courses/:id/students", courseHandler.GetStudents)
		teacherGroup.GET("/courses/:id/invite-codes", courseHandler.ListInviteCodes)
		teacherGroup.POST("/courses/:id/invite-codes", writeLimiter, courseHandler.CreateInviteCode)
		teacherGroup.PUT("/courses/invite-codes/:codeId/disable", writeLimiter, courseHandler.DisableInviteCode)

		teacherGroup.GET("/teacher/ai-analysis", teacherAIAnalysisHandler.GetAIAnalysis)

		// ── Admin routes ──
		adminGroup := protected.Group("")
		adminGroup.Use(middleware.RequireRole("admin"))
		{
			adminGroup.GET("/admin/db/overview", adminHandler.GetDBOverview)
			adminGroup.GET("/admin/submissions/queue", adminHandler.GetSubmissionQueue)
			adminGroup.POST("/admin/submissions/reset", adminHandler.BatchResetSubmissions)
			adminGroup.GET("/admin/experiments/config", adminHandler.GetExperimentConfigs)
			adminGroup.GET("/admin/experiments/:id/test-cases", adminHandler.ListTestCases)
			adminGroup.PUT("/admin/test-cases/:id", adminHandler.UpdateTestCase)
			adminGroup.POST("/admin/submissions/ai-adjust-score", adminHandler.AIAdjustScore)
			adminGroup.GET("/admin/logs", auditLogHandler.List)
			adminGroup.GET("/admin/logs/:id", auditLogHandler.GetByID)

			// ── User Management ──
			adminGroup.GET("/admin/users", adminUserHandler.ListUsers)
			adminGroup.POST("/admin/users", writeLimiter, adminUserHandler.CreateUser)
			adminGroup.PUT("/admin/users/:id", adminUserHandler.UpdateUser)
			adminGroup.PUT("/admin/users/:id/password", adminUserHandler.ResetPassword)
			adminGroup.PUT("/admin/users/:id/status", adminUserHandler.SetStatus)
			adminGroup.DELETE("/admin/users/:id", adminUserHandler.DeleteUser)
		}

		// Flame Graph Performance Analysis
		fg := protected.Group("/submissions/:id/flamegraph")
		fg.POST("", writeLimiter, fgHandler.GenerateFlameGraph)
		fg.GET("", fgHandler.GetFlameGraph)
		fg.GET("/diff", fgHandler.DiffFlameGraph)

		// Adaptive Difficulty
		protected.GET("/adaptive/profile", adaptiveHandler.GetProfile)
		protected.GET("/adaptive/recommend", adaptiveHandler.GetRecommendations)
		protected.GET("/experiments/:id/variant", adaptiveHandler.GetVariant)

		// Code Audit
		protected.POST("/code-audit", writeLimiter, codeAuditHandler.AuditCode)
		protected.GET("/code-audit/:submission_id", codeAuditHandler.GetAuditResult)

		// Trace Diff
		protected.POST("/traces/diff", writeLimiter, traceDiffHandler.CompareTraces)

		// ObsContext — unified observability context aggregation
		protected.GET("/submissions/:id/obs-context", obsContextHandler.GetObsContext)
		
		// Semantic analysis of syscall traces
		protected.GET("/submissions/:id/semantic/analyze", semanticHandler.Analyze)
		protected.GET("/submissions/:id/semantic/classify", semanticHandler.Classify)
		
		// Span tree from syscall traces
		protected.GET("/submissions/:id/span-tree", spanHandler.GetSpanTree)
		
		// Risk indicators from trace metrics
		protected.GET("/submissions/:id/risk-indicators", riskHandler.GetRiskIndicators)
		
		// Sandbox resource metrics
		protected.GET("/submissions/:id/sandbox-metrics", metricsHandler.GetSandboxMetrics)
		
		// Teaching narratives (Supraptive Method)
		protected.POST("/submissions/:id/teaching-narrative", writeLimiter, teachingHandler.BuildNarrative)
		protected.POST("/submissions/:id/followup-questions", writeLimiter, teachingHandler.GetFollowupQuestions)
		
		// Leak detection (Valgrind/Heaptrack-style from syscall traces)
		protected.GET("/submissions/:id/leak-report", leakHandler.GetLeakReport)
		// Memory allocation flame graph (Heaptrack-style)
		protected.GET("/submissions/:id/alloc-flamegraph", allocFlamegraphHandler.GetAllocFlamegraph)
		// Memory trend analysis (Massif-style)
		protected.GET("/submissions/:id/memory-trend", memoryTrendHandler.GetMemoryTrend)
		
		// Race detection (TSan-style Happens-Before from syscall traces)
		protected.GET("/submissions/:id/race-report", raceHandler.GetRaceReport)
		
		// Deadlock evolution analysis (Coffman conditions)
		protected.GET("/submissions/:id/deadlock-evolution", deadlockEvolverHandler.GetDeadlockEvolution)

		// eBPF Observation API
		protected.POST("/ebpf/observe", writeLimiter, ebpfHandler.StartObserve)
		protected.GET("/ebpf/observe/:pid", ebpfHandler.GetObserve)
		protected.DELETE("/ebpf/observe/:pid", writeLimiter, ebpfHandler.StopObserve)
		protected.GET("/ebpf/stream/:pid", ebpfHandler.StreamEvents)
		protected.GET("/ebpf/deadlock/:submission_id", ebpfHandler.GetSubmissionDeadlock)
	}

	// ── HTTP Server ───────────────────────────────────────────────────
	addr := ":" + cfg.Port
	srv := &http.Server{Addr: addr, Handler: r}

	go func() {
		log.Printf("Core Service starting on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// ── Graceful Shutdown ─────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down...")

	workerPool.Shutdown()
	if ebpfAdapter != nil {
		ebpfAdapter.Shutdown()
	}
	if natsBus != nil {
		natsBus.Close()
	}
	if err := sandboxMgr.Shutdown(); err != nil {
		log.Printf("Sandbox shutdown error: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Forced shutdown: %v", err)
	}
	log.Println("Server stopped")
}

func recoverStaleSubmissions(subRepo *repository.SubmissionRepo) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	n, err := subRepo.RecoverStaleSubmissions(ctx)
	if err != nil {
		log.Printf("[Recovery] failed to recover stale submissions: %v", err)
	} else if n > 0 {
		log.Printf("[Recovery] marked %d stale submissions as marked failed", n)
	} else {
		log.Println("[Recovery] no stale submissions found")
	}
}
