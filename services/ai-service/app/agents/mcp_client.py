"""
MCP Client — Dynamic tool discovery via Model Context Protocol.

Provides automatic discovery and registration of external MCP Server tools
into the ToolRegistry. Any MCP-compatible server can expose its tools and
they become available to agents without manual wiring.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class MCPServerConfig:
    name: str
    url: str
    transport: str = "http"  # http | stdio
    api_key: str = ""
    enabled: bool = True
    timeout: float = 30.0


@dataclass
class MCPTool:
    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)
    server_name: str = ""
    server_url: str = ""


class MCPClient:
    """Discovers and manages tools from MCP-compatible servers.

    On initialization, connects to configured MCP servers, discovers their
    tools, and registers them into the ToolRegistry. Supports runtime
    refresh when new servers are added.
    """

    def __init__(self, servers: list[MCPServerConfig] | None = None):
        self._servers: dict[str, MCPServerConfig] = {}
        self._tools: dict[str, list[MCPTool]] = {}
        self._http_client: httpx.AsyncClient | None = None

        if servers:
            for s in servers:
                self._servers[s.name] = s

    @property
    def http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    def add_server(self, config: MCPServerConfig):
        self._servers[config.name] = config
        logger.info("MCP server added: %s at %s", config.name, config.url)

    def remove_server(self, name: str):
        self._servers.pop(name, None)
        self._tools.pop(name, None)
        logger.info("MCP server removed: %s", name)

    async def discover_all(self) -> dict[str, list[MCPTool]]:
        """Discover tools from all enabled servers."""
        results: dict[str, list[MCPTool]] = {}
        for name, config in self._servers.items():
            if not config.enabled:
                continue
            try:
                tools = await self.discover_server(config)
                results[name] = tools
                self._tools[name] = tools
                logger.info("MCP server %s: discovered %d tools", name, len(tools))
            except Exception as e:
                logger.error("MCP server %s discovery failed: %s", name, e)
                results[name] = []
        return results

    async def discover_server(self, config: MCPServerConfig) -> list[MCPTool]:
        """Discover tools from a single MCP server."""
        if config.transport == "http":
            return await self._discover_http(config)
        elif config.transport == "stdio":
            return await self._discover_stdio(config)
        else:
            logger.warning("Unknown MCP transport: %s", config.transport)
            return []

    async def _discover_http(self, config: MCPServerConfig) -> list[MCPTool]:
        """Discover tools from an HTTP MCP server.

        MCP HTTP servers expose tools/list at a well-known endpoint.
        """
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        # MCP tools/list request
        request_body = {
            "jsonrpc": "2.0",
            "method": "tools/list",
            "params": {},
            "id": 1,
        }

        try:
            resp = await self.http_client.post(
                config.url,
                json=request_body,
                headers=headers,
                timeout=config.timeout,
            )
            resp.raise_for_status()
            data = resp.json()

            tools = []
            for t in data.get("result", {}).get("tools", []):
                tool = MCPTool(
                    name=t.get("name", ""),
                    description=t.get("description", ""),
                    parameters=t.get("inputSchema", {}).get("properties", {}),
                    server_name=config.name,
                    server_url=config.url,
                )
                tools.append(tool)

            return tools

        except httpx.HTTPError as e:
            logger.error("MCP HTTP discovery error for %s: %s", config.name, e)
            return []
        except Exception as e:
            logger.error("MCP discovery unexpected error for %s: %s", config.name, e)
            return []

    async def _discover_stdio(self, config: MCPServerConfig) -> list[MCPTool]:
        """Discover tools from a stdio MCP server (not yet implemented)."""
        logger.warning("MCP stdio transport not yet implemented for %s", config.name)
        return []

    async def call_tool(self, server_name: str, tool_name: str, arguments: dict) -> dict[str, Any]:
        """Call a tool on an MCP server."""
        config = self._servers.get(server_name)
        if not config:
            return {"success": False, "error": f"Unknown MCP server: {server_name}"}

        if config.transport == "http":
            return await self._call_http(config, tool_name, arguments)
        else:
            return {"success": False, "error": f"Unsupported transport: {config.transport}"}

    async def _call_http(self, config: MCPServerConfig, tool_name: str, arguments: dict) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"

        request_body = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
            "id": 2,
        }

        try:
            resp = await self.http_client.post(config.url, json=request_body, headers=headers, timeout=config.timeout)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("result", {}).get("content", [])
            text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
            return {"success": True, "result": "\n".join(text_parts) if text_parts else str(content)}
        except httpx.HTTPError as e:
            return {"success": False, "error": f"HTTP error: {e}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_all_tools(self) -> list[MCPTool]:
        """Return all discovered MCP tools across all servers."""
        all_tools: list[MCPTool] = []
        for tools in self._tools.values():
            all_tools.extend(tools)
        return all_tools

    def get_tools_for_llm(self) -> list[dict]:
        """Return tools in OpenAI function-calling format."""
        result = []
        for tool in self.get_all_tools():
            result.append({
                "type": "function",
                "function": {
                    "name": f"mcp__{tool.server_name}__{tool.name}",
                    "description": f"[MCP:{tool.server_name}] {tool.description}",
                    "parameters": {"type": "object", "properties": tool.parameters},
                },
            })
        return result

    async def close(self):
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None


class MCPToolRegistry:
    """Bridge that registers MCP-discovered tools into the main ToolRegistry.

    On refresh, syncs MCP tools with the ToolRegistry. MCP tools are
    prefixed with mcp__<server>__ to avoid name collisions with built-in tools.
    """

    def __init__(self, mcp_client: MCPClient, tool_registry):
        self._mcp = mcp_client
        self._registry = tool_registry
        self._registered_tools: set[str] = set()

    async def sync(self):
        """Discover MCP tools and register new ones into the ToolRegistry."""
        await self._mcp.discover_all()
        new_tools = self._mcp.get_all_tools()

        for tool in new_tools:
            tool_id = f"mcp__{tool.server_name}__{tool.name}"
            if tool_id not in self._registered_tools:
                await self._register_mcp_tool(tool_id, tool)

    async def _register_mcp_tool(self, tool_id: str, tool: MCPTool):
        """Register an MCP tool as a callable in the ToolRegistry."""
        mcp = self._mcp

        async def _handler(**kwargs):
            result = await mcp.call_tool(tool.server_name, tool.name, kwargs)
            if result.get("success"):
                return result.get("result", "")
            else:
                raise RuntimeError(result.get("error", "MCP tool call failed"))

        # Use the existing ToolDef / ToolResult pattern
        from app.agents.tools import ToolDef
        self._registry.register(ToolDef(
            name=tool_id,
            description=f"[MCP:{tool.server_name}] {tool.description}",
            parameters=tool.parameters,
            handler=_handler,
        ))
        self._registered_tools.add(tool_id)
        logger.info("MCP tool registered: %s from %s", tool_id, tool.server_name)

    async def refresh(self):
        """Full refresh: re-discover and re-register."""
        self._registered_tools.clear()
        await self.sync()


# Server preset configurations
MCP_SERVER_PRESETS: dict[str, MCPServerConfig] = {
    "traceos-core": MCPServerConfig(
        name="traceos-core",
        url="http://localhost:8090/mcp",
        transport="http",
        enabled=True,
    ),
}


# Lazy singleton
_mcp_client: MCPClient | None = None


def get_mcp_client() -> MCPClient:
    global _mcp_client
    if _mcp_client is None:
        servers = [s for s in MCP_SERVER_PRESETS.values() if s.enabled]
        _mcp_client = MCPClient(servers=servers)
    return _mcp_client
