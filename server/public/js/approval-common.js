const ApprovalAPI = {
  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const userId = localStorage.getItem('approval_user_id');
    if (userId) {
      headers['X-User-Id'] = userId;
      const userName = getUserDisplayName(userId);
      if (userName) headers['X-User-Name'] = encodeURIComponent(userName);
    }
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  },
  get(url) { return this.request(url); },
  post(url, body) { return this.request(url, { method: 'POST', body: JSON.stringify(body || {}) }); },
  put(url, body) { return this.request(url, { method: 'PUT', body: JSON.stringify(body || {}) }); },
  del(url) { return this.request(url, { method: 'DELETE' }); },

  validateExpression(expression, context) {
    return this.post('/api/approval/validate-expression', { expression, context });
  },

  listTemplates() { return this.get('/api/approval/templates'); },
  getTemplate(id) { return this.get(`/api/approval/templates/${id}`); },
  createTemplate(data) { return this.post('/api/approval/templates', data); },
  updateTemplate(id, data) { return this.put(`/api/approval/templates/${id}`, data); },
  deleteTemplate(id) { return this.del(`/api/approval/templates/${id}`); },
  getPrecedingNodes(templateId, nodeId) {
    return this.get(`/api/approval/templates/${templateId}/preceding-nodes/${nodeId}`);
  },

  listInstances(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/approval/instances${qs ? '?' + qs : ''}`);
  },
  getInstance(id) { return this.get(`/api/approval/instances/${id}`); },
  createInstance(data) { return this.post('/api/approval/instances', data); },
  startInstance(id) { return this.post(`/api/approval/instances/${id}/start`); },
  approve(id, nodeId, comment) {
    return this.post(`/api/approval/instances/${id}/approve/${nodeId}`, { comment });
  },
  reject(id, nodeId, comment, targetNodeId) {
    return this.post(`/api/approval/instances/${id}/reject/${nodeId}`, { comment, target_node_id: targetNodeId });
  },
  transfer(id, nodeId, toUserId, toUserName, comment) {
    return this.post(`/api/approval/instances/${id}/transfer/${nodeId}`, {
      to_user_id: toUserId, to_user_name: toUserName, comment
    });
  },

  getTodos() { return this.get('/api/approval/todos'); },

  getCurrentUser() { return this.get('/api/current-user'); },

  getDelegationRules() { return this.get('/api/approval/delegation-rules'); },
  getDelegationRulesAsAgent() { return this.get('/api/approval/delegation-rules/as-agent'); },
  getDelegationRule(id) { return this.get(`/api/approval/delegation-rules/${id}`); },
  createDelegationRule(data) { return this.post('/api/approval/delegation-rules', data); },
  updateDelegationRule(id, data) { return this.put(`/api/approval/delegation-rules/${id}`, data); },
  toggleDelegationRule(id, enabled) { return this.put(`/api/approval/delegation-rules/${id}/toggle`, { enabled }); },
  deleteDelegationRule(id) { return this.del(`/api/approval/delegation-rules/${id}`); },
  getDelegationModes() { return this.get('/api/approval/delegation-modes'); },
  checkTimeoutDelegation() { return this.post('/api/approval/check-timeout-delegation'); }
};

let ws = null;
const wsListeners = {};

function initWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  if (ws) return ws;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    fireWsEvent('open');
    const pending = initWebSocket._pendingSubs || [];
    pending.forEach(sub => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(sub));
      }
    });
    initWebSocket._pendingSubs = [];
  });

  ws.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      fireWsEvent(data.type, data);
    } catch (e) {
      console.error('WS消息解析失败:', e);
    }
  });

  ws.addEventListener('error', (e) => fireWsEvent('error', e));
  ws.addEventListener('close', () => {
    fireWsEvent('close');
    ws = null;
  });

  return ws;
}

function sendWsMessage(msg) {
  initWebSocket();
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    initWebSocket._pendingSubs = initWebSocket._pendingSubs || [];
    initWebSocket._pendingSubs.push(msg);
  }
}

function subscribeApproval(instanceId) {
  sendWsMessage({ type: 'subscribe_approval', instanceId });
}

function unsubscribeApproval(instanceId) {
  sendWsMessage({ type: 'unsubscribe_approval', instanceId });
}

function subscribeTodos(userId) {
  if (!userId) return;
  sendWsMessage({ type: 'subscribe_todos', userId });
}

function unsubscribeTodos(userId) {
  if (!userId) return;
  sendWsMessage({ type: 'unsubscribe_todos', userId });
}

function onWsEvent(type, handler) {
  wsListeners[type] = wsListeners[type] || [];
  wsListeners[type].push(handler);
  return () => {
    wsListeners[type] = (wsListeners[type] || []).filter(h => h !== handler);
  };
}

function fireWsEvent(type, data) {
  (wsListeners[type] || []).forEach(h => {
    try { h(data); } catch (e) { console.error(e); }
  });
}

function showToast(message, type = 'info') {
  let toast = document.getElementById('approval-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'approval-toast';
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;padding:14px 22px;border-radius:8px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.15);max-width:360px;opacity:0;transform:translateY(-10px);transition:all 0.25s ease;';
    document.body.appendChild(toast);
  }
  const colors = {
    success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6'
  };
  toast.style.background = colors[type] || colors.info;
  toast.style.color = '#fff';
  toast.textContent = message;
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
  }, 2800);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}天前`;
  return formatDate(ts);
}

function getStatusBadge(status) {
  const map = {
    draft: { text: '草稿', color: '#94a3b8' },
    pending: { text: '审批中', color: '#3b82f6' },
    approved: { text: '已通过', color: '#10b981' },
    rejected: { text: '已驳回', color: '#ef4444' },
    completed: { text: '已完成', color: '#10b981' }
  };
  const cfg = map[status] || { text: status, color: '#64748b' };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${cfg.color}18;color:${cfg.color};font-size:12px;font-weight:500;border:1px solid ${cfg.color}33;">${cfg.text}</span>`;
}

function getNodeTypeLabel(type) {
  const map = {
    start: '开始',
    end: '结束',
    approval: '普通审批',
    countersign: '会签',
    condition: '条件网关'
  };
  return map[type] || type;
}

function getNodeTypeBadge(type) {
  const map = {
    start: { text: '开始', color: '#10b981', icon: '▶' },
    end: { text: '结束', color: '#64748b', icon: '⏹' },
    approval: { text: '审批', color: '#3b82f6', icon: '✓' },
    countersign: { text: '会签', color: '#8b5cf6', icon: '✦' },
    condition: { text: '条件', color: '#f59e0b', icon: '◆' }
  };
  const cfg = map[type] || { text: type, color: '#64748b', icon: '●' };
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:${cfg.color}14;color:${cfg.color};font-size:11px;font-weight:500;">${cfg.icon} ${cfg.text}</span>`;
}

function generateNodeId() {
  return 'node_' + Math.random().toString(36).substr(2, 9);
}

function getDemoUsers() {
  return [
    { id: 'user-zhangsan', name: '张三' },
    { id: 'user-lisi', name: '李四' },
    { id: 'user-wangwu', name: '王五' },
    { id: 'user-zhaoliu', name: '赵六' },
    { id: 'user-sunqi', name: '孙七' },
    { id: 'user-zhouba', name: '周八' },
    { id: 'user-wujiu', name: '吴九' },
    { id: 'user-zhengshi', name: '郑十' },
    { id: 'user-admin', name: '系统管理员' },
    { id: 'user-manager', name: '部门经理' },
    { id: 'user-director', name: '总监' },
    { id: 'user-ceo', name: 'CEO' }
  ];
}

function getUserDisplayName(userId) {
  if (!userId) return '未知';
  const users = getDemoUsers();
  const found = users.find(u => u.id === userId);
  if (found) return found.name;
  return userId.replace(/^user-/, '');
}
