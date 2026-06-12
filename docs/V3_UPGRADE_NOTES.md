# 第二引力销售系统 V3 升级说明

## 本次 V3 已完成

1. UI 体验增强
   - 新增 `assets/css/v3-ui.css`，统一视觉语言：玻璃拟态卡片、柔和橙色强调、移动端更大的触控区域。
   - 优化表格、按钮、输入框、导航 Tab、弹窗的视觉层级和交互反馈。
   - 增加 `prefers-reduced-motion` 支持，照顾减少动画偏好的用户。

2. 移动端体验
   - 保留原有移动收银布局，并增强底部安全区、按钮触感和输入框可用性。
   - 增加 PWA 安装浮动按钮，支持浏览器触发安装时一键安装。
   - 增加在线/离线状态胶囊，离线时提醒“本地暂存”。

3. 反馈机制
   - 新增 `assets/js/v3-enhancements.js`。
   - 将大多数 `alert()` 转为非阻塞 Toast，减少打断操作。
   - 增加云端同步状态提示。
   - 增加应用更新提示。

4. PWA 升级
   - `sw.js` 升级到 `second-gravity-sales-v3.0.0` 缓存命名。
   - 缓存新增 V3 CSS/JS、Logo 和核心资源。
   - App Shell 使用 network-first，其他同源资源使用 cache-first。
   - 激活阶段清理旧缓存并立即接管页面。

5. Manifest 升级
   - 应用名更新为 V3。
   - 增加 `id`、`display_override`、`categories`、`shortcuts`。
   - 优化 `start_url`，便于浏览器识别新版安装入口。

6. 安全提示
   - 登录界面不再直接展示默认管理员账号/密码。
   - V3 启动时会检测默认管理员密码 `admin123`，并通过 Toast 提醒修改。

## 未强行改动的部分

为了避免破坏现有业务数据，V3 没有擅自更改：

- Supabase 项目地址和 anon key。
- `localStorage` 数据结构。
- 商品、订单、用户的字段结构。
- 原有扫码、结算、报表、用户管理函数名称。

## 下一步强烈建议

1. 在 Supabase 启用 RLS。
2. 不要把管理员权限只放在前端判断。
3. 将用户密码迁移为 Supabase Auth 或后端哈希校验。
4. 后续 V3.1 可继续把 `index.html` 内联业务逻辑拆分为模块。
