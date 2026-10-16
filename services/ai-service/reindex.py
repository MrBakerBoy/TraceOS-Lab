#!/usr/bin/env python3
"""重新生成所有知识库 chunks 的向量嵌入。

后端优先级：external_api → sentence-transformers → ONNX → TF-IDF。
当前部署未配置外部 Embedding API，实际使用 TF-IDF n-gram（1536 维），
与 knowledge_chunks.embedding 的 vector(1536) 及 RAG_EMBEDDING_DIMENSION 一致。
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.db.connection import get_pool, init_db
from app.services.rag.embedding_service import embedding_service
from app.services.rag.hybrid_retriever import hybrid_retriever

async def main():
    await init_db()
    pool = get_pool()

    # 找出所有 embedding 为 NULL 的 chunks
    rows = await pool.fetch(
        "SELECT id, content FROM knowledge_chunks WHERE embedding IS NULL"
    )
    total = len(rows)
    if total == 0:
        print("✅ 所有 chunks 已有嵌入，无需处理")
        return

    print(f"🔧 需要生成嵌入的 chunks: {total}")
    
    batch_size = 8
    done = 0
    for i in range(0, total, batch_size):
        batch = rows[i:i+batch_size]
        ids = [r['id'] for r in batch]
        texts = [r['content'] for r in batch]
        
        try:
            embeddings = await embedding_service.embed(texts)
            for j, emb in enumerate(embeddings):
                emb_str = "[" + ",".join(f"{x:.8f}" for x in emb) + "]"
                await pool.execute(
                    "UPDATE knowledge_chunks SET embedding = $1::vector WHERE id = $2",
                    emb_str, ids[j]
                )
        except Exception as e:
            print(f"  ⚠️ batch {i//batch_size}: {e}")
            continue
        
        done += len(batch)
        print(f"  [{done}/{total}] 已完成 ({done*100//total}%)")
    
    # 验证
    final = await pool.fetchval("SELECT count(*) FROM knowledge_chunks WHERE embedding IS NOT NULL")
    print(f"\n✅ 嵌入生成完成！{final}/{final} chunks 已有向量")

    # 清除 BM25 缓存
    hybrid_retriever._invalidate_bm25_cache(None)
    print("✅ BM25 缓存已刷新")

if __name__ == "__main__":
    asyncio.run(main())
