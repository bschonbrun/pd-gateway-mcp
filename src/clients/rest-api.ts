// Pipedream REST API v1 client
// Auth: API Key (Bearer token)
// Endpoints: workflow CRUD, event history

const BASE_URL = 'https://api.pipedream.com/v1';

export class PipedreamRestClient {
  private orgId?: string;

  constructor(private apiKey: string, orgId?: string) {
    this.orgId = orgId;
  }

  private async request(path: string, options: RequestInit = {}) {
    const url = this.orgId
      ? `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}org_id=${this.orgId}`
      : `${BASE_URL}${path}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) throw new Error(`Pipedream API error: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async listWorkflows(limit = 10) {
    return this.request(`/users/me/workflows?limit=${limit}`);
  }

  async getWorkflow(id: string) {
    return this.request(`/workflows/${id}`);
  }

  async getWorkflowEvents(id: string, limit = 10) {
    return this.request(`/workflows/${id}/event_summaries?limit=${limit}&expand=event`);
  }

  async triggerWebhook(url: string, data: Record<string, unknown> = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.text() };
  }

  async createWorkflow(body: Record<string, unknown>) {
    return this.request('/workflows', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateWorkflow(id: string, patch: Record<string, unknown>) {
    return this.request(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  }

  async deleteWorkflow(id: string) {
    return this.request(`/workflows/${id}`, { method: 'DELETE' });
  }
}

