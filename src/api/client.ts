import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { config } from '../config.js';
import type { ApiResponse, JsonObject } from '../types.js';
import { ApiError, NetworkError, RiskControlError } from '../utils/errors.js';
import { sleep } from '../utils/sleep.js';
import { androidSignature, webSignature } from '../utils/crypto.js';
import { assertNoRiskControl } from '../services/risk-control.js';
import { defaultParams, type RequestContext } from './request-context.js';

export interface ApiRequest {
  method: 'GET' | 'POST';
  baseURL: string;
  url: string;
  context: RequestContext;
  params?: Record<string, unknown>;
  data?: unknown;
  signature?: 'android' | 'web' | 'none';
  clearDefaultParams?: boolean;
  headers?: Record<string, string>;
  responseType?: 'json' | 'arraybuffer';
  retry?: boolean;
}

const parseSetCookies = (values: string[] | undefined): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const value of values ?? []) {
    const pair = value.split(';', 1)[0];
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) result[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return result;
};

const retryableStatus = (status: number): boolean => [502, 503, 504].includes(status);

export class ApiClient {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http = http ?? axios.create({
      timeout: config.requestTimeoutMs,
      validateStatus: () => true,
      maxRedirects: 3,
    });
  }

  async request<T = JsonObject>(input: ApiRequest): Promise<ApiResponse<T>> {
    let lastError: unknown;
    const retries = input.retry === false ? 0 : config.maxRetries;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.once<T>(input);
        if (!retryableStatus(response.status)) return response;
        if (attempt === retries) throw new NetworkError(`上游暂时不可用（HTTP ${response.status}）`);
        lastError = new NetworkError(`上游暂时不可用（HTTP ${response.status}）`);
      } catch (error) {
        assertNoRiskControl((error as { response?: unknown }).response);
        if (!(error instanceof NetworkError) || attempt === retries) throw error;
        lastError = error;
      }
      await sleep([2_000, 5_000, 10_000][attempt] ?? 10_000);
    }
    throw lastError instanceof Error ? lastError : new NetworkError();
  }

  private async once<T>(input: ApiRequest): Promise<ApiResponse<T>> {
    const params = input.clearDefaultParams
      ? { ...(input.params ?? {}) }
      : { ...defaultParams(input.context), ...(input.params ?? {}) };
    const dataText = input.data === undefined ? '' : typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
    const signatureType = input.signature ?? 'android';
    if (signatureType !== 'none' && params.signature === undefined) {
      params.signature = signatureType === 'web' ? webSignature(params, dataText) : androidSignature(params, dataText);
    }
    const request: AxiosRequestConfig = {
      method: input.method,
      baseURL: input.baseURL,
      url: input.url,
      params,
      data: input.data,
      responseType: input.responseType ?? 'json',
      headers: {
        'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
        dfid: input.context.device.dfid || '-',
        mid: input.context.device.mid,
        clienttime: String(params.clienttime ?? ''),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        ...(input.headers ?? {}),
      },
      // Axios 会自动读取 HTTP_PROXY/HTTPS_PROXY。这里默认关闭，避免登录请求
      // 意外从代理出口发出；显式的 KUGOU_API_PROXY 会在下方覆盖。
      proxy: false,
    };
    if (config.proxy) {
      const proxy = new URL(config.proxy);
      request.proxy = {
        protocol: proxy.protocol.replace(':', ''), host: proxy.hostname,
        port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
        ...(proxy.username || proxy.password ? { auth: { username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) } } : {}),
      };
    }
    try {
      const response = await this.http.request<T>(request);
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
      assertNoRiskControl(response.data, headers);
      if (response.status < 200 || response.status >= 300) {
        if (retryableStatus(response.status)) return { status: response.status, body: response.data, cookies: {}, headers };
        throw new ApiError(`酷狗接口返回 HTTP ${response.status}`, response.data);
      }
      return {
        status: response.status,
        body: response.data,
        cookies: parseSetCookies(response.headers['set-cookie']),
        headers,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (axios.isAxiosError(error)) throw new NetworkError(error.code ? `网络请求失败：${error.code}` : '网络请求失败');
      throw error;
    }
  }
}
