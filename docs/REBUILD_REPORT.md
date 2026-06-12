# 项目重建与冗余清理报告

## 主要冗余来源

1. `assets/js/patches/72-78` 连续覆盖 `pushToCloud`、`syncFromCloud`、手动同步面板和同步数据打包逻辑。实际运行时以后加载的 `78-auto-sync-v9.js` 为准，前面的 72-77 多数只产生加载和维护负担。
2. `index.html` 同时加载 7 个核心模块、13 个补丁和 1 个增强脚本，请求数量多，加载顺序脆弱。
3. `sw.js` 缓存了大量已被覆盖的历史补丁，PWA 更新后容易出现旧缓存与新代码不一致。
4. 自助改密逻辑只存在于旧同步 v5 补丁中，因此重建时单独保留为 `Refactor bridge`，避免删除旧补丁后丢失功能。

## 重建策略

采用低风险 bundle 方案：

- 保留现有 HTML DOM、CSS、localStorage key 和 Supabase 数据结构。
- 将核心模块和仍有效的最新补丁合并到 `assets/js/app.bundle.js`。
- 删除历史云同步补丁 72-77，仅保留最新自动同步 v9。
- 将 `sw.js` 缓存列表改为新 bundle，避免离线缓存继续保存已删除的补丁文件。

## 保留的有效脚本能力

- 核心模块：`00-bootstrap` 到 `60-utils-security-export`。
- PWA/移动收银：原 `70-pwa-mobile-pos`。
- 用户稳定性：原 `71-user-stability-fix`。
- 自动同步：原 `78-auto-sync-v9`。
- UI 清理：原 `79-ui-cleanup-v10`。
- 扫码枪键盘输入：原 `80-scanner-keyboard-v11`。
- 移动端紧凑布局：原 `81-mobile-layout-v12`。
- 管理员清空销售记录：原 `82-admin-clear-sales`。
- V3 增强体验：原 `v3-enhancements`。

## 数量变化

| 项目 | 重建前 | 重建后 |
|---|---:|---:|
| 总文件数 | 33 | 9 |
| JS 文件数 | 22 | 2 |
| JS 行数 | 3396 | 2433 |
| 页面业务脚本请求 | 21 | 1 |
| 已归档/删除的历史同步补丁 | 6 | 0 |

## 后续建议

1. 下一轮可把 `app.bundle.js` 再拆成真正的 ES Modules，例如 `state.js`、`products.js`、`sales.js`、`sync.js`、`scanner.js`。
2. 将明文/前端哈希密码体系迁移到 Supabase Auth 或后端认证。
3. 把 Supabase URL 和 anon key 改成部署环境变量注入，避免硬编码。
4. 给结账、库存扣减、云同步冲突合并增加自动化测试。
