// Pipedream Connect API client
// Auth: OAuth2 client credentials (auto-refresh)
// Endpoints: app discovery, action listing, action execution

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
        'X-PD-Environment': 'development',
        'Content-Type': 'application/json',
        ...options.headers,
      },
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
    return this.request(`/actions/${actionKey}/run`, {
      method: 'POST',
      body: JSON.stringify({ external_user_id: externalUserId, configured_props: props }),
    });
  }
}
