export const SDK_ROUTES = Object.freeze({
  covenants: "/v1/covenants",
  executions: "/v1/executions",
  webhookEndpoints: "/v1/webhook-endpoints",
  apiKeys: "/v1/api-keys",
} as const);

export const SDK_ROUTE_CONTRACT = Object.freeze([
  { method: "get", path: "/v1/covenants" },
  { method: "post", path: "/v1/covenants" },
  { method: "get", path: "/v1/covenants/{id}" },
  { method: "post", path: "/v1/covenants/{id}/authorize" },
  { method: "post", path: "/v1/covenants/{id}/execute" },
  { method: "post", path: "/v1/covenants/{id}/cancel" },
  { method: "get", path: "/v1/covenants/{id}/audit" },
  { method: "get", path: "/v1/executions/{id}" },
  { method: "get", path: "/v1/webhook-endpoints" },
  { method: "post", path: "/v1/webhook-endpoints" },
  { method: "delete", path: "/v1/webhook-endpoints/{id}" },
  { method: "get", path: "/v1/api-keys" },
  { method: "post", path: "/v1/api-keys" },
  { method: "delete", path: "/v1/api-keys/{id}" },
] as const);
