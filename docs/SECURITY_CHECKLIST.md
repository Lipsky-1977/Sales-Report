# 安全上线清单

- [ ] 修改默认管理员密码，不使用 `admin/admin123`。
- [ ] Supabase 表启用 Row Level Security。
- [ ] 为商品、订单、用户表分别配置最小权限策略。
- [ ] 不在前端保存明文密码；迁移到 Supabase Auth 或后端哈希方案。
- [ ] 清理测试数据和测试账号。
- [ ] 检查 Supabase anon key 只能访问允许的公共能力。
- [ ] 为删除商品、清空销售记录、重置系统数据保留审计日志。
- [ ] 部署 HTTPS，避免摄像头、PWA 和 Service Worker 失效。
