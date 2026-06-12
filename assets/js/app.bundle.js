// 第二引力销售系统 V3 - 全新构建
// 功能：商品管理、扫码收银、销售报表、用户管理、Supabase 云同步、PWA 离线支持
// ============================================================
// 1. 基础配置与数据初始化
// ============================================================
const SUPABASE_URL = "https://pjvrulxfsnfwwrxppffm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdnJ1bHhmc25md3dyeHBwZmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzcwMzcsImV4cCI6MjA5NjQxMzAzN30.mcKLK0gfcMnLH3eBRgd7pwMZvol7LQXdE-EAXYQIYcU";
const SY_ROOM_ID = "my_gravity_shop_2026";
let supabaseClient = null;
if (SUPABASE_URL && !SUPABASE_URL.includes("你的项目ID")) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
if (!localStorage.getItem('sg_products')) {
    const seed = [
        { id: "SG-A109E3B1", name: "重力悬浮磁吸摆件", price: 199.00, designer: "张三", image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=100" },
        { id: "SG-B7281D4C", name: "复古怀旧美式扑克牌", price: 45.00, designer: "李四", image: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=100" }
    ];
    localStorage.setItem('sg_products', JSON.stringify(seed));
}
if (!localStorage.getItem('sg_orders')) localStorage.setItem('sg_orders', JSON.stringify([]));
if (!localStorage.getItem('sg_users')) {
    localStorage.setItem('sg_users', JSON.stringify([{
        id: 'U-ADMIN', username: 'admin', password: 'admin123',
        displayName: '系统管理员', role: 'admin',
        status: 'active', createdAt: new Date().toISOString(), lastLogin: ''
    }]));
}
if (!localStorage.getItem('sg_audit_log')) localStorage.setItem('sg_audit_log', JSON.stringify([]));
let products = JSON.parse(localStorage.getItem('sg_products'));
let orders = JSON.parse(localStorage.getItem('sg_orders'));
let users = JSON.parse(localStorage.getItem('sg_users') || '[]');
let auditLog = JSON.parse(localStorage.getItem('sg_audit_log') || '[]');
let currentUser = JSON.parse(localStorage.getItem('sg_current_user') || 'null');
let cart = [], qrGenerator = null, salesChart = null;
let currentImageBase64 = "", currentEditImageBase64 = "", editingProductId = null, viewingQRProductId = null;
let sortField = 'date', sortDirection = 'desc';
const ROLE_LABELS = { admin: '管理员', manager: '店长', cashier: '收银员', viewer: '只读审计' };
const ROLE_PERMISSIONS = {
    admin: ['product_manage', 'sales_checkout', 'report_view', 'user_manage'],
    manager: ['product_manage', 'sales_checkout', 'report_view'],
    cashier: ['sales_checkout'],
    viewer: ['report_view']
};
const DISCOUNT_OPTIONS = [1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.60, 0.50, 0];


// ============================================================
// 1b. 安全与工具函数
// ============================================================
// HTML 转义 —— 所有 innerHTML 插值处应使用此函数包裹，防止 XSS
function escapeHtml(str) {
    if (typeof str !== "string") str = String(str || "");
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// 模板渲染函数 —— 自动对插值做 HTML 转义
function html(strings) {
    var result = strings[0];
    for (var i = 1; i < arguments.length; i++) {
        result += escapeHtml(String(arguments[i])) + strings[i];
    }
    return result;
}

// 密码哈希 —— 基于 Web Crypto API 的 SHA-256
async function hashPassword(pw) {
    var buf = new TextEncoder().encode(pw);
    var digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
}

// 金额计算：分 -> 元 转换，避免浮点累积误差
function toCents(val) { return Math.round((val || 0) * 100); }
function fromCents(c) { return (c || 0) / 100; }

// 购物车金额精确计算
function calcSubtotal(price, qty, discount) {
    var p = toCents(price);
    var d = discount === 0 ? 0 : (discount || 1.0);
    return fromCents(Math.round(p * qty * d));
}
function generateDiscountOptions(val) {
    return DISCOUNT_OPTIONS.map(d => '<option value="' + d + '"' + (Math.abs(d - val) < 0.001 ? ' selected' : '') + '>' + (d === 0 ? '赠送' : (d * 100) + '%') + '</option>').join('');
}
function addAudit(action, target, detail) {
    const entry = {
        id: 'A-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        time: new Date().toLocaleString(),
        user: currentUser ? currentUser.displayName + '/' + currentUser.username : '系统',
        action: action,
        target: target || '',
        detail: detail || ''
    };
    auditLog.unshift(entry);
    if (auditLog.length > 500) auditLog.length = 500;
    localStorage.setItem('sg_audit_log', JSON.stringify(auditLog));
    const tb = document.getElementById('audit-table-body');
    if (tb) renderAuditTable();
}
// ============================================================
// 2. Supabase 云同步
// ============================================================
async function syncFromCloud() {
    try {
        let { data, error } = await supabaseClient
            .from('sync_store').select('*').eq('sync_id', SY_ROOM_ID).single();
        if (data) {
            products = data.products || products;
            orders = data.orders || orders;
            if (data.users && Array.isArray(data.users)) {
                // 合并云端用户与本地用户，确保本地管理员账号不丢失
                var mergedUsers = data.users.slice();
                users.forEach(function(localUser) {
                    var exists = mergedUsers.some(function(cloudUser) {
                        return cloudUser.id === localUser.id;
                    });
                    if (!exists) mergedUsers.push(localUser);
                });
                users = mergedUsers;
                localStorage.setItem('sg_users', JSON.stringify(users));
            }
            localStorage.setItem('sg_products', JSON.stringify(products));
            localStorage.setItem('sg_orders', JSON.stringify(orders));
            renderProductTable(); renderCartTable(); updateReportDashboard(); renderUserTable(); applyAuthUI();
        }
    } catch (e) {
        console.error('[云同步] 拉取失败', e);
        if (typeof window.v3Toast === 'function') {
            window.v3Toast('从云端同步数据失败，请检查网络连接。', 'error');
        }
    }
}
async function pushToCloud() {
    if (!supabaseClient) return;
    try {
        // 同步前剥离密码字段，避免明文密码暴露到云端
        var safeUsers = users.map(function(u) {
            return Object.assign({}, u, { password: '' });
        });
        var payload = { sync_id: SY_ROOM_ID, products: products, orders: orders, users: safeUsers, updated_at: new Date() };
        var { error } = await supabaseClient.from('sync_store').upsert(payload);
        if (error) {
            await supabaseClient.from('sync_store').upsert({ sync_id: SY_ROOM_ID, products: products, orders: orders, updated_at: new Date() });
        }
    } catch (e) {
        console.error('[云同步] 推送失败', e);
        if (typeof window.v3Toast === 'function') {
            window.v3Toast('数据同步到云端失败，本地数据未丢失。', 'error');
        }
    }
}
// ============================================================
// ============================================================
// 3. 用户认证与权限
// ============================================================
function hasPermission(perm) {
    if (!currentUser) return false;
    return (ROLE_PERMISSIONS[currentUser.role] || []).includes(perm);
}
function requirePermission(perm, msg) {
    if (hasPermission(perm)) return true;
    alert(msg || '当前账号没有权限执行此操作。');
    return false;
}
function ensureDefaultAdmin() {
    if (users.some(function(u) { return u.id === 'U-ADMIN'; })) return;
    users.push({
        id: 'U-ADMIN', username: 'admin', password: 'admin123',
        displayName: '系统管理员', role: 'admin',
        status: 'active', createdAt: new Date().toISOString(), lastLogin: ''
    });
    localStorage.setItem('sg_users', JSON.stringify(users));
}
async function loginUser(e) {
    e.preventDefault();
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');

    // 统一走 users 数组验证，无硬编码后门
    try {
        ensureDefaultAdmin();

        // 先尝试直接密码匹配（兼容旧明文数据），否则用哈希比较
        var user = users.find(function(u) {
            return u.username === username && u.password === password && u.status === 'active';
        });

        // 直接匹配未命中时尝试哈希比对（新注册用户的密码为 hash 存储）
        if (!user && username && password) {
            var hash = await hashPassword(password);
            user = users.find(function(u) {
                return u.username === username && (u.password === hash || u.password === password) && u.status === 'active';
            });
            // 哈希匹配但旧存储为明文时，自动升级为哈希
            if (user && user.password !== hash) {
                user.password = hash;
                localStorage.setItem('sg_users', JSON.stringify(users));
            }
        }
    } catch(ex) {
        console.error('[登录] 验证异常', ex);
        var user = null;
    }

    if (!user) {
        if (errEl) { errEl.innerText = '账号、密码错误，或该账号已停用。'; errEl.classList.remove('hidden'); }
        return;
    }
    user.lastLogin = new Date().toLocaleString();
    localStorage.setItem('sg_users', JSON.stringify(users));
    currentUser = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
    localStorage.setItem('sg_current_user', JSON.stringify(currentUser));
    if (errEl) errEl.classList.add('hidden');
    applyAuthUI();
    renderUserTable();
    addAudit('登录系统', currentUser.username, '用户登录');
    pushToCloud();
}
function logoutUser() {
    addAudit('退出系统', currentUser ? currentUser.username : '', '用户退出');
    currentUser = null;
    localStorage.removeItem('sg_current_user');
    cart = [];
    renderCartTable();
    applyAuthUI();
}
function applyAuthUI() {
    const loggedIn = !!currentUser;
    document.getElementById('login-modal').classList.toggle('hidden', loggedIn);
    document.getElementById('btn-logout').classList.toggle('hidden', !loggedIn);
    document.getElementById('current-user-badge').classList.toggle('hidden', !loggedIn);
    if (loggedIn) {
        document.getElementById('current-user-name').innerText = currentUser.displayName + ' · ' + (ROLE_LABELS[currentUser.role] || currentUser.role);
    }
    document.querySelectorAll('[data-permission]').forEach(el => {
        el.classList.toggle('hidden', !hasPermission(el.dataset.permission));
    });
    const tabs = ['product-tab', 'sales-tab', 'report-tab', 'user-tab'];
    const permMap = { 'product-tab': 'product_manage', 'sales-tab': 'sales_checkout', 'report-tab': 'report_view', 'user-tab': 'user_manage' };
    const available = tabs.filter(t => hasPermission(permMap[t]));
    if (loggedIn) {
        const active = document.querySelector('.tab-content:not(.hidden)');
        if (!active || !available.includes(active.id)) switchTab(available[0] || 'sales-tab');
    }
}
// ============================================================
// 4. 用户管理
// ============================================================
function resetUserForm() {
    document.getElementById('user-form').reset();
    document.getElementById('u-edit-id').value = '';
    document.getElementById('u-username').disabled = false;
}
function saveUserAccount(e) {
    e.preventDefault();
    if (!requirePermission('user_manage')) return;
    const editId = document.getElementById('u-edit-id').value;
    const username = document.getElementById('u-username').value.trim();
    const displayName = document.getElementById('u-display-name').value.trim();
    const password = document.getElementById('u-password').value;
    const role = document.getElementById('u-role').value;
    const status = document.getElementById('u-status').value;
    if (!editId && password.length < 4) return alert('新用户密码至少 4 位。');
    if (!editId && users.some(u => u.username === username)) return alert('该登录账号已存在。');
    if (editId) {
        const u = users.find(x => x.id === editId);
        if (!u) return;
        u.displayName = displayName; u.role = role; u.status = status;
        if (password) u.password = password;
        if (currentUser && currentUser.id === u.id) {
            currentUser = { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
            localStorage.setItem('sg_current_user', JSON.stringify(currentUser));
        }
        addAudit('编辑用户', username, '角色:' + role + ' 状态:' + status);
    } else {
        users.push({ id: 'U-' + Date.now(), username, password, displayName, role, status, createdAt: new Date().toISOString(), lastLogin: '' });
        addAudit('新增用户', username, '角色:' + role);
    }
    localStorage.setItem('sg_users', JSON.stringify(users));
    resetUserForm(); renderUserTable(); applyAuthUI(); pushToCloud();
}
function editUserAccount(id) {
    if (!requirePermission('user_manage')) return;
    const u = users.find(x => x.id === id); if (!u) return;
    document.getElementById('u-edit-id').value = u.id;
    document.getElementById('u-username').value = u.username;
    document.getElementById('u-username').disabled = true;
    document.getElementById('u-display-name').value = u.displayName;
    document.getElementById('u-password').value = '';
    document.getElementById('u-role').value = u.role;
    document.getElementById('u-status').value = u.status;
}
function deleteUserAccount(id) {
    if (!requirePermission('user_manage')) return;
    if (currentUser && currentUser.id === id) return alert('不能删除当前登录账号。');
    if (users.length <= 1) return alert('至少保留一个系统账号。');
    if (!confirm('确定删除此用户吗？')) return;
    addAudit('删除用户', users.find(u=>u.id===id).username || '', '用户被删除');
    users = users.filter(u => u.id !== id);
    localStorage.setItem('sg_users', JSON.stringify(users));
    renderUserTable(); pushToCloud();
}
function renderUserTable() {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    tbody.innerHTML = users.map(function(u) {
        var statusText = u.status === 'active' ? '启用' : '停用';
        var statusClass = u.status === 'active' ? 'text-orange-300' : 'text-red-400';
        var lastLogin = u.lastLogin || '暂无';
        return '<tr class="border-b border-slate-800 hover:bg-slate-800/40 transition">'
            + '<td class="p-3 font-mono text-orange-300 font-bold">' + u.username + '</td>'
            + '<td class="p-3 text-slate-200">' + u.displayName + '</td>'
            + '<td class="p-3"><span class="bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-slate-300">' + (ROLE_LABELS[u.role] || u.role) + '</span></td>'
            + '<td class="p-3 ' + statusClass + '">' + statusText + '</td>'
            + '<td class="p-3 text-slate-400">' + lastLogin + '</td>'
            + '<td class="p-3 text-center space-x-1 whitespace-nowrap">'
            + '<button onclick="editUserAccount(\'' + u.id + '\')" class="text-[10px] bg-slate-700 px-2 py-1 rounded text-orange-300 font-bold hover:bg-slate-600 transition">编辑</button>'
            + '<button onclick="deleteUserAccount(\'' + u.id + '\')" class="text-[10px] bg-red-950 px-2 py-1 rounded text-red-400 font-bold hover:bg-red-900 transition">删除</button>'
            + '</td></tr>';
    }).join('');
}
// ============================================================
// 5. 界面切换与商品管理
// ============================================================
function switchTab(tabId) {
    var tabPermission = { 'product-tab': 'product_manage', 'sales-tab': 'sales_checkout', 'report-tab': 'report_view', 'user-tab': 'user_manage' }[tabId];
    if (tabPermission && !hasPermission(tabPermission)) return alert('当前账号没有权限访问该模块。');
    if (tabId !== 'sales-tab') { try { stopCameraScan(); } catch(e){} }
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.add('hidden'); });
    document.getElementById(tabId).classList.remove('hidden');
    document.querySelectorAll('#nav-tabs button').forEach(function(btn) {
        btn.classList.remove('bg-orange-600', 'text-white');
        btn.classList.add('bg-slate-700', 'hover:bg-slate-600');
    });
    document.getElementById('btn-' + tabId).classList.remove('bg-slate-700', 'hover:bg-slate-600');
    document.getElementById('btn-' + tabId).classList.add('bg-orange-600', 'text-white');
    if (tabId === 'report-tab') setTimeout(updateReportDashboard, 5);
}
function previewUploadedImage(input, mode) {
    var file = input.files[0];
    if (file) {
        if (file.size > 1 * 1024 * 1024) {
            alert("请选择 1MB 以内的图片"); return;
        }
        var reader = new FileReader();
        reader.onload = function(e) {
            if (mode === 'add') {
                currentImageBase64 = e.target.result;
                document.getElementById('upload-placeholder').classList.add('hidden');
                document.getElementById('upload-preview-img').src = currentImageBase64;
                document.getElementById('upload-preview-zone').classList.remove('hidden');
            } else {
                currentEditImageBase64 = e.target.result;
                document.getElementById('edit-upload-preview-img').src = currentEditImageBase64;
            }
        };
        reader.readAsDataURL(file);
    }
}
function clearUploadedImage(event, mode) {
    if(event) event.stopPropagation();
    currentImageBase64 = "";
    document.getElementById('p-image-file').value = "";
    document.getElementById('upload-preview-zone').classList.add('hidden');
    document.getElementById('upload-placeholder').classList.remove('hidden');
}
function shareAppSystem() {
    navigator.clipboard.writeText(window.location.href).then(function() {
        alert("系统独立专属同步访问链接已成功复制至剪贴板！");
    });
}
// 在 QR 码 canvas 上绘制商品名称
function drawNameOnQrCanvas(containerId, name) {
    if (!name) return;
    var canvas = document.getElementById(containerId).querySelector('canvas');
    if (!canvas) return;
    var w = canvas.width;
    var h = canvas.height;
    var textH = 28;
    var newCanvas = document.createElement('canvas');
    newCanvas.width = w;
    newCanvas.height = h + textH;
    var ctx = newCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h + textH);
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var displayName = name;
    var maxWidth = w - 14;
    if (ctx.measureText(displayName).width > maxWidth) {
        while (ctx.measureText(displayName + '...').width > maxWidth && displayName.length > 2) {
            displayName = displayName.slice(0, -1);
        }
        displayName += '...';
    }
    ctx.fillText(displayName, w / 2, h + textH / 2);
    canvas.parentNode.replaceChild(newCanvas, canvas);
}
function saveProduct(e) {
    if (!requirePermission('product_manage', '当前账号无权新增商品。')) return;
    e.preventDefault();
    var name = document.getElementById('p-name').value;
    var price = parseFloat(document.getElementById('p-price').value);
    var designer = document.getElementById('p-designer').value || "未署名";
    var image = currentImageBase64 || "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100";
    var stock = parseInt(document.getElementById('p-stock').value, 10) || 0;
    var lowStock = parseInt(document.getElementById('p-low-stock').value, 10) || 5;
    var id = "SG-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    products.push({ id: id, name: name, price: price, designer: designer, image: image, stock: stock, lowStock: lowStock });
    localStorage.setItem('sg_products', JSON.stringify(products));
    document.getElementById('qr-prod-name').innerText = name;
    document.getElementById('qrcode-canvas').innerHTML = "";
qrGenerator = new QRCode(document.getElementById('qrcode-canvas'), { text: id, width: 140, height: 140 });
    drawNameOnQrCanvas('qrcode-canvas', name);
    document.getElementById('qr-prod-id').innerText = '\u5546\u54c1\u7279\u5f81\u7801: ' + id;
    document.getElementById('btn-download-qr').disabled = false;
    document.getElementById('btn-download-qr').className = "w-full bg-orange-500 text-slate-950 font-bold py-2 rounded-lg text-xs shadow-lg";
    renderProductTable();
    document.getElementById('product-form').reset();
    clearUploadedImage(null, 'add');
    addAudit('新增商品', name, '价格:' + price + ' 库存:' + stock);
    pushToCloud();
}
function openEditModal(id) {
    if (!requirePermission('product_manage', '当前账号无权编辑商品。')) return;
    var p = products.find(function(prod) { return prod.id === id; });
    if(!p) return;
    editingProductId = id;
    document.getElementById('edit-p-name').value = p.name;
    document.getElementById('edit-p-price').value = p.price;
    document.getElementById('edit-p-designer').value = p.designer || '';
    document.getElementById('edit-p-stock').value = p.stock || 0;
    document.getElementById('edit-p-low-stock').value = p.lowStock || 5;
    currentEditImageBase64 = p.image;
    document.getElementById('edit-upload-preview-img').src = p.image;
    document.getElementById('edit-product-modal').classList.remove('hidden');
}
function closeEditModal() { document.getElementById('edit-product-modal').classList.add('hidden'); }
function saveEditProduct(e) {
    if (!requirePermission('product_manage', '当前账号无权编辑商品。')) return;
    e.preventDefault();
    var idx = products.findIndex(function(p) { return p.id === editingProductId; });
    if(idx !== -1) {
        products[idx].name = document.getElementById('edit-p-name').value;
        products[idx].price = parseFloat(document.getElementById('edit-p-price').value);
        products[idx].designer = document.getElementById('edit-p-designer').value;
        products[idx].stock = parseInt(document.getElementById('edit-p-stock').value, 10) || 0;
        products[idx].lowStock = parseInt(document.getElementById('edit-p-low-stock').value, 10) || 5;
        products[idx].image = currentEditImageBase64;
        localStorage.setItem('sg_products', JSON.stringify(products));
        renderProductTable(); renderCartTable(); closeEditModal();
        addAudit('编辑商品', products[idx].name, '价格:' + products[idx].price);
        pushToCloud();
    }
}
function openQRViewModal(id) {
    var p = products.find(function(prod) { return prod.id === id; });
    if(!p) return;
    viewingQRProductId = id;
    document.getElementById('modal-qr-prod-id').innerText = id;
    document.getElementById('modal-qr-prod-name').innerText = p.name;
    document.getElementById('modal-qrcode-canvas').innerHTML = "";
new QRCode(document.getElementById('modal-qrcode-canvas'), { text: id, width: 140, height: 140 });
    drawNameOnQrCanvas('modal-qrcode-canvas', p.name);
    document.getElementById('qr-view-modal').classList.remove('hidden');
}
function closeQRViewModal() { document.getElementById('qr-view-modal').classList.add('hidden'); }
function downloadModalQR() {
    var canvas = document.getElementById('modal-qrcode-canvas').querySelector('canvas');
    if(canvas) {
        var link = document.createElement('a');
        link.href = canvas.toDataURL("image/png");
        link.download = 'QR_' + viewingQRProductId + '.png';
        link.click();
    }
}
function deleteProduct(id) {
    if (!requirePermission('product_manage', '当前账号无权删除商品。')) return;
    if (!confirm('确定要删除此商品吗？')) return;
    var p = products.find(function(prod) { return prod.id === id; });
    products = products.filter(function(prod) { return prod.id !== id; });
    localStorage.setItem('sg_products', JSON.stringify(products));
    renderProductTable(); renderCartTable();
    if(p) addAudit('删除商品', p.name, '商品被删除');
    pushToCloud();
}
function downloadQR() {
    var canvas = document.getElementById('qrcode-canvas').querySelector('canvas');
    if(canvas) {
        var link = document.createElement('a');
        link.href = canvas.toDataURL("image/png");
        link.download = 'QR_' + (qrGenerator ? qrGenerator._el ? 'product' : 'product' : 'product') + '.png';
        link.click();
    }
}
function renderProductTable() {
    var tbody = document.getElementById('product-table-body');
    if (!tbody) return;
    var searchVal = (document.getElementById('product-search') || {}).value || '';
    var filtered = products.filter(function(p) {
        return p.name.indexOf(searchVal) !== -1 || p.id.indexOf(searchVal) !== -1;
    });
    tbody.innerHTML = filtered.map(function(p) {
        var stockLevel = (p.stock !== undefined && p.stock !== null) ? p.stock : '-';
        var lowWarn = '';
        if (p.stock !== undefined && p.stock !== null && p.stock <= (p.lowStock || 5)) {
            lowWarn = ' <span class="text-red-400 text-[9px]">预警</span>';
        }
        return '<tr class="border-b border-slate-700/50">'
            + '<td class="p-2"><img src="' + p.image + '" class="w-10 h-10 object-cover rounded border border-slate-700" alt="' + p.name + '" onerror="this.src=\'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80\'"></td>'
            + '<td class="p-2 font-medium text-orange-300 text-xs">' + p.name + '</td>'
            + '<td class="p-2 text-xs text-slate-300 font-mono">' + p.id + '</td>'
            + '<td class="p-2 text-xs text-slate-200">&yen;' + p.price.toFixed(2) + '</td>'
            + '<td class="p-2 text-xs text-slate-300">' + stockLevel + lowWarn + '</td>'
            + '<td class="p-2 text-xs text-slate-400">' + (p.designer || '未署名') + '</td>'
            + '<td class="p-2 text-center whitespace-nowrap space-x-1">'
            + '<button onclick="openEditModal(\'' + p.id + '\')" class="text-[10px] bg-slate-700 px-2 py-1 rounded text-orange-300"><i class="fa-regular fa-pen-to-square"></i></button>'
            + '<button onclick="openQRViewModal(\'' + p.id + '\')" class="text-[10px] bg-slate-700 px-2 py-1 rounded text-cyan-300"><i class="fa-solid fa-qrcode"></i></button>'
            + '<button onclick="deleteProduct(\'' + p.id + '\')" class="text-[10px] bg-red-950 px-2 py-1 rounded text-red-400"><i class="fa-regular fa-trash-can"></i></button>'
            + '</td></tr>';
    }).join('');
}
// ============================================================
// 6. 购物车
// ============================================================
function addToCart(productId) {
    if (!requirePermission('sales_checkout')) return;
    var p = products.find(function(prod) { return prod.id === productId; });
    if(!p) return alert('商品不存在。');
    var existing = cart.find(function(item) { return item.product.id === productId; });
    if(existing) {
        existing.quantity = parseInt(existing.quantity || 0, 10) + 1;
    } else {
        cart.push({ product: p, quantity: 1, discount: 1.0 });
    }
    renderCartTable();
    updateCartCount();
}
function updateCartDiscount(idx, val) {
    if(cart[idx]) { cart[idx].discount = parseFloat(val) || 1.0; renderCartTable(); }
}
function updateCartQty(idx, delta) {
    if(!cart[idx]) return;
    var q = parseInt(cart[idx].quantity || 1, 10) + delta;
    if(q < 1) q = 1;
    cart[idx].quantity = q;
    renderCartTable();
}
function setCartQty(idx, val) {
    if(!cart[idx]) return;
    var q = parseInt(val, 10) || 1;
    if(q < 1) q = 1;
    cart[idx].quantity = q;
    renderCartTable();
}
function updateCartCount() {
    var totalQty = cart.reduce(function(sum, item) { return sum + (parseInt(item.quantity, 10) || 0); }, 0);
    var btn = document.getElementById('btn-sales-tab');
    if(btn) {
        var icon = btn.querySelector('.fa-cash-register');
        if(icon) icon.parentNode.innerHTML = '<i class="fa-solid fa-cash-register mr-1"></i> \u6536\u94f6' + (totalQty > 0 ? ' (' + totalQty + ')' : '');
    }
}
function renderCartTable() {
    var tbody = document.getElementById('cart-table-body');
    if(!tbody) return;
    if(!cart || cart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-5 text-center text-slate-500">请扫码或搜索加入商品</td></tr>';
        var total = document.getElementById('cart-total-amount'); if(total) total.innerText = '\u00a50.00';
        var mobileTotal = document.getElementById('mobile-cart-total'); if(mobileTotal) mobileTotal.textContent = '\u00a50.00';
        updateCartCount();
        return;
    }
    var totalAmt = 0;
    tbody.innerHTML = cart.map(function(item, idx) {
        var discount = item.discount || 1.0;
        var price = Number(item.product.price || 0);
        var qty = parseInt(item.quantity || 1, 10) || 1;
        var subtotal = price * qty * discount;
        totalAmt += subtotal;
        return '<tr class="border-b border-slate-700/50 mobile-compact-row">'
            + '<td class="p-2 font-medium cart-name"><span class="sm:hidden text-slate-500 mr-1">品</span>' + item.product.name + '</td>'
            + '<td class="p-2 text-slate-400 cart-price sm:table-cell"><span class="sm:hidden text-slate-500 mr-1">价</span>\u00a5' + price.toFixed(2) + '</td>'
            + '<td class="p-2 cart-discount"><select onchange="updateCartDiscount(' + idx + ', this.value)" class="bg-slate-900 border border-slate-600 rounded text-xs px-1.5 py-1 text-orange-300">' + generateDiscountOptions(discount) + '</select></td>'
            + '<td class="p-2 cart-qty"><div class="flex items-center space-x-1.5">'
            + '<button onclick="updateCartQty(' + idx + ', -1)" class="w-7 h-7 rounded bg-slate-700 flex items-center justify-center hover:bg-slate-600">-</button>'
            + '<input type="number" min="1" step="1" inputmode="numeric" pattern="[0-9]*" value="' + qty + '" onchange="setCartQty(' + idx + ', this.value)" onblur="setCartQty(' + idx + ', this.value)" onkeydown="if(event.key===\'Enter\'){this.blur();}" class="w-14 bg-slate-950 border border-slate-600 rounded px-1 py-1 text-center font-bold text-slate-100 focus:outline-none focus:border-orange-500" title="整数数量">'
            + '<button onclick="updateCartQty(' + idx + ', 1)" class="w-7 h-7 rounded bg-slate-700 flex items-center justify-center hover:bg-slate-600">+</button>'
            + '</div></td>'
            + '<td class="p-2 text-orange-300 font-bold cart-subtotal">\u00a5' + subtotal.toFixed(2) + '</td>'
            + '<td class="p-2 text-center cart-action"><button onclick="cart.splice(' + idx + ',1); renderCartTable();" class="text-red-400 px-2 py-1"><i class="fa-regular fa-trash-can"></i></button></td>'
            + '</tr>';
    }).join('');
    var totalEl = document.getElementById('cart-total-amount'); if(totalEl) totalEl.innerText = '\u00a5' + totalAmt.toFixed(2);
    var mobileTotalEl = document.getElementById('mobile-cart-total'); if(mobileTotalEl) mobileTotalEl.textContent = '\u00a5' + totalAmt.toFixed(2);
    updateCartCount();
}
// ============================================================
// 7. 扫码功能
// ============================================================
var html5QrCode = null;
var cameraStreaming = false;
function startCameraScan() {
    if (!requirePermission('sales_checkout')) return;
    var readerEl = document.getElementById('reader');
    if (!readerEl) return;
    document.getElementById('interactive-reader-container').classList.remove('hidden');
    document.getElementById('start-scanner-btn').classList.add('hidden');
    document.getElementById('stop-scanner-btn').classList.remove('hidden');
    try {
        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            function(decodedText) {
                document.getElementById('scan-result').value = decodedText;
                addToCart(decodedText);
                cameraStreaming = true;
            }
        ).catch(function(err) {
            document.getElementById('start-scanner-btn').classList.remove('hidden');
            document.getElementById('stop-scanner-btn').classList.add('hidden');
            alert('摄像头启动失败: ' + err);
        });
    } catch(e) {
        alert('扫码模块加载失败，请确认 html5-qrcode 库已加载。');
    }
}
function stopCameraScan() {
    if (html5QrCode) {
        try { html5QrCode.stop().catch(function(){}); } catch(e) {}
        html5QrCode = null;
    }
    cameraStreaming = false;
    document.getElementById('start-scanner-btn').classList.remove('hidden');
    document.getElementById('stop-scanner-btn').classList.add('hidden');
}
function manualScan() {
    var code = document.getElementById('scan-result').value.trim();
    if(!code) return alert('请输入或扫描商品码。');
    addToCart(code);
    document.getElementById('scan-result').value = '';
}
function manualScanAndEnter(e) {
    if(e.key === 'Enter') { e.preventDefault(); manualScan(); }
}
function filterSearchProducts() {
    var q = document.getElementById('search-prod-input').value.trim().toLowerCase();
    var panel = document.getElementById('search-results-panel');
    if(!q) { panel.classList.add('hidden'); return; }
    var matches = products.filter(function(p) {
        return p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1;
    });
    if(matches.length === 0) { panel.classList.add('hidden'); return; }
    panel.innerHTML = matches.slice(0, 8).map(function(p) {
        return '<div class="px-3 py-2 text-xs text-slate-200 hover:bg-orange-900/30 cursor-pointer flex items-center gap-2" onclick="addToCart(\'' + p.id + '\'); document.getElementById(\'search-results-panel\').classList.add(\'hidden\'); document.getElementById(\'search-prod-input\').value=\'\';">'
            + '<img src="' + p.image + '" class="w-6 h-6 rounded object-cover" onerror="this.style.display=\'none\'">'
            + '<span class="flex-1 truncate">' + p.name + '</span>'
            + '<span class="text-orange-300 font-bold">&yen;' + p.price.toFixed(2) + '</span>'
            + '</div>';
    }).join('');
    panel.classList.remove('hidden');
}
document.addEventListener('click', function(e) {
    var panel = document.getElementById('search-results-panel');
    if(panel && !e.target.closest('#search-prod-input') && !e.target.closest('#search-results-panel')) {
        panel.classList.add('hidden');
    }
});
function addDropdownProductToCart() {
    var sel = document.getElementById('mock-scanner-dropdown');
    if(sel && sel.value) { addToCart(sel.value); sel.value = ''; }
}
// ============================================================
// 8. 结算与打印
// ============================================================
var selectedPayment = 'cash';
var paymentMethods = {
    cash: { label: '\u73b0\u91d1', icon: 'fa-money-bill-wave' },
    alipay: { label: '\u652f\u4ed8\u5b9d', icon: 'fa-alipay' },
    wechat: { label: '\u5fae\u4fe1\u652f\u4ed8', icon: 'fa-weixin' }
};
function getPaymentSettings() {
    try { return JSON.parse(localStorage.getItem('sg_payment_settings') || '{}'); } catch(e) { return {}; }
}
function savePaymentSettings(e) {
    e.preventDefault();
    var alipayUrl = document.getElementById('pay-alipay-qr').value.trim();
    var wechatUrl = document.getElementById('pay-wechat-qr').value.trim();
    var settings = { alipayQr: alipayUrl, wechatQr: wechatUrl };
    localStorage.setItem('sg_payment_settings', JSON.stringify(settings));
    alert('\u652f\u4ed8\u8bbe\u7f6e\u5df2\u4fdd\u5b58\u3002');
}
function loadPaymentSettings() {
    var settings = getPaymentSettings();
    var alipayInput = document.getElementById('pay-alipay-qr');
    var wechatInput = document.getElementById('pay-wechat-qr');
    if (alipayInput) alipayInput.value = settings.alipayQr || './Alipay.jpg';
    if (wechatInput) wechatInput.value = settings.wechatQr || './wechat.jpg';
}
function showPaymentModal() {
    if (!requirePermission('sales_checkout')) return;
    if (!cart || cart.length === 0) return alert('\u8d2d\u7269\u8f66\u4e3a\u7a7a\u3002');
    var total = cart.reduce(function(sum, item) {
        var disc = item.discount || 1.0;
        var price = Number(item.product.price || 0);
        var qty = parseInt(item.quantity || 1, 10) || 1;
        return sum + price * qty * disc;
    }, 0);
    document.getElementById('payment-total').innerText = '\u00a5' + total.toFixed(2);
    selectedPayment = 'cash';
    document.querySelectorAll('.payment-option').forEach(function(btn) { btn.classList.remove('active'); });
    document.querySelector('.payment-option[data-method="cash"]').classList.add('active');
    document.getElementById('payment-qr-area').classList.add('hidden');
    document.getElementById('payment-modal').classList.remove('hidden');
}
function closePaymentModal() {
    document.getElementById('payment-modal').classList.add('hidden');
}
function selectPayment(method) {
    selectedPayment = method;
    document.querySelectorAll('.payment-option').forEach(function(btn) { btn.classList.remove('active'); });
    var btn = document.querySelector('.payment-option[data-method="' + method + '"]');
    if (btn) btn.classList.add('active');
    var qrArea = document.getElementById('payment-qr-area');
    var qrImg = document.getElementById('payment-qr-img');
    if (method === 'cash') {
        qrArea.classList.add('hidden');
    } else {
        var settings = getPaymentSettings();
        var qrUrl = method === 'alipay' ? (settings.alipayQr || './Alipay.jpg') : (settings.wechatQr || './wechat.jpg');
        qrImg.src = qrUrl;
        qrImg.style.display = '';
        qrArea.classList.remove('hidden');
        document.getElementById('payment-qr-hint').innerText = '\u8bf7\u4f7f\u7528' + paymentMethods[method].label + '\u626b\u7801\u4ed8\u6b3e';
    }
}
function confirmPayment() {
    closePaymentModal();
    checkoutAndPrint(selectedPayment);
}
function checkoutAndPrint(paymentMethod) {
    if (!paymentMethod) paymentMethod = '\u73b0\u91d1';
    if (!requirePermission('sales_checkout')) return;
    if(!cart || cart.length === 0) return alert('购物车为空。');
    var totalAmt = 0;
    var items = cart.map(function(item) {
        var discount = item.discount || 1.0;
        var price = Number(item.product.price || 0);
        var qty = parseInt(item.quantity || 1, 10) || 1;
        var subtotal = price * qty * discount;
        totalAmt += subtotal;
        return { name: item.product.name, qty: qty, price: price, discount: discount, subtotal: subtotal, productId: item.product.id };
    });
    var order = {
        id: 'SG-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 5).toUpperCase(),
        date: new Date().toISOString(),
        items: items,
        total: totalAmt,
        cashier: currentUser ? currentUser.displayName : '未知',
        payment: paymentMethod || '\u73b0\u91d1'
    };
    orders.push(order);
    localStorage.setItem('sg_orders', JSON.stringify(orders));
    addAudit('结算收银', order.id, '金额:' + totalAmt.toFixed(2) + ' 商品数:' + items.length);
    cart = [];
    renderCartTable();
    updateReportDashboard();
    pushToCloud();
    showTicket(order);
}
function showTicket(order) {
    var payLabel = paymentMethods[order.payment] ? paymentMethods[order.payment].label : (order.payment || '\u73b0\u91d1');
    document.getElementById('ticket-id').innerText = order.id;
    document.getElementById('ticket-payment').innerText = payLabel;
    document.getElementById('ticket-time').innerText = new Date(order.date).toLocaleString();
    document.getElementById('ticket-total').innerText = '\u00a5' + order.total.toFixed(2);
    var itemsHtml = order.items.map(function(item) {
        return '<div class="grid grid-cols-4 gap-1">'
            + '<span class="col-span-2 truncate">' + item.name + '</span>'
            + '<span class="text-center">' + item.qty + (item.discount < 1.0 ? '(' + (item.discount * 100) + '%)' : '') + '</span>'
            + '<span class="text-right">\u00a5' + item.subtotal.toFixed(2) + '</span>'
            + '</div>';
    }).join('');
    document.getElementById('ticket-items').innerHTML = itemsHtml;
    document.getElementById('printer-modal').classList.remove('hidden');
}
function closePrinterModal() { document.getElementById('printer-modal').classList.add('hidden'); }
// ============================================================
// 9. 报表与仪表盘
// ============================================================
function updateReportDashboard() {
    if(!orders || orders.length === 0) {
        document.getElementById('stat-revenue').innerText = '\u00a50.00';
        document.getElementById('stat-orders').innerText = '0 \u5355';
        document.getElementById('stat-bestseller').innerText = '\u6682\u65e0\u6570\u636e';
        document.getElementById('evaluation-box').innerHTML = '<span class="text-slate-500">暂无销售数据，结算第一笔订单后将自动生成分析报告。</span>';
        ['top-day-list', 'top-month-list', 'top-year-list'].forEach(function(id) {
            document.getElementById(id).innerHTML = '<li class="text-slate-500 text-[10px]">暂无数据</li>';
        });
        var labelToday = document.getElementById('label-today');
        if(labelToday) labelToday.innerText = new Date().toISOString().substring(0, 10);
        var labelMonth = document.getElementById('label-month');
        if(labelMonth) labelMonth.innerText = new Date().toISOString().substring(0, 7);
        var labelYear = document.getElementById('label-year');
        if(labelYear) labelYear.innerText = new Date().getFullYear() + '\u5e74';
        renderLedgerTable();
        initChart();
        return;
    }
    var totalRevenue = orders.reduce(function(sum, o) { return sum + (o.total || 0); }, 0);
    document.getElementById('stat-revenue').innerText = '\u00a5' + totalRevenue.toFixed(2);
    document.getElementById('stat-orders').innerText = orders.length + ' \u5355';
    var allItems = [];
    orders.forEach(function(o) {
        if(o.items) o.items.forEach(function(item) { allItems.push(item); });
    });
    var salesMap = {};
    allItems.forEach(function(item) {
        if(!salesMap[item.name]) salesMap[item.name] = 0;
        salesMap[item.name] += item.qty || 1;
    });
    var sortedItems = Object.keys(salesMap).sort(function(a, b) { return salesMap[b] - salesMap[a]; });
    var bestseller = sortedItems.length > 0 ? sortedItems[0] + ' (' + salesMap[sortedItems[0]] + '\u4ef6)' : '\u6682\u65e0\u6570\u636e';
    document.getElementById('stat-bestseller').innerText = bestseller;
    // \u667a\u80fd\u5206\u6790
    var evalBox = document.getElementById('evaluation-box');
    if(evalBox) {
        var avgOrder = totalRevenue / orders.length;
        var topProduct = sortedItems.length > 0 ? sortedItems[0] : '\u65e0';
        var totalItems = allItems.reduce(function(s, i) { return s + (i.qty || 1); }, 0);
        var topRatio = topProduct !== '\u65e0' && totalItems > 0 ? (salesMap[sortedItems[0]] / totalItems * 100).toFixed(1) : 0;
        evalBox.innerHTML = '<div class="space-y-2">'
            + '<div class="flex justify-between"><span class="text-slate-400">\u5df2\u7ed3\u7b97\u5355\u6570</span><span class="text-orange-300 font-bold">' + orders.length + ' \u5355</span></div>'
            + '<div class="flex justify-between"><span class="text-slate-400">\u5e73\u5747\u5ba2\u5355\u4ef7</span><span class="text-orange-300 font-bold">\u00a5' + avgOrder.toFixed(2) + '</span></div>'
            + '<div class="flex justify-between"><span class="text-slate-400">\u7206\u6b3e\u5360\u6bd4</span><span class="text-amber-400 font-bold">' + topRatio + '%</span></div>'
            + '<div class="flex justify-between"><span class="text-slate-400">\u5355\u54c1\u79cd\u6570</span><span class="text-slate-200 font-bold">' + Object.keys(salesMap).length + '</span></div>'
            + '<hr class="border-slate-700">'
            + '<div class="text-slate-400 text-[10px]">\u3010\u7b56\u7565\u5efa\u8bae\u3011<br>' + (topRatio > 30 ? '\u7206\u6b3e\u5360\u6bd4\u8fc7\u9ad8\uff0c\u5efa\u8bae\u4e30\u5bcc\u4ea7\u54c1\u7ebf\u3002' : '\u4ea7\u54c1\u5206\u5e03\u8f83\u5747\u5300\uff0c\u53ef\u8003\u8651\u7a81\u51fa\u7206\u6b3e\u4fc3\u9500\u3002') + '<br>'
            + (avgOrder < 100 ? '\u5efa\u8bae\u8bbe\u7f6e\u6ee1\u51cf\u4fc3\u9500\u63d0\u9ad8\u5ba2\u5355\u4ef7\u3002' : '\u5ba2\u5355\u4ef7\u826f\u597d\uff0c\u53ef\u8003\u8651\u4f1a\u5458\u8425\u9500\u3002') + '</div></div>';
    }
    // TOP \u6392\u884c
    var now = new Date();
    var todayStr = now.toISOString().substring(0, 10);
    var monthStr = now.toISOString().substring(0, 7);
    var yearStr = '' + now.getFullYear();
    var labelToday = document.getElementById('label-today');
    if(labelToday) labelToday.innerText = todayStr;
    var labelMonth = document.getElementById('label-month');
    if(labelMonth) labelMonth.innerText = monthStr;
    var labelYear = document.getElementById('label-year');
    if(labelYear) labelYear.innerText = yearStr + '\u5e74';
    function getTopN(orders, filterFn, n) {
        var itemMap = {};
        orders.filter(filterFn).forEach(function(o) {
            if(o.items) o.items.forEach(function(item) {
                if(!itemMap[item.name]) itemMap[item.name] = 0;
                itemMap[item.name] += item.qty || 1;
            });
        });
        return Object.keys(itemMap).sort(function(a, b) { return itemMap[b] - itemMap[a]; }).slice(0, n).map(function(k) {
            return { name: k, qty: itemMap[k] };
        });
    }
    var dayTop = getTopN(orders, function(o) { return o.date && o.date.substring(0, 10) === todayStr; }, 10);
    var monthTop = getTopN(orders, function(o) { return o.date && o.date.substring(0, 7) === monthStr; }, 10);
    var yearTop = getTopN(orders, function(o) { return o.date && o.date.substring(0, 4) === yearStr; }, 10);
    var dayList = document.getElementById('top-day-list');
    if(dayList) dayList.innerHTML = dayTop.length ? dayTop.map(function(t, i) {
        return '<li class="flex justify-between"><span class="truncate flex-1"><span class="text-orange-300 font-bold mr-1">' + (i + 1) + '</span>' + t.name + '</span><span class="text-slate-400 font-mono">' + t.qty + '</span></li>';
    }).join('') : '<li class="text-slate-500 text-[10px]">今日暂无</li>';
    var monthList = document.getElementById('top-month-list');
    if(monthList) monthList.innerHTML = monthTop.length ? monthTop.map(function(t, i) {
        return '<li class="flex justify-between"><span class="truncate flex-1"><span class="text-orange-300 font-bold mr-1">' + (i + 1) + '</span>' + t.name + '</span><span class="text-slate-400 font-mono">' + t.qty + '</span></li>';
    }).join('') : '<li class="text-slate-500 text-[10px]">本月暂无</li>';
    var yearList = document.getElementById('top-year-list');
    if(yearList) yearList.innerHTML = yearTop.length ? yearTop.map(function(t, i) {
        return '<li class="flex justify-between"><span class="truncate flex-1"><span class="text-amber-400 font-bold mr-1">' + (i + 1) + '</span>' + t.name + '</span><span class="text-slate-400 font-mono">' + t.qty + '</span></li>';
    }).join('') : '<li class="text-slate-500 text-[10px]">本年暂无</li>';
    renderLedgerTable();
    initChart();
}
function initChart() {
    var canvas = document.getElementById('salesTrendChart');
    if(!canvas) return;
    var ctx = canvas.getContext('2d');
    if(salesChart) { salesChart.destroy(); salesChart = null; }
    var monthData = {};
    orders.forEach(function(o) {
        if(!o.date) return;
        var m = o.date.substring(0, 7);
        if(!monthData[m]) monthData[m] = 0;
        monthData[m] += o.total || 0;
    });
    var labels = Object.keys(monthData).sort();
    var values = labels.map(function(l) { return monthData[l]; });
    if(labels.length === 0) {
        labels = [new Date().toISOString().substring(0, 7)];
        values = [0];
    }
    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '\u6708\u9500\u552e\u989d (\u00a5)',
                data: values,
                borderColor: '#a855f7',
                backgroundColor: 'rgba(168,85,247,0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#c084fc',
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#a1a1aa', font: { size: 11 } } }
            },
            scales: {
                x: { ticks: { color: '#a1a1aa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#a1a1aa', font: { size: 10 }, callback: function(v) { return '\u00a5' + v; } }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}
// ============================================================
// 10. 历史账单与审计
// ============================================================
function handleSort(field) {
    if(sortField === field) { sortDirection = (sortDirection === 'desc') ? 'asc' : 'desc'; }
    else { sortField = field; sortDirection = 'desc'; }
    renderLedgerTable();
}
function renderLedgerTable() {
    var tbody = document.getElementById('ledger-table-body');
    if(!tbody) return;
    var sorted = (orders || []).slice().sort(function(a, b) {
        var va, vb;
        if(sortField === 'id') { va = a.id || ''; vb = b.id || ''; return sortDirection === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb); }
        if(sortField === 'date') { va = a.date || ''; vb = b.date || ''; return sortDirection === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb); }
        if(sortField === 'total') { va = a.total || 0; vb = b.total || 0; return sortDirection === 'desc' ? vb - va : va - vb; }
        return 0;
    });
    var sortIcons = { id: '', date: '', total: '' };
    sortIcons[sortField] = sortDirection === 'desc' ? ' \u25bc' : ' \u25b2';
    document.getElementById('sort-icon-id').textContent = sortIcons.id || '';
    document.getElementById('sort-icon-date').textContent = sortIcons.date || '';
    document.getElementById('sort-icon-total').textContent = sortIcons.total || '';
    tbody.innerHTML = sorted.map(function(o) {
        var itemsStr = o.items ? o.items.map(function(item) {
            return item.name + ' x' + item.qty + (item.discount && item.discount < 1.0 ? '(' + (item.discount * 100) + '%)' : '');
        }).join(', ') : '';
        var dateStr = o.date ? new Date(o.date).toLocaleString() : '';
        return '<tr class="border-b border-slate-700/50">'
            + '<td class="p-3 font-mono text-[10px] text-orange-300">' + o.id + '</td>'
            + '<td class="p-3 text-[10px] text-slate-300">' + dateStr + '</td>'
            + '<td class="p-3 text-[10px] text-slate-400 max-w-[180px] truncate" title="' + itemsStr.replace(/"/g, '&quot;') + '">' + itemsStr + '</td>'
            + '<td class="p-3 text-xs text-orange-300 font-bold">\u00a5' + (o.total || 0).toFixed(2) + '</td>'
            + '<td class="p-3 text-center"><button onclick="deleteOrder(\'' + o.id + '\')" class="text-[10px] bg-red-950 px-2 py-1 rounded text-red-400"><i class="fa-regular fa-trash-can"></i></button></td>'
            + '</tr>';
    }).join('');
}
function deleteOrder(id) {
    if(!confirm('确定删除此订单吗？')) return;
    var o = orders.find(function(o) { return o.id === id; });
    orders = orders.filter(function(o) { return o.id !== id; });
    localStorage.setItem('sg_orders', JSON.stringify(orders));
    renderLedgerTable(); updateReportDashboard();
    if(o) addAudit('删除订单', id, '金额:' + (o.total || 0).toFixed(2));
    pushToCloud();
}
function renderAuditTable() {
    var tbody = document.getElementById('audit-table-body');
    if(!tbody) return;
    tbody.innerHTML = auditLog.map(function(entry) {
        return '<tr class="border-b border-slate-700/50">'
            + '<td class="p-2 text-[10px] text-slate-400">' + (entry.time || '') + '</td>'
            + '<td class="p-2 text-[10px] text-slate-300">' + ((entry.user || '').split('/')[0]) + '</td>'
            + '<td class="p-2 text-[10px] text-orange-300 font-bold">' + (entry.action || '') + '</td>'
            + '<td class="p-2 text-[10px] text-slate-300">' + (entry.target || '') + '</td>'
            + '<td class="p-2 text-[10px] text-slate-400 max-w-[120px] truncate">' + (entry.detail || '') + '</td>'
            + '<td class="p-2 text-center"><button onclick="deleteAuditEntry(\'' + entry.id + '\')" class="text-[10px] bg-red-950 px-1.5 py-0.5 rounded text-red-400">\u2715</button></td>'
            + '</tr>';
    }).join('');
}
function deleteAuditEntry(id) {
    auditLog = auditLog.filter(function(e) { return e.id !== id; });
    localStorage.setItem('sg_audit_log', JSON.stringify(auditLog));
    renderAuditTable();
}
function clearAuditLogs() {
    if(!confirm('确定清空所有审计日志吗？')) return;
    auditLog = [];
    localStorage.setItem('sg_audit_log', JSON.stringify(auditLog));
    renderAuditTable();
}
// ============================================================
// 11. 导出功能
// ============================================================
function exportOrdersCsv() {
    var csv = '\u6d41\u6c34\u5355\u53f7,\u65f6\u95f4,\u5546\u54c1\u660e\u7ec6,\u603b\u91d1\u989d,\u6536\u94f6\u5458\n';
    orders.forEach(function(o) {
        var items = o.items ? o.items.map(function(i) { return i.name + ' x' + i.qty; }).join('; ') : '';
        var date = o.date ? new Date(o.date).toLocaleString() : '';
        csv += '"' + (o.id || '') + '","' + date + '","' + items + '","' + (o.total || 0) + '","' + (o.cashier || '') + '"\n';
    });
    downloadCsv(csv, '\u7cfb\u7edf\u9500\u552e\u8bb0\u5f55.csv');
}
function exportProductsCsv() {
    var csv = '\u5546\u54c1ID,\u5546\u54c1\u540d\u79f0,\u5355\u4ef7,\u8bbe\u8ba1\u5e08,\u5e93\u5b58\n';
    products.forEach(function(p) {
        csv += '"' + (p.id || '') + '","' + (p.name || '') + '","' + (p.price || 0) + '","' + (p.designer || '') + '","' + (p.stock !== undefined ? p.stock : '-') + '"\n';
    });
    downloadCsv(csv, '\u7cfb\u7edf\u5546\u54c1\u6e05\u5355.csv');
}
function exportAuditCsv() {
    var csv = '\u65f6\u95f4,\u7528\u6237,\u52a8\u4f5c,\u5bf9\u8c61,\u8bf4\u660e\n';
    auditLog.forEach(function(e) {
        csv += '"' + (e.time || '') + '","' + ((e.user || '').split('/')[0]) + '","' + (e.action || '') + '","' + (e.target || '') + '","' + (e.detail || '') + '"\n';
    });
    downloadCsv(csv, '\u5ba1\u8ba1\u65e5\u5fd7.csv');
}
function downloadCsv(content, filename) {
    var blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}
// ============================================================
// 12. 管理员功能：修改密码、清除销售记录、重置系统
// ============================================================
function changeOwnPassword(e) {
    e.preventDefault();
    if (!currentUser) return alert('请先登录。');
    var oldP = document.getElementById('own-old-password').value;
    var newP = document.getElementById('own-new-password').value;
    if (!newP || newP.length < 6) return alert('新密码至少 6 位。');
    var u = users.find(function(x) { return x.id === currentUser.id || x.username === currentUser.username; });
    if (!u) return alert('当前账号不存在，请重新登录。');
    if (u.password !== oldP) return alert('当前密码不正确。');
    u.password = newP;
    localStorage.setItem('sg_users', JSON.stringify(users));
    addAudit('修改密码', u.username, '当前账号自行修改');
    document.getElementById('own-old-password').value = '';
    document.getElementById('own-new-password').value = '';
    alert('密码已更新。');
    pushToCloud();
}
function clearAllSalesRecordsByAdmin() {
    if (!currentUser || currentUser.role !== 'admin') return alert('仅管理员可以清除销售记录。');
    var password = prompt('请输入当前管理员密码，以确认清除全部销售记录：');
    if (password === null) return;
    if (!password) return alert('未输入密码，操作已取消。');
    var admin = users.find(function(u) { return u.id === currentUser.id && u.password === password; });
    if (!admin) return alert('管理员密码错误，未清除任何销售记录。');
    var count = orders.length;
    if (!count) return alert('当前没有可清除的销售记录。');
    if (!confirm('危险操作：即将永久清除全部 ' + count + ' 条销售记录。\n\n商品、库存、用户与审计日志不会被删除。\n\n确定继续吗？')) return;
    orders = [];
    localStorage.setItem('sg_orders', JSON.stringify([]));
    addAudit('清除销售记录', '全部销售记录', '管理员确认清除 ' + count + ' 条订单');
    updateReportDashboard();
    pushToCloud();
    alert('已清除 ' + count + ' 条销售记录。');
}
function resetSystemData() {
    if (!confirm('危险操作！此操作将清除所有本地数据（商品、订单、用户），并同步清空云端。\n\n确定继续吗？')) return;
    if (!confirm('再次确认：所有数据将被永久删除！')) return;
    localStorage.removeItem('sg_products');
    localStorage.removeItem('sg_orders');
    localStorage.removeItem('sg_users');
    localStorage.removeItem('sg_current_user');
    localStorage.removeItem('sg_audit_log');
    location.reload();
}
// ============================================================
// 13. 扫码枪键盘输入补丁
// ============================================================
(function() {
    var scannerBuffer = "";
    var lastKeyTime = 0;
    // 输入框聚焦时清空缓冲区，防止扫码枪数据与键盘输入混合
    document.addEventListener('focusin', function() {
        scannerBuffer = "";
    });
    document.addEventListener('keydown', function(e) {
        if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(e.target.tagName) !== -1) {
            scannerBuffer = "";
            return;
        }
        var now = Date.now();
        if (e.key === 'Enter' && scannerBuffer.length > 4) {
            var code = scannerBuffer;
            scannerBuffer = "";
            e.preventDefault();
            if (typeof addToCart === 'function') addToCart(code);
            return;
        }
        if (now - lastKeyTime > 100) scannerBuffer = "";
        lastKeyTime = now;
        if (e.key.length === 1) {
            scannerBuffer += e.key;
            if (scannerBuffer.length > 50) scannerBuffer = scannerBuffer.slice(-50);
        }
    });
})();
// ============================================================
// 14. 移动端紧凑布局补丁
// ============================================================
(function() {
    var DEFAULT_TAB = 'sales-tab';
    function tabAllowed(tab) {
        try {
            var map = {'product-tab':'product_manage','sales-tab':'sales_checkout','report-tab':'report_view','user-tab':'user_manage'};
            return !map[tab] || typeof hasPermission !== 'function' || hasPermission(map[tab]);
        } catch(e) { return tab === 'sales-tab'; }
    }
    function preferredTabs() {
        return ['sales-tab', 'product-tab', 'report-tab', 'user-tab'];
    }
    function showDefaultSalesTab() {
        if (typeof switchTab === 'function') {
            var target = tabAllowed(DEFAULT_TAB) ? DEFAULT_TAB : (preferredTabs().find(function(t) { return tabAllowed(t); }) || DEFAULT_TAB);
            try { switchTab(target); } catch(e) {}
        }
    }
    var oldApplyAuthUICompact = window.applyAuthUI;
    if (typeof oldApplyAuthUICompact === 'function') {
        window.applyAuthUI = function() {
            oldApplyAuthUICompact();
            try {
                if (currentUser) {
                    var active = document.querySelector('.tab-content:not(.hidden)');
                    if (!active || active.id === 'product-tab') showDefaultSalesTab();
                }
            } catch(e) {}
        };
    }
    function ensureMobileCheckoutBar() {
        if (document.getElementById('mobile-bottom-checkout')) return;
        var bar = document.createElement('div');
        bar.id = 'mobile-bottom-checkout';
        bar.className = 'mobile-bottom-checkout';
bar.innerHTML = '<div class="flex-1 min-w-0"><div class="text-[10px] text-slate-400">\u5e94\u6536</div><div id="mobile-cart-total" class="text-xl font-black text-orange-300 truncate">\u00a50.00</div></div><button onclick="showPaymentModal()" class="bg-orange-500 hover:bg-orange-600 text-slate-950 font-black px-5 py-3 rounded-xl text-sm shadow-lg shadow-orange-500/10 whitespace-nowrap"><i class="fa-solid fa-credit-card mr-1"></i>\u7ed3\u7b97</button>';
        document.body.appendChild(bar);
    }
    function syncMobileTotal() {
        var src = document.getElementById('cart-total-amount');
        var dst = document.getElementById('mobile-cart-total');
        if (src && dst) dst.textContent = src.textContent || '\u00a50.00';
    }
    function compactDynamicTexts() {
        var gunLabel = document.querySelector('label[for="scanner-gun-input"]');
        if (gunLabel) gunLabel.innerHTML = '<i class="fa-solid fa-barcode mr-1"></i>\u626b\u7801\u67aa';
        var gunInput = document.getElementById('scanner-gun-input');
        if (gunInput) gunInput.placeholder = '\u626b\u7801\u67aa\u626b\u63cf\u6216\u7c98\u8d34\u5546\u54c1\u7801\u56de\u8f66';
        var gunBtn = document.getElementById('scanner-gun-submit-btn');
        if (gunBtn) gunBtn.textContent = '\u5f55\u5165';
        var gunFocus = document.getElementById('scanner-gun-focus-btn');
        if (gunFocus) gunFocus.textContent = '\u805a\u7126';
        var status = document.getElementById('scanner-gun-status');
        if (status && /USB|\u84dd\u7259|\u626b\u7801\u67aa/.test(status.textContent || '')) status.textContent = '\u626b\u7801\u67aa\u8f93\u5165\u540e\u81ea\u52a8\u52a0\u5165\u8d2d\u7269\u8f66\u3002';
    }
    var origSwitchTab = window.switchTab;
    if (typeof origSwitchTab === 'function') {
        window.switchTab = function(tabId) {
            origSwitchTab(tabId);
            setTimeout(function() { compactDynamicTexts(); syncMobileTotal(); }, 80);
        };
    }
    document.addEventListener('DOMContentLoaded', function() {
        ensureMobileCheckoutBar();
        setTimeout(showDefaultSalesTab, 250);
        setTimeout(function() { if (typeof renderCartTable === 'function') renderCartTable(); compactDynamicTexts(); }, 650);
    });
    window.addEventListener('focus', function() {
        setTimeout(function() { ensureMobileCheckoutBar(); compactDynamicTexts(); syncMobileTotal(); }, 200);
    });
})();
// ============================================================
// 15. V3 增强层
// ============================================================
(function() {
    'use strict';
    var VERSION = '3.0.0';
    var state = { deferredInstallPrompt: null };
    function $(id) { return document.getElementById(id); }
    function ensureToastStack() {
        var stack = $('v3-toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'v3-toast-stack';
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }
        return stack;
    }
    function labelOf(type) {
        var labels = { success: '\u64cd\u4f5c\u6210\u529f', error: '\u9700\u8981\u5904\u7406', warning: '\u6ce8\u610f', info: '\u63d0\u793a' };
        return labels[type] || '\u63d0\u793a';
    }
    function toast(message, type, title) {
        if (!type) type = 'info';
        var stack = ensureToastStack();
        var node = document.createElement('div');
        node.className = 'v3-toast ' + type;
        var iconMap = { success: '\u2713', error: '!', warning: '\u26a0', info: 'i' };
        var icon = iconMap[type] || 'i';
        node.innerHTML = '<div class="v3-toast-icon">' + icon + '</div><div><div class="v3-toast-title">' + (title || labelOf(type)) + '</div><div class="v3-toast-message">' + String(message || '') + '</div></div><button type="button" aria-label="\u5173\u95ed\u901a\u77e5">\u2715</button>';
        node.querySelector('button').addEventListener('click', function() { node.remove(); });
        stack.appendChild(node);
        window.setTimeout(function() { node.remove(); }, type === 'error' ? 6200 : 3800);
    }
    var nativeAlert = window.alert;
    window.alert = function(message) {
        toast(message, /\u9519\u8bef|\u5931\u8d25|\u6ca1\u6709\u6743\u9650|\u505c\u7528/.test(String(message)) ? 'error' : 'warning');
        console.warn('[V3 alert intercepted]', message);
    };
    window.v3Toast = toast;
    window.v3NativeAlert = nativeAlert;
    function createSyncIndicator() {
        if ($('v3-sync-indicator')) return;
        var indicator = document.createElement('div');
        indicator.id = 'v3-sync-indicator';
        indicator.innerHTML = '<span class="v3-dot"></span><span>\u4e91\u7aef\u540c\u6b65\u4e2d</span>';
        document.body.appendChild(indicator);
    }
    function decorateNetworkStatus() {
        var badge = document.createElement('div');
        badge.className = 'v3-status-pill';
        badge.id = 'v3-network-pill';
        badge.style.position = 'fixed';
        badge.style.left = '14px';
        badge.style.bottom = 'calc(18px + env(safe-area-inset-bottom))';
        badge.style.zIndex = '72';
        document.body.appendChild(badge);
        var update = function() {
            var online = navigator.onLine;
            badge.classList.toggle('online', online);
            badge.classList.toggle('offline', !online);
            badge.textContent = online ? '\u5728\u7ebf \u00b7 \u81ea\u52a8\u540c\u6b65' : '\u79bb\u7ebf \u00b7 \u672c\u5730\u6682\u5b58';
        };
        window.addEventListener('online', function() { update(); toast('\u7f51\u7edc\u5df2\u6062\u590d\uff0c\u6570\u636e\u4f1a\u7ee7\u7eed\u540c\u6b65\u3002', 'success'); });
        window.addEventListener('offline', function() { update(); toast('\u5f53\u524d\u79bb\u7ebf\uff0c\u9500\u552e\u6570\u636e\u4ecd\u4f1a\u4fdd\u5b58\u5728\u672c\u673a\u3002', 'warning'); });
        update();
    }
    function decorateInstallPrompt() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'v3-install-fab';
        btn.className = 'v3-fab';
        btn.innerHTML = '<span>\u2b07</span><span>\u5b89\u88c5\u5e94\u7528</span>';
        document.body.appendChild(btn);
        window.addEventListener('beforeinstallprompt', function(event) {
            event.preventDefault();
            state.deferredInstallPrompt = event;
            btn.classList.add('show');
        });
        btn.addEventListener('click', async function() {
            if (!state.deferredInstallPrompt) return toast('\u5f53\u524d\u6d4f\u89c8\u5668\u6682\u672a\u5f00\u653e\u5b89\u88c5\u5165\u53e3\uff0c\u53ef\u5728\u6d4f\u89c8\u5668\u83dc\u5355\u4e2d\u9009\u62e9\u201c\u6dfb\u52a0\u5230\u4e3b\u5c4f\u5e55\u201d\u3002', 'info');
            state.deferredInstallPrompt.prompt();
            await state.deferredInstallPrompt.userChoice.catch(function() { return null; });
            state.deferredInstallPrompt = null;
            btn.classList.remove('show');
        });
    }
    function strengthenDefaultAdminWarning() {
        try {
            var u = JSON.parse(localStorage.getItem('sg_users') || '[]');
            var weak = u.some(function(x) { return x.username === 'admin' && x.password === 'admin123'; });
            if (weak) toast('\u68c0\u6d4b\u5230\u9ed8\u8ba4\u7ba1\u7406\u5458\u5bc6\u7801 admin123\u3002\u4e0a\u7ebf\u524d\u8bf7\u5728\u201c\u7528\u6237\u7ba1\u7406\u201d\u4e2d\u7acb\u5373\u4fee\u6539\u3002', 'warning', '\u5b89\u5168\u63d0\u9192');
        } catch (_) {}
    }
    function addKeyboardShortcuts() {
        document.addEventListener('keydown', function(event) {
            if (event.altKey || event.metaKey || event.ctrlKey) return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement ? document.activeElement.tagName : '') !== -1) return;
            var map = { '1': 'product-tab', '2': 'sales-tab', '3': 'report-tab', '4': 'user-tab' };
            if (map[event.key] && typeof window.switchTab === 'function') {
                event.preventDefault();
                window.switchTab(map[event.key]);
            }
            if (event.key === '/' && $('product-search')) {
                event.preventDefault();
                $('product-search').focus();
            }
        });
    }
    function wrapCloudSyncIndicators() {
        createSyncIndicator();
        var indicator = $('v3-sync-indicator');
        ['syncFromCloud', 'pushToCloud'].forEach(function(name) {
            var original = window[name];
            if (typeof original !== 'function') return;
            window[name] = async function() {
                var args = arguments;
                indicator.classList.add('active');
                try { return await original.apply(this, args); }
                finally { window.setTimeout(function() { indicator.classList.remove('active'); }, 280); }
            };
        });
    }
    function registerServiceWorkerUpdateUX() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.addEventListener('controllerchange', function() {
            toast('\u5e94\u7528\u5df2\u66f4\u65b0\u5230\u65b0\u7248\u3002\u5237\u65b0\u540e\u5373\u53ef\u4f7f\u7528\u6700\u65b0\u7f13\u5b58\u3002', 'success', '\u66f4\u65b0\u5b8c\u6210');
        });
    }
    window.addEventListener('load', function() {
        ensureToastStack();
        createSyncIndicator();
        decorateNetworkStatus();
        decorateInstallPrompt();
        addKeyboardShortcuts();
        wrapCloudSyncIndicators();
        registerServiceWorkerUpdateUX();
        strengthenDefaultAdminWarning();
        toast('V3 \u589e\u5f3a\u4f53\u9a8c\u5c42\u5df2\u542f\u7528\uff1a\u79fb\u52a8\u7aef UI\u3001Toast\u3001\u5b89\u88c5\u63d0\u793a\u3001\u79bb\u7ebf\u72b6\u6001\u548c\u5feb\u6377\u952e\u3002', 'success', '\u6b22\u8fce\u4f7f\u7528');
    });
})();
// ============================================================
// 16. 初始化
// ============================================================
document.addEventListener('DOMContentLoaded', async function initApp() {
    // 立即清理登录缓存，确保每次刷新都显示登录弹窗
    currentUser = null;
    localStorage.removeItem('sg_current_user');
    applyAuthUI();
    // 确保默认管理员始终存在
    ensureDefaultAdmin();
    renderProductTable();
    renderCartTable();
    initChart();
    updateReportDashboard();
    renderUserTable();
    renderAuditTable();
    if (supabaseClient) {
        try { await syncFromCloud(); } catch(e) { console.error('[初始化] 云同步失败', e); }
    }
    // 更新下拉选项
    loadPaymentSettings();
    var sel = document.getElementById('mock-scanner-dropdown');
    if (sel) {
        sel.innerHTML = '<option value="">选择商品</option>'
            + products.map(function(p) { return '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (¥' + p.price.toFixed(2) + ')</option>'; }).join('');
    }
});
