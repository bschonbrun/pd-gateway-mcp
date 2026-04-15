// Pipedream Connect API client
// Auth: OAuth2 client credentials (auto-refresh)
// Endpoints: app discovery, action listing, action execution

import { PD_ENVIRONMENT, TIMEOUTS } from '../config.js';

const BASE_URL = 'https://api.pipedream.com/v1';

export class PipedreamConnectClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private projectId: string,
  ) {}

  private async ensureToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return;

    const res = await fetch(`${BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUTS.authToken),
    });

    if (!res.ok) throw new Error(`OAuth token error: ${res.status}`);
    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
  }

  private async request(path: string, options: RequestInit = {}) {
    await this.ensureToken();
    const res = await fetch(`${BASE_URL}/connect/${this.projectId}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'X-PD-Environment': PD_ENVIRONMENT,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(TIMEOUTS.connectApi),
    });
    if (!res.ok) throw new Error(`Connect API error: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async listApps(query?: string) {
    const q = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request(`/components${q}`);
  }

  async listActions(appSlug: string) {
    return this.request(`/actions?app=${encodeURIComponent(appSlug)}`);
  }

  async runAction(actionKey: string, props: Record<string, unknown>, externalUserId: string) {
    return this.request('/actions/run', {
      method: 'POST',
      body: JSON.stringify({ id: actionKey, external_user_id: externalUserId, configured_props: props }),
    });
  }

  async createConnectToken(externalUserId: string) {
    return this.request('/tokens', {
      method: 'POST',
      body: JSON.stringify({ external_user_id: externalUserId }),
    });
  }

  async listAccounts(externalUserId: string) {
    return this.request(`/accounts?external_user_id=${encodeURIComponent(externalUserId)}`);
  }

  async listTriggers(app?: string) {
    const q = app ? `?app=${encodeURIComponent(app)}` : '';
    return this.request(`/triggers${q}`);
  }

  async getComponent(componentKey: string) {
    return this.request(`/components/${encodeURIComponent(componentKey)}`);
  }

  async configureProp(body: {
    component_id: string;
    prop_name: string;
    external_user_id: string;
    configured_props?: Record<string, unknown>;
    query?: string;
  }) {
    return this.request('/components/configure', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async deployTrigger(body: {
    trigger_id: string;
    external_user_id: string;
    configured_props: Record<string, unknown>;
    workflow_id?: string;
    webhook_url?: string;
  }) {
    return this.request('/triggers/deploy', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async listDeployedTriggers(externalUserId?: string) {
    const q = externalUserId ? `?external_user_id=${encodeURIComponent(externalUserId)}` : '';
    return this.request(`/deployed-triggers${q}`);
  }

  async deleteDeployedTrigger(triggerId: string, externalUserId: string) {
    return this.request(
      `/deployed-triggers/${encodeURIComponent(triggerId)}?external_user_id=${encodeURIComponent(externalUserId)}`,
      { method: 'DELETE' },
    );
  }

  async updateTriggerWorkflows(triggerId: string, workflowIds: string[], externalUserId: string) {
    return this.request(
      `/deployed-triggers/${encodeURIComponent(triggerId)}/workflows`,
      {
        method: 'PUT',
        body: JSON.stringify({ workflow_ids: workflowIds, external_user_id: externalUserId }),
      },
    );
  }
}
