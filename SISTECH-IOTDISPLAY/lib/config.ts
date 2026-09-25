/**
 * SISTECH Roadside IoT Display Configuration
 */

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    // Check if user set an override in localStorage
    const saved = localStorage.getItem("itms_api_base_url");
    if (saved) return saved.replace(/\/+$/, "");
  }

  const envUrl = process.env.NEXT_PUBLIC_ITMS_API_BASE_URL;
  if (envUrl && envUrl.trim() !== "") {
    return envUrl.trim().replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const loc = window.location;
    // Default to port 3000 on the same host if accessing over LAN
    return `${loc.protocol}//${loc.hostname}:3000`;
  }

  return "http://127.0.0.1:3000";
}

export function getWebSocketUrl(): string {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("itms_ws_url");
    if (saved) return saved;
  }

  const envWs = process.env.NEXT_PUBLIC_ITMS_WS_URL;
  if (envWs && envWs.trim() !== "") {
    return envWs.trim();
  }

  const apiBase = getApiBaseUrl();
  try {
    const parsed = new URL(apiBase);
    const wsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${parsed.host}/ws`;
  } catch {
    return "ws://127.0.0.1:3000/ws";
  }
}
