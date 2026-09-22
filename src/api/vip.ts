import type { JsonObject } from '../types.js';
import { ApiClient } from './client.js';
import { endpoints } from './endpoints.js';
import type { RequestContext } from './request-context.js';

export class VipApi {
  constructor(private readonly client: ApiClient) {}

  monthRecord(context: RequestContext) {
    return this.client.request<JsonObject>({
      method: 'GET', baseURL: endpoints.gatewayBase, url: endpoints.monthRecord,
      context, params: { latest_limit: 100 },
    });
  }

  unionStatus(context: RequestContext) {
    return this.client.request<JsonObject>({
      method: 'GET', baseURL: endpoints.vipBase, url: endpoints.unionVip,
      context, params: { busi_type: 'concept', opt_product_types: 'dvip,qvip', product_type: 'svip' },
    });
  }

  claimDay(context: RequestContext, date: string) {
    return this.client.request<JsonObject>({
      method: 'POST', baseURL: endpoints.gatewayBase, url: endpoints.claimDay,
      retry: false,
      context, params: { source_id: 90139, receive_day: date },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }
}
