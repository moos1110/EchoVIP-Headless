export type JsonObject = Record<string, unknown>;

export interface DeviceIdentity {
  version: 1;
  guid: string;
  mid: string;
  dfid: string;
  dev: string;
  mac: string;
  webgl: string;
  platform: 'concept';
  createdAt: string;
}

export interface AuthState {
  version: 1;
  userid: string;
  token: string;
  loginMethod: 'qr';
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string | null;
  lastRefreshAt: string | null;
  t1?: string;
  vipType?: string;
  vipToken?: string;
}

export interface TaskState {
  version: 1;
  userid?: string;
  lastClaimDate: string | null;
  lastClaimStatus: 'SUCCESS' | 'ALREADY' | 'FAILED' | 'RISK_CONTROL' | 'UNCONFIRMED' | null;
  lastClaimAt: string | null;
  lastError: string | null;
}

export interface ApiResponse<T = JsonObject> {
  status: number;
  body: T;
  cookies: Record<string, string>;
  headers: Record<string, string>;
}
