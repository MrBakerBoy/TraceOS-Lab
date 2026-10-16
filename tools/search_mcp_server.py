"""
Search MCP Server — 基于 DuckDuckGo 的免费 Web 搜索 MCP 服务。

提供两个工具:
  - web_search: 通用网页搜索，返回标题、URL 和摘要
  - news_search: 新闻搜索，返回发布时间和来源

无需 API Key，完全免费。
"""

import json
import sys
from typing import Optional

from ddgs import DDGS
from fastmcp import FastMCP

mcp = FastMCP("web-search")


@mcp.tool()
def web_search(query: str, max_results: int = 10) -> str:
    """
    使用 DuckDuckGo 搜索网页。

    Args:
        query: 搜索关键词
        max_results: 最大返回结果数 (默认 10, 最大 20)

    Returns:
        JSON 格式的搜索结果，包含 title, url, body
    """
    max_results = min(max_results, 20)
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            formatted = []
            for i, r in enumerate(results, 1):
                formatted.append({
                    "index": i,
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })
            return json.dumps(formatted, ensure_ascii=False, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def news_search(query: str, max_results: int = 10) -> str:
    """
    使用 DuckDuckGo 搜索新闻。

    Args:
        query: 搜索关键词
        max_results: 最大返回数 (默认 10, 最大 20)

    Returns:
        JSON 格式的新闻结果，包含 title, url, body, date, source
    """
    max_results = min(max_results, 20)
    try:
        with DDGS() as ddgs:
            results = list(ddgs.news(query, max_results=max_results))
            formatted = []
            for i, r in enumerate(results, 1):
                formatted.append({
                    "index": i,
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("body", ""),
                    "date": r.get("date", ""),
                    "source": r.get("source", ""),
                })
            return json.dumps(formatted, ensure_ascii=False, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


def main():
    """Run the MCP server via stdio transport."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()