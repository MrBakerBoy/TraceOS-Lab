"""TraceOS Lab AI Service - Configuration"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    service_name: str = "ai-service"
    port: int = 8000

    # PostgreSQL
    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_user: str = "traceos"
    pg_password: str = "traceos_dev"
    pg_database: str = "traceos"

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379

    # Core Service
    core_service_url: str = "http://localhost:8080"

    # NATS
    nats_url: str = "nats://localhost:4222"

    # JWT
    jwt_secret: str = ""

    # =========================================================================
    # Unified LLM Configuration (replaces mimo_* settings)
    # =========================================================================
    # Provider: "mimo" | "deepseek" | "deepseek-v4" | "openai" | "custom"
    llm_provider: str = "deepseek-v4"

    # Override API endpoint (empty = use provider preset)
    llm_api_base_url: str = ""

    # API key
    llm_api_key: str = ""

    # Model name (empty = use provider preset)
    llm_model: str = ""

    # Request config
    llm_timeout: int = 300
    llm_max_retries: int = 3

    # =========================================================================
    # Legacy MiMo settings (deprecated, auto-mapped to llm_* for compat)
    # =========================================================================
    @property
    def mimo_api_base_url(self) -> str:
        return self.llm_api_base_url or ""

    @property
    def mimo_api_key(self) -> str:
        return self.llm_api_key

    @property
    def mimo_model(self) -> str:
        return self.llm_model or ""

    @property
    def mimo_timeout(self) -> int:
        return self.llm_timeout

    @property
    def mimo_max_retries(self) -> int:
        return self.llm_max_retries

    # =========================================================================
    # RAG Embedding
    # =========================================================================
    rag_embedding_model: str = "text-embedding-3-small"
    rag_embedding_dimension: int = 1536
    rag_embedding_batch_size: int = 32
    # 外部 Embedding API（OpenAI 兼容）；留空则复用 llm_api_base_url / llm_api_key
    rag_embedding_api_base_url: str = ""
    rag_embedding_api_key: str = ""

    # RAG Retrieval
    rag_top_k: int = 8
    rag_similarity_threshold: float = 0.5  # bge-m3 dense embeddings, higher threshold
    rag_max_context_tokens: int = 3000

    # RAG Chunking
    rag_chunk_size: int = 512
    rag_chunk_overlap: int = 64
    rag_code_chunk_size: int = 256

    # RAG Import
    rag_max_file_size_mb: int = 50
    rag_max_git_repo_size_mb: int = 500

    # RAG Feature Flags
    rag_enabled: bool = True
    rag_diagnosis_enabled: bool = True
    rag_hints_enabled: bool = True
    rag_chat_enabled: bool = True

    # Flame Graph Service
    flamegraph_service_url: str = "http://172.17.0.1:8765"

    class Config:
        env_file = ".env"
        extra = "allow"  # Allow extra env vars from project-wide .env

    @property
    def database_url(self) -> str:
        return (
            f"postgresql://{self.pg_user}:{self.pg_password}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
        )

    def validate_llm_config(self) -> list[str]:
        """Validate LLM configuration and return warnings.

        Returns a list of warning/error messages, empty if all good.
        """
        warnings: list[str] = []

        if not self.llm_api_key or self.llm_api_key.startswith("sk-your-"):
            warnings.append(
                "LLM_API_KEY is not configured or uses placeholder value. "
                "AI diagnosis features will not work. Set a valid API key."
            )

        if not self.llm_api_base_url and self.llm_provider == "custom":
            warnings.append(
                "LLM_PROVIDER=custom but LLM_API_BASE_URL is empty. "
                "Custom providers require an explicit API base URL."
            )

        return warnings

    # =========================================================================
    # Observability (OpenTelemetry + Langfuse)
    # =========================================================================
    otel_enabled: bool = False
    otel_service_name: str = "traceos-ai-service"
    otel_exporter_endpoint: str = ""

    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"

    # =========================================================================
    # Diagnosis Harness
    # =========================================================================
    diagnosis_max_iterations: int = 5
    diagnosis_confidence_threshold: float = 0.60
    diagnosis_review_threshold: float = 0.75
    diagnosis_agent_timeout_ms: int = 60_000
    diagnosis_cost_budget_cents: int = 500  # Max cost per diagnosis (cents)


settings = Settings()
