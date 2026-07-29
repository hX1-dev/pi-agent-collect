import type { Approval, CreateDirectiveInput, DashboardSnapshot, Run } from "@private-ai-org/core";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json() as T | { error: string }
    : { error: (await response.text()) || `Request failed: ${response.status}` };
  if (!response.ok) {
    throw new Error("error" in (body as object) ? (body as { error: string }).error : `Request failed: ${response.status}`);
  }
  return body as T;
}

export const api = {
  dashboard: () => request<DashboardSnapshot>("/api/dashboard"),
  createDirective: (input: CreateDirectiveInput) => request("/api/directives", {
    method: "POST",
    body: JSON.stringify(input)
  }),
  dispatchTask: (taskId: string) => request<Run>(`/api/tasks/${encodeURIComponent(taskId)}/dispatch`, {
    method: "POST",
    body: "{}"
  }),
  reviewTask: (taskId: string, decision: "accepted" | "rework") => request(
    `/api/tasks/${encodeURIComponent(taskId)}/review`,
    { method: "POST", body: JSON.stringify({ decision }) }
  ),
  decideApproval: (approvalId: string, decision: "approved" | "rejected") => request<Approval>(
    `/api/approvals/${encodeURIComponent(approvalId)}/decision`,
    { method: "POST", body: JSON.stringify({ decision }) }
  )
};
