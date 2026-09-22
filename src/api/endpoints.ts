export const endpoints = {
  loginBase: 'https://login-user.kugou.com',
  gatewayBase: 'https://gateway.kugou.com',
  userServiceBase: 'https://userservice.kugou.com',
  vipBase: 'https://kugouvip.kugou.com',
  qrKey: '/v2/qrcode',
  qrCheck: '/v2/get_userinfo_qrcode',
  tokenRefresh: '/v5/login_by_token',
  registerDevice: '/risk/v2/r_register_dev',
  claimDay: '/youth/v1/recharge/receive_vip_listen_song',
  monthRecord: '/youth/v1/activity/get_month_vip_record',
  unionVip: '/v1/get_union_vip',
} as const;

