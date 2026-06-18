let currentUserId = localStorage.getItem('approval_user_id') || 'user-lisi';
let currentUserName = getUserDisplayName(currentUserId);
let currentTab = 'overview';
let templatesCache = [];
let instancesCache = [];
let delegationRulesCache = [];

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  ['overview', 'templates', 'instances', 'todos', 'delegation'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? '' : 'none';
  });
  renderCurrentTab();
}

function renderCurrentTab() {
  switch (currentTab) {
    case 'overview': renderOverview(); break;
    case 'templates': renderTemplates(); break;
    case 'instances': renderInstances(); break;
    case 'todos': renderTodos(); break;
    case 'delegation': renderDelegation(); break;
  }
}

async function loadAllData() {
  try {
    [templatesCache, instancesCache, delegationRulesCache] = await Promise.all([
      ApprovalAPI.listTemplates(),
      ApprovalAPI.listInstances(),
      ApprovalAPI.getDelegationRules()
    ]);
    renderCurrentTab();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

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
  unsubscribeCurrentUserTodos();
  subscribeTodosWs();
  loadAllData();
  showToast(`已切换到：${currentUserName}`, 'info');
}

function renderOverview() {
  const pendingCount = instancesCache.filter(i => i.status === 'pending').length;
  const completedCount = instancesCache.filter(i => i.status === 'completed').length;
  const templateCount = templatesCache.length;
  const myTodos = instancesCache.reduce((count, inst) => {
    if (inst.status !== 'pending') return count;
    const template = templatesCache.find(t => t.id === inst.template_id);
    if (!template) return count;
    return count;
  }, 0);

  const container = document.getElementById('tab-overview');
  container.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:28px;">
      <div class="stat-card">
        <div class="stat-number" style="color:#3b82f6;">${templateCount}</div>
        <div class="stat-label">📐 审批模板数</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" style="color:#f59e0b;">${pendingCount}</div>
        <div class="stat-label">⏳ 进行中的审批</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" style="color:#10b981;">${completedCount}</div>
        <div class="stat-label">✅ 已完成审批</div>
      </div>
      <div class="stat-card">
        <div class="stat-number" style="color:#8b5cf6;" id="myTodoCount">-</div>
        <div class="stat-label">🎯 我的待办数</div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
      <div>
        <div class="top-banner">
          <h3 style="margin:0; font-size:17px;">热门模板</h3>
          <button class="mini-btn primary" onclick="switchTab('templates')">查看全部 →</button>
        </div>
        <div id="overviewTemplates" class="card-list"></div>
      </div>
      <div>
        <div class="top-banner">
          <h3 style="margin:0; font-size:17px;">最新审批</h3>
          <button class="mini-btn primary" onclick="switchTab('instances')">查看全部 →</button>
        </div>
        <div id="overviewInstances" class="card-list"></div>
      </div>
    </div>
  `;
  loadMyTodoCount();

  const tplContainer = document.getElementById('overviewTemplates');
  if (templatesCache.length === 0) {
    tplContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">📐</div><p>暂无模板，点击右上角新建</p></div>`;
  } else {
    tplContainer.innerHTML = templatesCache.slice(0, 4).map(t => `
      <div class="data-card" style="cursor:pointer;" onclick="location.href='/approval/template-editor/${t.id}'">
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div>
            <div style="font-weight:600; font-size:15px; color:#1e293b;">${t.name}</div>
            <div style="font-size:12px; color:#64748b; margin-top:4px;">${t.description || '暂无描述'}</div>
          </div>
          <div class="tag" style="background:#eff6ff; color:#2563eb;">${t.node_count}个节点</div>
        </div>
        <div style="font-size:11px; color:#94a3b8; margin-top:10px;">${timeAgo(t.updated_at)}更新</div>
      </div>
    `).join('');
  }

  const instContainer = document.getElementById('overviewInstances');
  if (instancesCache.length === 0) {
    instContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">📑</div><p>暂无审批实例</p></div>`;
  } else {
    instContainer.innerHTML = instancesCache.slice(0, 4).map(i => {
      const tpl = templatesCache.find(t => t.id === i.template_id);
      return `
        <div class="data-card" style="cursor:pointer;" onclick="location.href='/approval/document/${i.id}'">
          <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
            <div style="font-weight:600; color:#1e293b;">${i.document_title || `审批#${i.id}`}</div>
            ${getStatusBadge(i.status)}
          </div>
          <div style="font-size:12px; color:#64748b;">模板：${tpl?.name || '未知'}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:11px; color:#94a3b8;">
            <span>发起人：${i.created_by_name || '未知'}</span>
            <span>${timeAgo(i.updated_at)}</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

async function loadMyTodoCount() {
  try {
    const todos = await ApprovalAPI.getTodos();
    const el = document.getElementById('myTodoCount');
    if (el) el.textContent = todos.length;
  } catch (e) {}
}

function renderTemplates() {
  const container = document.getElementById('tab-templates');
  container.innerHTML = `
    <div class="top-banner">
      <h3 style="margin:0; font-size:18px;">审批流程模板管理</h3>
      <button class="btn btn-primary" onclick="showCreateTemplateModal()">+ 新建模板</button>
    </div>
    <div id="templatesList" class="card-list" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); display:grid;"></div>
  `;
  const listEl = document.getElementById('templatesList');
  if (templatesCache.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📐</div><p>暂无模板，点击右上角"新建模板"开始</p></div>`;
    return;
  }
  listEl.innerHTML = templatesCache.map(t => `
    <div class="data-card">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:12px;">
        <div>
          <div style="font-weight:600; font-size:16px; color:#1e293b;">${t.name}</div>
          <div style="font-size:12px; color:#64748b; margin-top:5px;">${t.description || '暂无描述'}</div>
        </div>
        <div class="tag" style="background:#eff6ff; color:#2563eb;">${t.node_count}节点</div>
      </div>
      <div style="height:140px; overflow:hidden; border-radius:8px; background:#f8fafc; border:1px dashed #e2e8f0; margin:10px 0;" id="tplPreview_${t.id}"></div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:11px; color:#94a3b8;">${timeAgo(t.updated_at)}更新</div>
        <div class="action-btns">
          <button class="mini-btn primary" onclick="location.href='/approval/template-editor/${t.id}'">编辑</button>
          <button class="mini-btn" onclick="showStartInstanceModal(${t.id})">发起审批</button>
          <button class="mini-btn danger" onclick="deleteTemplate(${t.id})">删除</button>
        </div>
      </div>
    </div>
  `).join('');

  templatesCache.forEach(async t => {
    try {
      const full = await ApprovalAPI.getTemplate(t.id);
      const previewEl = document.getElementById(`tplPreview_${t.id}`);
      if (previewEl && full && full.nodes && full.nodes.length > 0) {
        new ApprovalSvgRenderer(previewEl, { scale: 0.45, showStatus: false }).render(full);
      }
    } catch (e) {}
  });
}

async function deleteTemplate(id) {
  if (!confirm('确定删除该模板吗？')) return;
  try {
    await ApprovalAPI.deleteTemplate(id);
    showToast('模板已删除', 'success');
    loadAllData();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showCreateTemplateModal() {
  const html = `
    <div class="modal-overlay" id="ctModal" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3 style="margin:0;">新建审批模板</h3>
          <button class="close-btn" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">模板名称 *</label>
            <input class="form-input" id="ctName" placeholder="例如：费用报销审批流程">
          </div>
          <div class="form-group">
            <label class="form-label">模板描述</label>
            <textarea class="form-textarea" id="ctDesc" placeholder="简要描述该审批流程的用途"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">快速创建</label>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="mini-btn" onclick="useTemplatePreset('simple2')">2级普通审批</button>
              <button class="mini-btn" onclick="useTemplatePreset('countersign')">含会签审批</button>
              <button class="mini-btn primary" onclick="useTemplatePreset('condition')">💰 含条件分支（推荐）</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" onclick="submitCreateTemplate()">创建并编辑</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
  window._ctPreset = null;
}

function useTemplatePreset(name) {
  window._ctPreset = name;
  showToast(`已选择模板：${name === 'condition' ? '含条件分支（金额>5000走三级审批）' : name === 'countersign' ? '含会签' : '2级普通审批'}，点击创建按钮生成`, 'success');
}

async function submitCreateTemplate() {
  const name = document.getElementById('ctName').value.trim();
  const desc = document.getElementById('ctDesc').value.trim();
  if (!name) { showToast('请输入模板名称', 'error'); return; }

  let nodes = [], edges = [];
  const preset = window._ctPreset;
  const sId = generateNodeId();
  const eId = generateNodeId();
  nodes.push({ id: sId, type: 'start', name: '开始' });
  nodes.push({ id: eId, type: 'end', name: '结束' });

  if (preset === 'condition') {
    const n1 = generateNodeId();
    const cond = generateNodeId();
    const n2a = generateNodeId();
    const n2b = generateNodeId();
    const n3b = generateNodeId();
    nodes.push(
      { id: n1, type: 'approval', name: '部门主管审批', approvers: ['user-manager'] },
      { id: cond, type: 'condition', name: '金额判断', branches: [
        { condition: 'amount > 5000', label: '金额>5000', target_node_id: n2b },
        { condition: '', label: '默认', target_node_id: n2a }
      ]},
      { id: n2a, type: 'approval', name: '财务审批', approvers: ['user-zhangsan'] },
      { id: n2b, type: 'approval', name: '财务复审', approvers: ['user-lisi'] },
      { id: n3b, type: 'countersign', name: '总监+CEO会签', approvers: ['user-director', 'user-ceo'] }
    );
    edges.push(
      { from: sId, to: n1 },
      { from: n1, to: cond },
      { from: n2a, to: eId },
      { from: n2b, to: n3b },
      { from: n3b, to: eId }
    );
  } else if (preset === 'countersign') {
    const n1 = generateNodeId();
    const n2 = generateNodeId();
    nodes.push(
      { id: n1, type: 'approval', name: '部门主管审批', approvers: ['user-manager'] },
      { id: n2, type: 'countersign', name: '高管会签', approvers: ['user-director', 'user-ceo', 'user-admin'] }
    );
    edges.push({ from: sId, to: n1 }, { from: n1, to: n2 }, { from: n2, to: eId });
  } else {
    const n1 = generateNodeId();
    const n2 = generateNodeId();
    nodes.push(
      { id: n1, type: 'approval', name: '部门主管审批', approvers: ['user-manager'] },
      { id: n2, type: 'approval', name: '总经理审批', approvers: ['user-director'] }
    );
    edges.push({ from: sId, to: n1 }, { from: n1, to: n2 }, { from: n2, to: eId });
  }

  try {
    const result = await ApprovalAPI.createTemplate({
      name, description: desc, nodes, edges
    });
    closeModal();
    showToast('模板创建成功', 'success');
    setTimeout(() => location.href = `/approval/template-editor/${result.id}`, 500);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showStartInstanceModal(templateId) {
  const tpl = templatesCache.find(t => t.id === templateId);
  if (!tpl) return;
  const html = `
    <div class="modal-overlay" id="ctModal" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3 style="margin:0;">发起审批 - ${tpl.name}</h3>
          <button class="close-btn" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">文档标题 *</label>
            <input class="form-input" id="siTitle" placeholder="请输入文档/审批标题">
          </div>
          <div class="form-group">
            <label class="form-label">文档元数据（用于条件判断）</label>
            <div style="font-size:12px; color:#64748b; margin-bottom:8px;">例如：amount=3000（金额）、department=IT（部门）、type=purchase（类型）</div>
            <div id="metaFields">
              <div class="meta-field">
                <input class="form-input" placeholder="字段名" value="amount">
                <input class="form-input" placeholder="值" value="3000" data-type="number">
              </div>
              <div class="meta-field">
                <input class="form-input" placeholder="字段名" value="department">
                <input class="form-input" placeholder="值" value="研发部">
              </div>
            </div>
            <button class="mini-btn" style="margin-top:6px;" onclick="addMetaField()">+ 添加字段</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" onclick="submitStartInstance(${templateId})">创建并启动</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
}

function addMetaField() {
  const container = document.getElementById('metaFields');
  const div = document.createElement('div');
  div.className = 'meta-field';
  div.innerHTML = `
    <input class="form-input" placeholder="字段名">
    <input class="form-input" placeholder="值">
    <button class="mini-btn danger" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(div);
}

async function submitStartInstance(templateId) {
  const title = document.getElementById('siTitle').value.trim();
  if (!title) { showToast('请输入文档标题', 'error'); return; }

  const metadata = {};
  document.querySelectorAll('#metaFields .meta-field').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const key = inputs[0].value.trim();
    let value = inputs[1].value;
    if (!key) return;
    if (inputs[1].dataset.type === 'number' || !isNaN(Number(value)) && value !== '') {
      const num = Number(value);
      if (!isNaN(num)) value = num;
    }
    metadata[key] = value;
  });

  try {
    const created = await ApprovalAPI.createInstance({
      template_id: templateId,
      document_title: title,
      metadata
    });
    const started = await ApprovalAPI.startInstance(created.id);
    closeModal();
    showToast('审批已启动', 'success');
    loadAllData();
    setTimeout(() => location.href = `/approval/document/${started.id}`, 600);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderInstances() {
  const container = document.getElementById('tab-instances');
  const pending = instancesCache.filter(i => i.status === 'pending');
  const completed = instancesCache.filter(i => i.status === 'completed');
  container.innerHTML = `
    <div class="top-banner">
      <h3 style="margin:0; font-size:18px;">审批实例列表</h3>
      <div style="display:flex; gap:8px;">
        <select class="form-select" style="width:auto;" id="instFilter" onchange="renderInstancesList()">
          <option value="all">全部状态</option>
          <option value="pending">审批中</option>
          <option value="completed">已完成</option>
          <option value="draft">草稿</option>
        </select>
      </div>
    </div>
    <div id="instancesList" class="card-list"></div>
  `;
  renderInstancesList();
}

function renderInstancesList() {
  const filter = document.getElementById('instFilter')?.value || 'all';
  let list = instancesCache;
  if (filter !== 'all') list = list.filter(i => i.status === filter);
  const el = document.getElementById('instancesList');
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📑</div><p>暂无审批实例</p></div>`;
    return;
  }
  el.innerHTML = list.map(i => {
    const tpl = templatesCache.find(t => t.id === i.template_id);
    const metaStr = Object.entries(i.metadata || {}).map(([k, v]) => `${k}:${v}`).join(' · ');
    return `
      <div class="data-card" style="cursor:pointer;" onclick="location.href='/approval/document/${i.id}'">
        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
          <div>
            <div style="font-weight:600; font-size:15px; color:#1e293b; margin-bottom:4px;">${i.document_title || `审批 #${i.id}`}</div>
            <div style="font-size:12px; color:#64748b;">模板：${tpl?.name || '未知'}</div>
          </div>
          ${getStatusBadge(i.status)}
        </div>
        ${metaStr ? `<div style="font-size:11px; color:#8b5cf6; background:#f5f3ff; padding:4px 8px; border-radius:4px; margin-bottom:8px; display:inline-block;">🗂 ${metaStr}</div>` : ''}
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8;">
          <span>发起人：${i.created_by_name || '未知'}</span>
          <span>${timeAgo(i.updated_at)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function getDelegationModeLabel(mode) {
  return mode === 'time_range' ? '时间段' : mode === 'timeout' ? '超时自动' : mode;
}

function getDelegationModeColor(mode) {
  return mode === 'time_range' ? 'background:#dbeafe;color:#1d4ed8;' : 'background:#fef3c7;color:#92400e;';
}

function formatDateTime(str) {
  if (!str) return '-';
  return new Date(str).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function renderDelegation() {
  const rules = delegationRulesCache || [];
  const myRules = rules;
  const users = getDemoUsers().filter(u => u.id !== currentUserId);
  
  const container = document.getElementById('tab-delegation');
  container.innerHTML = `
    <div style="margin-bottom:20px;">
      <div class="top-banner">
        <div>
          <h2 style="margin:0 0 6px; font-size:20px; color:#1e293b;">🔄 审批委托</h2>
          <p style="margin:0; font-size:13px; color:#64748b;">设置委托规则，将您的审批权临时交给他人代签</p>
        </div>
        <button class="btn primary" onclick="openCreateDelegationModal()">+ 新建委托规则</button>
      </div>
      
      <div class="demo-tip" style="margin-bottom:20px;">
        ℹ️ <strong>说明：</strong> 时间段模式：在指定时间内新到待办自动转给代理人。超时模式：待办超过 N 小时未处理自动转给代理人。委托不能形成环。
      </div>
    </div>
    
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
      <div>
        <h3 style="margin:0 0 14px; font-size:16px; color:#1e293b;">📤 我发起的委托</h3>
        ${myRules.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <div>暂无委托规则</div>
          </div>
        ` : `
          <div class="card-list">
            ${myRules.map(rule => `
              <div class="data-card" style="${!rule.enabled ? 'opacity:0.6;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                  <div style="flex:1;">
                    <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
                      <span class="tag" style="${getDelegationModeColor(rule.mode)}">${getDelegationModeLabel(rule.mode)}</span>
                      <span style="font-size:13px; color:#64748b;">
                        ${rule.mode === 'time_range' 
                          ? `${formatDateTime(rule.start_time)} 至 ${formatDateTime(rule.end_time)}`
                          : `超时 ${rule.timeout_hours} 小时`}
                      </span>
                      <label class="switch" style="margin-left:auto;">
                        <input type="checkbox" ${rule.enabled ? 'checked' : ''} 
                          onchange="toggleDelegationRule(${rule.id}, this.checked)">
                        <span class="slider"></span>
                      </label>
                    </div>
                    <div style="font-size:14px; color:#334155; margin-bottom:4px;">
                      委托给：<strong style="color:#1e293b;">${getUserDisplayName(rule.agent_id)}</strong>
                    </div>
                    ${rule.remark ? `<div style="font-size:12px; color:#94a3b8;">${rule.remark}</div>` : ''}
                    ${rule.is_effective 
                      ? `<div style="font-size:12px; color:#059669; margin-top:6px;">✅ 当前生效中</div>` 
                      : rule.enabled 
                        ? `<div style="font-size:12px; color:#f59e0b; margin-top:6px;">⏰ 未到生效时间</div>`
                        : `<div style="font-size:12px; color:#94a3b8; margin-top:6px;">🔘 已停用</div>`}
                  </div>
                  <div class="action-btns" style="margin-left:10px;">
                    <button class="mini-btn" onclick="openEditDelegationModal(${rule.id})">编辑</button>
                    <button class="mini-btn danger" onclick="deleteDelegationRule(${rule.id})">删除</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
      
      <div>
        <h3 style="margin:0 0 14px; font-size:16px; color:#1e293b;">📥 我作为代理人</h3>
        <div id="asAgentRulesContainer">
          <div class="empty-state">
            <div class="empty-icon">⏳</div>
            <div>加载中...</div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  loadAsAgentRules();
}

async function loadAsAgentRules() {
  try {
    const rules = await ApprovalAPI.getDelegationRulesAsAgent();
    const container = document.getElementById('asAgentRulesContainer');
    if (!container) return;
    
    if (rules.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤝</div>
          <div>暂无他人委托给您的规则</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="card-list">
        ${rules.map(rule => `
          <div class="data-card" style="${!rule.enabled || !rule.is_effective ? 'opacity:0.6;' : ''}">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
              <span class="tag" style="${getDelegationModeColor(rule.mode)}">${getDelegationModeLabel(rule.mode)}</span>
              ${rule.enabled && rule.is_effective 
                ? '<span class="tag" style="background:#dcfce7;color:#166534;">生效中</span>' 
                : '<span class="tag" style="background:#f1f5f9;color:#64748b;">未生效</span>'}
            </div>
            <div style="font-size:14px; color:#334155; margin-bottom:4px;">
              委托人：<strong style="color:#1e293b;">${getUserDisplayName(rule.delegator_id)}</strong>
            </div>
            <div style="font-size:12px; color:#64748b;">
              ${rule.mode === 'time_range' 
                ? `${formatDateTime(rule.start_time)} 至 ${formatDateTime(rule.end_time)}`
                : `待办超时 ${rule.timeout_hours} 小时后自动转给您`}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    console.error('加载作为代理人的规则失败:', e);
  }
}

function openCreateDelegationModal() {
  const users = getDemoUsers().filter(u => u.id !== currentUserId);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const html = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 style="margin:0; font-size:18px;">新建委托规则</h3>
          <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">代理人 *</label>
            <select class="form-select" id="delegationAgentId">
              <option value="">请选择代理人</option>
              ${users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">生效模式 *</label>
            <div style="display:flex; gap:12px;">
              <label style="flex:1; padding:12px; border:2px solid #e2e8f0; border-radius:8px; cursor:pointer; transition:all 0.2s;">
                <input type="radio" name="delegationMode" value="time_range" checked onchange="toggleDelegationModeFields()">
                <span style="margin-left:8px; font-weight:500;">⏰ 时间段</span>
                <div style="font-size:12px; color:#64748b; margin-top:4px;">在指定时间内，新到待办自动转给代理人</div>
              </label>
              <label style="flex:1; padding:12px; border:2px solid #e2e8f0; border-radius:8px; cursor:pointer; transition:all 0.2s;">
                <input type="radio" name="delegationMode" value="timeout" onchange="toggleDelegationModeFields()">
                <span style="margin-left:8px; font-weight:500;">⌛ 超时自动</span>
                <div style="font-size:12px; color:#64748b; margin-top:4px;">待办超过 N 小时未处理，自动转给代理人</div>
              </label>
            </div>
          </div>
          
          <div id="timeRangeFields">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="form-group">
                <label class="form-label">开始时间 *</label>
                <input type="datetime-local" class="form-input" id="delegationStartTime" 
                  value="${now.toISOString().slice(0, 16)}">
              </div>
              <div class="form-group">
                <label class="form-label">结束时间 *</label>
                <input type="datetime-local" class="form-input" id="delegationEndTime" 
                  value="${nextWeek.toISOString().slice(0, 16)}">
              </div>
            </div>
          </div>
          
          <div id="timeoutFields" style="display:none;">
            <div class="form-group">
              <label class="form-label">超时时间（小时）*</label>
              <input type="number" class="form-input" id="delegationTimeoutHours" 
                value="24" min="1" max="720" placeholder="请输入超时小时数">
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">备注（可选）</label>
            <textarea class="form-textarea" id="delegationRemark" placeholder="比如：请假一周，请帮忙处理审批"></textarea>
          </div>
          
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="delegationEnabled" checked>
              <span style="font-size:13px;">立即启用</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal()">取消</button>
          <button class="btn primary" onclick="submitDelegationRule()">创建</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
}

function openEditDelegationModal(ruleId) {
  const rule = delegationRulesCache.find(r => r.id === ruleId);
  if (!rule) return;
  
  const users = getDemoUsers().filter(u => u.id !== currentUserId);
  
  const html = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 style="margin:0; font-size:18px;">编辑委托规则</h3>
          <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">代理人 *</label>
            <select class="form-select" id="delegationAgentId">
              <option value="">请选择代理人</option>
              ${users.map(u => `<option value="${u.id}" ${u.id === rule.agent_id ? 'selected' : ''}>${u.name}</option>`).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">生效模式 *</label>
            <div style="display:flex; gap:12px;">
              <label style="flex:1; padding:12px; border:2px solid #e2e8f0; border-radius:8px; cursor:pointer; transition:all 0.2s;">
                <input type="radio" name="delegationMode" value="time_range" 
                  ${rule.mode === 'time_range' ? 'checked' : ''} onchange="toggleDelegationModeFields()">
                <span style="margin-left:8px; font-weight:500;">⏰ 时间段</span>
                <div style="font-size:12px; color:#64748b; margin-top:4px;">在指定时间内，新到待办自动转给代理人</div>
              </label>
              <label style="flex:1; padding:12px; border:2px solid #e2e8f0; border-radius:8px; cursor:pointer; transition:all 0.2s;">
                <input type="radio" name="delegationMode" value="timeout" 
                  ${rule.mode === 'timeout' ? 'checked' : ''} onchange="toggleDelegationModeFields()">
                <span style="margin-left:8px; font-weight:500;">⌛ 超时自动</span>
                <div style="font-size:12px; color:#64748b; margin-top:4px;">待办超过 N 小时未处理，自动转给代理人</div>
              </label>
            </div>
          </div>
          
          <div id="timeRangeFields" style="${rule.mode !== 'time_range' ? 'display:none;' : ''}">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="form-group">
                <label class="form-label">开始时间 *</label>
                <input type="datetime-local" class="form-input" id="delegationStartTime" 
                  value="${rule.start_time ? new Date(rule.start_time).toISOString().slice(0, 16) : ''}">
              </div>
              <div class="form-group">
                <label class="form-label">结束时间 *</label>
                <input type="datetime-local" class="form-input" id="delegationEndTime" 
                  value="${rule.end_time ? new Date(rule.end_time).toISOString().slice(0, 16) : ''}">
              </div>
            </div>
          </div>
          
          <div id="timeoutFields" style="${rule.mode !== 'timeout' ? 'display:none;' : ''}">
            <div class="form-group">
              <label class="form-label">超时时间（小时）*</label>
              <input type="number" class="form-input" id="delegationTimeoutHours" 
                value="${rule.timeout_hours || 24}" min="1" max="720" placeholder="请输入超时小时数">
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">备注（可选）</label>
            <textarea class="form-textarea" id="delegationRemark" placeholder="比如：请假一周，请帮忙处理审批">${rule.remark || ''}</textarea>
          </div>
          
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="delegationEnabled" ${rule.enabled ? 'checked' : ''}>
              <span style="font-size:13px;">启用规则</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="closeModal()">取消</button>
          <button class="btn primary" onclick="submitDelegationRule(${ruleId})">保存</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
}

function toggleDelegationModeFields() {
  const mode = document.querySelector('input[name="delegationMode"]:checked').value;
  document.getElementById('timeRangeFields').style.display = mode === 'time_range' ? '' : 'none';
  document.getElementById('timeoutFields').style.display = mode === 'timeout' ? '' : 'none';
}

async function submitDelegationRule(editId = null) {
  try {
    const agentId = document.getElementById('delegationAgentId').value;
    const mode = document.querySelector('input[name="delegationMode"]:checked').value;
    const enabled = document.getElementById('delegationEnabled').checked;
    const remark = document.getElementById('delegationRemark').value.trim();
    
    if (!agentId) {
      showToast('请选择代理人', 'error');
      return;
    }
    
    const ruleData = {
      agent_id: agentId,
      agent_name: getUserDisplayName(agentId),
      mode,
      enabled,
      remark
    };
    
    if (mode === 'time_range') {
      const startTime = document.getElementById('delegationStartTime').value;
      const endTime = document.getElementById('delegationEndTime').value;
      if (!startTime || !endTime) {
        showToast('请填写完整的时间范围', 'error');
        return;
      }
      if (new Date(startTime) >= new Date(endTime)) {
        showToast('结束时间必须晚于开始时间', 'error');
        return;
      }
      ruleData.start_time = startTime;
      ruleData.end_time = endTime;
    } else {
      const timeoutHours = parseInt(document.getElementById('delegationTimeoutHours').value);
      if (!timeoutHours || timeoutHours < 1) {
        showToast('请填写有效的超时小时数', 'error');
        return;
      }
      ruleData.timeout_hours = timeoutHours;
    }
    
    if (editId) {
      await ApprovalAPI.updateDelegationRule(editId, ruleData);
      showToast('规则已更新', 'success');
    } else {
      await ApprovalAPI.createDelegationRule(ruleData);
      showToast('规则已创建', 'success');
    }
    
    closeModal();
    loadAllData();
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function toggleDelegationRule(ruleId, enabled) {
  try {
    await ApprovalAPI.toggleDelegationRule(ruleId, enabled);
    showToast(enabled ? '规则已启用' : '规则已停用', 'success');
    loadAllData();
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
    loadAllData();
  }
}

async function deleteDelegationRule(ruleId) {
  if (!confirm('确定要删除这条委托规则吗？')) return;
  
  try {
    await ApprovalAPI.deleteDelegationRule(ruleId);
    showToast('规则已删除', 'success');
    loadAllData();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

function renderTodos() {
  location.href = '/approval/my-todos';
}

function showModal(html) {
  closeModal();
  const container = document.getElementById('modalContainer');
  container.innerHTML = html;
}

function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

function subscribeTodosWs() {
  initWebSocket();
  subscribeTodos(currentUserId);
  onWsEvent('todos_status', handleTodoUpdate);
  onWsEvent('todos_updated', handleTodoUpdate);
}

function handleTodoUpdate(data) {
  if (currentTab === 'overview') {
    const el = document.getElementById('myTodoCount');
    if (el) el.textContent = data.todos?.length || 0;
  }
}

function unsubscribeCurrentUserTodos() {
  unsubscribeTodos(currentUserId);
}

document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

document.addEventListener('DOMContentLoaded', () => {
  renderUserSelector();
  subscribeTodosWs();
  loadAllData();
});
