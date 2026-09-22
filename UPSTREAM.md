# 上游兼容记录

## 来源关系

- 主要上游：[MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)。本项目从其公开实现中移植酷狗概念版请求签名、二维码登录、Token 刷新、设备注册、每日 VIP 领取和月度记录协议，并重构为严格 TypeScript 的低频 Headless 工具。
- 设计参考：[hoowhoami/EchoMusic](https://github.com/hoowhoami/EchoMusic)。仅参考其调用 KuGouMusicApi 的边界和登录态、设备字段持久化思路，没有复制其 Electron、Vue、播放器、Rust 模块或其他源文件。
- 本项目不是对上游仓库的原样打包：它缩减了接口范围，并增加固定设备身份、幂等复核、风控停止、多账号隔离、Web 管理和服务器随机调度。

## 改造背景

目标使用场景是让具有长期在线服务器的用户继续在较新安卓设备上使用最新版酷狗概念版。旧版 2.5.5 在部分 Android 11 及以上设备上存在兼容问题，而后续版本需要在手机端观看广告领取当天 VIP。本项目在服务器上为账号本人低频执行当天领取；领取结果归属于同一酷狗账号，手机端无需承担定时运行或每日手动领取。

## 已审计版本

- EchoMusic：`309c6acf62b0450ec17234b6d1e086902a1a8178`
- KuGouMusicApi：`b34a8b14de0f3de73067b5141456e254176472e0`
- 审计日期：2026-09-19

## 已移植协议

- 二维码：`/v2/qrcode`、`/v2/get_userinfo_qrcode`
- Token：`/v5/login_by_token`
- 设备：`/risk/v2/r_register_dev`
- 每日领取：`/youth/v1/recharge/receive_vip_listen_song`
- 月度记录：`/youth/v1/activity/get_month_vip_record`
- 联合会员：`/v1/get_union_vip`

## 更新检查重点

上游更新时重点比较 `module/login_qr_*.js`、`module/login_token.js`、
`module/register_dev.js`、`module/youth_*vip*.js`、`util/request.js`、
`util/helper.js`、`util/crypto.js` 与 `util/config.json`。
