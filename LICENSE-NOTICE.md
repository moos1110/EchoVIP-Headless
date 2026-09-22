# 第三方来源与许可证说明

本项目以 KuGouMusicApi 为主要上游，筛选并重构其酷狗概念版登录、设备和
每日 VIP 领取相关实现；EchoMusic 仅作为集成方式参考，不包含 EchoMusic 的
Electron、Vue、播放器、Rust 模块或其他源文件。

## KuGouMusicApi

- 来源：https://github.com/MakcRe/KuGouMusicApi
- 许可证：MIT
- 版权：Copyright (c) 2023 MakcRe
- 参考/移植范围：请求签名、概念版配置、二维码登录、Token 刷新、设备注册、VIP 接口协议
- 修改：改写为严格 TypeScript，使用 Node.js 原生密码模块，并加入持久化、风控、有限重试和 CLI

以下为必须随相关实现保留的完整 MIT 许可文本：

```text
MIT License

Copyright (c) 2023 MakcRe

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## EchoMusic

- 来源：https://github.com/hoowhoami/EchoMusic
- 许可证：GPL-3.0-only
- 参考范围：其对 KuGouMusicApi 的调用边界、登录态与设备字段持久化方式
- 复制代码：无；未复制 EchoMusic 源文件或 UI/播放器实现
