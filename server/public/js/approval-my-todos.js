let currentUserId = localStorage.getItem('approval_user_id') || 'user-lisi';
let currentUserName = getUserDisplayName(currentUserId);
let currentTab = 'todo';
let todosCache = [];
let instancesCache = [];
let currentSubTab = 'all';

function renderUserSelector() {
  const users = getDemoUsers();
  const container = document.getElementById('currentUserPills');
  container.innerHTML = '';
  users.slice(0, 8).forEach(u => {
    const pill = document.createElement('span');
    pill.className = `user-pill${u.id === currentUserId ? ' active' : ''}`;
    pill.textContent = u.name;
    pill.onclick = () => switchUser(u.id);
    container.appendChild(pill);
  });
}

function switchUser(userId) {
  currentUserId = userId;
  currentUserName = getUserDisplayName(userId);
  localStorage.setItem('approval_user_id', userId);
  renderUserSelector();
  unsubscribeWs();
  subscribeWs();
  loadData();
  showToast(`已切换到：${currentUserName}`, 'info');
}

document.querySelectorAll('#mainTabs .tab-btn').forEach(btn => {
  btn.onclick = () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('#mainTabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    
    const subTabsContainer = document.getElementById('subTabsContainer');
    if (currentTab === 'todo') {
      subTabsContainer.style.display = '';
    } else {
      subTabsContainer.style.display = 'none';
    }
    
    renderList();
    updateTitle();
  };
});

document.querySelectorAll('#subTabs .tab-btn').forEach(btn => {
  btn.onclick = () => {
    currentSubTab = btn.dataset.subtab;
    document.querySelectorAll('#subTabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderList();
  };
});

function updateTitle() {
  const titles = {
    todo: '待我审批',
    my: '我发起的审批',
    all: '全部审批记录'
  };
  document.getElementById('panelTitle').textContent = titles[currentTab] || '列表';
}

async function loadData() {
  try {
    [todosCache, instancesCache] = await Promise.all([
      ApprovalAPI.getTodos(),
      ApprovalAPI.listInstances()
    ]);
    renderStats();
    renderList();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderStats() {
  const myTodoCount = todosCache.length;
  const myStarted = instancesCache.filter(i => i.created_by === currentUserId).length;
  const pendingCount = instancesCache.filter(i => i.status === 'pending').length;
  const completedCount = instancesCache.filter(i => i.status === 'completed').length;
  
  const delegatedToMe = todosCache.filter(t => t.delegator_id && t.delegator_id !== currentUserId).length;
  const delegatedAway = todosCache.filter(t => t.delegated_to_user_id && t.delegated_to_user_id !== currentUserId).length;
  const normalTodos = todosCache.filter(t => !t.delegator_id || t.delegator_id === currentUserId).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-number" style="color:#ef4444;">${myTodoCount}</div>
      <div class="stat-label">🎯 我的待办</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" style="color:#f59e0b;">${delegatedToMe}</div>
      <div class="stat-label">🤝 待我代签</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" style="color:#8b5cf6;">${delegatedAway}</div>
      <div class="stat-label">↪️ 已转出</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" style="color:#10b981;">${completedCount}</div>
      <div class="stat-label">✅ 已完成</div>
    </div>
  `;
}

function renderList() {
  const body = document.getElementById('listBody');
  let list = [];

  if (currentTab === 'todo') {
    let filteredTodos = [...todosCache];
    
    if (currentSubTab === 'delegated') {
      filteredTodos = todosCache.filter(t => t.delegator_id && t.delegator_id !== currentUserId);
    } else if (currentSubTab === 'normal') {
      filteredTodos = todosCache.filter(t => !t.delegator_id || t.delegator_id === currentUserId);
    } else if (currentSubTab === 'delegated-away') {
      filteredTodos = todosCache.filter(t => t.delegated_to_user_id && t.delegated_to_user_id !== currentUserId);
    }
    
    list = filteredTodos.map(t => ({
      id: t.instance_id,
      type: 'todo',
      title: t.document_title,
      template_name: t.template_name,
      node_name: t.node_name,
      node_type: t.node_type,
      status: 'pending',
      created_by_name: t.started_by,
      created_at: t.created_at,
      updated_at: t.updated_at,
      node_id: t.node_id,
      metadata: null,
      delegator_id: t.delegator_id,
      delegator_name: t.delegator_name,
      delegated_to_user_id: t.delegated_to_user_id,
      delegated_to_user_name: t.delegated_to_user_name,
      delegate_rule_id: t.delegate_rule_id
    }));
  } else if (currentTab === 'my') {
    list = instancesCache
      .filter(i => i.created_by === currentUserId)
      .map(i => enrichInstance(i, 'my'));
  } else {
    const visible = instancesCache.filter(i => {
      const isCreator = i.created_by === currentUserId;
      const inTodo = todosCache.some(t => t.instance_id === i.id);
      return isCreator || inTodo;
    });
    list = visible.map(i => enrichInstance(i, 'all'));
  }

  list.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

  document.getElementById('listCount').textContent = `共 ${list.length} 条`;

  if (list.length === 0) {
    const tips = {
      todo: '🎉 太棒了！当前没有待办任务',
      my: '您还没有发起过审批',
      all: '暂无相关审批记录'
    };
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p style="margin:0;">${tips[currentTab]}</p>
      </div>
    `;
    return;
  }

  if (currentTab === 'todo') {
    body.innerHTML = list.map(item => renderTodoItem(item)).join('');
  } else {
    body.innerHTML = `<div class="instance-list">${list.map(item => renderInstanceItem(item)).join('')}</div>`;
  }
}

function enrichInstance(inst, type) {
  const tplName = inst.template ? inst.template.name : (
    todosCache.find(t => t.instance_id === inst.id)?.template_name || '未知模板'
  );
  const todo = todosCache.find(t => t.instance_id === inst.id);
  return {
    id: inst.id,
    type,
    title: inst.document_title || `审批 #${inst.id}`,
    template_name: tplName,
    node_name: todo?.node_name || (inst.current_node_ids?.[0] ? '节点处理中' : ''),
    node_type: todo?.node_type,
    status: inst.status,
    created_by_name: inst.created_by_name,
    created_at: inst.created_at,
    updated_at: inst.updated_at,
    node_id: todo?.node_id,
    metadata: inst.metadata,
    is_todo: !!todo
  };
}

function renderTodoItem(item) {
  const isDelegatedToMe = item.delegator_id && item.delegator_id !== currentUserId;
  const isDelegatedAway = item.delegated_to_user_id && item.delegated_to_user_id !== currentUserId;
  
  const nodeBadge = item.node_type === 'countersign'
    ? `<span class="tag" style="background:#ede9fe; color:#7c3aed;">✦ 会签</span>`
    : `<span class="tag" style="background:#dbeafe; color:#2563eb;">✓ 审批</span>`;
  
  let itemClass = 'todo-item';
  let extraBadges = '';
  let disableActions = false;
  
  if (isDelegatedToMe) {
    itemClass += ' delegated has-delegated-tooltip';
    extraBadges = `<span class="delegated-badge" title="委托来源：${escapeHtml(item.delegator_name || '')}">🤝 代签 ${escapeHtml(item.delegator_name || '')}</span>`;
  } else if (isDelegatedAway) {
    itemClass += ' delegated-away';
    extraBadges = `<span class="delegated-away-tag">↪️ 已由 ${escapeHtml(item.delegated_to_user_name || '')} 代签</span>`;
    disableActions = true;
  }
  
  return `
    <div class="${itemClass}" onclick="${disableActions ? 'event.preventDefault();' : `openInstance(${item.id})`}">
      <div class="todo-main">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
          <div class="todo-title" style="margin:0;">${escapeHtml(item.title)}</div>
          ${extraBadges}
        </div>
        <div class="todo-meta">
          ${nodeBadge}
          <span>📌 ${escapeHtml(item.node_name || '未知节点')}</span>
          <span>📐 ${escapeHtml(item.template_name || '')}</span>
          <span>👤 ${escapeHtml(item.created_by_name || '')}</span>
          <span>🕐 ${timeAgo(item.updated_at)}</span>
        </div>
        ${isDelegatedToMe ? `
          <div class="delegated-tooltip" style="left:100px; bottom:100%;">
            📝 委托来源：${escapeHtml(item.delegator_name || '')}
          </div>
        ` : ''}
      </div>
      <div class="todo-actions">
        ${!disableActions ? `
          <div style="display:flex; gap:6px;">
            <button class="mini-btn success" onclick="event.stopPropagation(); quickApprove(${item.id}, '${item.node_id}')">✓ 通过</button>
            <button class="mini-btn danger" onclick="event.stopPropagation(); openReject(${item.id}, '${item.node_id}')">✗ 驳回</button>
          </div>
          <button class="mini-btn primary" onclick="event.stopPropagation(); openInstance(${item.id})">查看详情 →</button>
        ` : `
          <button class="mini-btn" onclick="event.stopPropagation(); openInstance(${item.id})">查看详情 →</button>
        `}
      </div>
    </div>
  `;
}

function renderInstanceItem(item) {
  const badges = [];
  if (item.is_todo && currentTab !== 'todo') {
    badges.push(`<span class="tag" style="background:#fee2e2; color:#dc2626; font-weight:600;">🎯 待我处理</span>`);
  }
  const metaStr = item.metadata ? Object.entries(item.metadata).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' · ') : '';
  return `
    <div class="instance-item" onclick="openInstance(${item.id})">
      <div style="flex:1; min-width:0;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:5px; flex-wrap:wrap;">
          <span style="font-weight:600; color:#1e293b; font-size:14px;">${escapeHtml(item.title)}</span>
          ${badges.join('')}
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:#64748b;">
          <span>📐 ${escapeHtml(item.template_name || '')}</span>
          ${item.node_name ? `<span>📍 ${escapeHtml(item.node_name)}</span>` : ''}
          ${metaStr ? `<span style="color:#8b5cf6;">🗂 ${escapeHtml(metaStr)}</span>` : ''}
          <span>👤 ${escapeHtml(item.created_by_name || '未知')}</span>
          <span>🕐 ${timeAgo(item.updated_at)}</span>
        </div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
        ${getStatusBadge(item.status)}
        <button class="mini-btn primary">查看</button>
      </div>
    </div>
  `;
}

function openInstance(id) {
  location.href = `/approval/document/${id}`;
}

async function quickApprove(instanceId, nodeId) {
  if (!confirm('确定快速通过此审批吗？（不填写审批意见）')) return;
  try {
    await ApprovalAPI.approve(instanceId, nodeId, '');
    showToast('已通过审批', 'success');
    loadData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openReject(instanceId, nodeId) {
  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3 style="margin:0; color:#dc2626;">✗ 快速驳回</h3>
          <button class="close-btn" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-label">驳回原因 *</div>
          <textarea class="form-textarea" id="rejectComment" rows="4" placeholder="请填写驳回原因..."></textarea>
          <div style="font-size:11px; color:#94a3b8; margin-top:6px;">💡 快速驳回会退回到流程第一个审批节点</div>
        </div>
        <div class="modal-footer">
          <button class="btn" style="background:#f1f5f9; color:#475569;" onclick="closeModal()">取消</button>
          <button class="btn" style="background:#ef4444; color:#fff;" onclick="doReject(${instanceId}, '${nodeId}')">确认驳回</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
}

async function doReject(instanceId, nodeId) {
  const comment = document.getElementById('rejectComment').value.trim();
  if (!comment) { showToast('请填写驳回原因', 'error'); return; }
  try {
    await ApprovalAPI.reject(instanceId, nodeId, comment, null);
    closeModal();
    showToast('已驳回', 'success');
    loadData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showModal(html) {
  closeModal();
  document.getElementById('modalContainer').innerHTML = html;
}

function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

function subscribeWs() {
  initWebSocket();
  subscribeTodos(currentUserId);
  onWsEvent('todos_status', handleWsTodos);
  onWsEvent('todos_updated', handleWsTodos);
}

function unsubscribeWs() {
  unsubscribeTodos(currentUserId);
}

function handleWsTodos(data) {
  if (data.userId !== currentUserId) return;
  todosCache = data.todos || [];
  renderStats();
  renderList();
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  renderUserSelector();
  subscribeWs();
  loadData();
  updateTitle();
  
  const subTabsContainer = document.getElementById('subTabsContainer');
  if (currentTab === 'todo') {
    subTabsContainer.style.display = '';
  }
});
