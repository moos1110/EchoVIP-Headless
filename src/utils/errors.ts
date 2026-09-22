export class EchoVipError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthRequiredError extends EchoVipError {
  constructor(message = '登录态不存在或已失效，请重新扫码登录') { super(message, 10); }
}
export class TokenExpiredError extends EchoVipError {
  constructor(message = 'Token 已失效且无法刷新') { super(message, 11); }
}
export class RiskControlError extends EchoVipError {
  constructor(message = '检测到账号安全验证，已停止自动操作') { super(message, 20); }
}
export class NetworkError extends EchoVipError {
  constructor(message = '网络请求失败') { super(message, 30); }
}
export class ApiError extends EchoVipError {
  constructor(message: string, readonly response?: unknown) { super(message, 40); }
}
export class InvalidResponseError extends ApiError {
  constructor(message = '上游返回结构无效', response?: unknown) { super(message, response); }
}
export class AlreadyClaimedError extends EchoVipError {
  constructor(message = '今日 VIP 已领取') { super(message, 0); }
}
export class StorageError extends EchoVipError {
  constructor(message: string, override readonly cause?: unknown) { super(message, 50); }
}

export const isEchoVipError = (value: unknown): value is EchoVipError => value instanceof EchoVipError;
