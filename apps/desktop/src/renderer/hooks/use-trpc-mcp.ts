import type { McpServerConfig, McpServerState, McpTool } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";

export function useMcpServers() {
  return useQuery({
    queryKey: ["mcp", "servers"],
    queryFn: () => trpcInvoke<McpServerState[]>("mcp.listServers"),
    refetchInterval: 30_000,
  });
}

export function useMcpConfigs() {
  return useQuery({
    queryKey: ["mcp", "configs"],
    queryFn: () => trpcInvoke<McpServerConfig[]>("mcp.getConfigs"),
  });
}

export function useSaveMcpConfigs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configs: McpServerConfig[]) =>
      trpcMutate<{ success: boolean }>("mcp.saveConfigs", configs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
}

export function useConnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: McpServerConfig) => trpcMutate<McpServerState>("mcp.connect", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
}

export function useDisconnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      trpcMutate<{ success: boolean }>("mcp.disconnect", { serverId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
  });
}

export function useMcpTools() {
  return useQuery({
    queryKey: ["mcp", "tools"],
    queryFn: () => trpcInvoke<McpTool[]>("mcp.listTools"),
    refetchInterval: 30_000,
  });
}
