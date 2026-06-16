let currentInstanceId = null;
let currentInstance = null;
let currentUserId = localStorage.getItem('approval_user_id') || 'user-lisi';
let currentUserName = getUserDisplayName(currentUserId);
let renderer = null;
let precedingNodesCache = null;

const pathMatch = location.pathname.match(/\/approval\/document\/(\d+)/);
if (pathMatch) currentInstanceId = parseInt(pathMatch[1]);

function renderUserSelector() {
  const users = getDemoUsers();
  const container = document.getElementById('currentUserPills');
  container.innerHTML = '';
  users.slice(0, 4).forEach(u => {
    const pill = document.createElement('span');
    pill.className = `user-pill${u.id === currentUserId ? ' active' : ''}`;
    pill.textContent = u.name;
    pill.style.cssText = u.id === currentUserId
      ? 'padding:5px 12px;background:rgba(255,255,255,0.25);color:#fff;border-radius:16px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid rgba(255,255,255,0.3);'
      : 'padding:5px 12px;background:rgba(255,255,255,0.12);color:#fff;border-radius:16px;font-size:12px;font-weight:500;cursor:pointer;';
    pill.onclick = () => switchUser(u.id);
    container.appendChild(pill);
  });
}

function switchUser(userId) {
  currentUserId = userId;
  currentUserName = getUserDisplayName(userId);
  localStorage.setItem('approval_user_id', userId);
  renderUserSelector();
  unsubscribeApprovalWs();
  loadInstance();
  subscribeApprovalWs();
  showToast(`已切换到：${currentUserName}`, 'info');
}

async function loadInstance() {
  try {
    const inst = await ApprovalAPI.getInstance(currentInstanceId);
    currentInstance = inst;
    renderAll();
  } catch (e) {
    showToast('加载失败: ' + e.message, 'error');
    document.getElementById('docTitle').textContent = '加载失败';
  }
}

function renderAll() {
  if (!currentInstance) return;

  document.getElementById('docTitle').textContent = currentInstance.document_title || `审批 #${currentInstance.id}`;
  document.getElementById('panelDocTitle').textContent = currentInstance.document_title || `审批 #${currentInstance.id}`;
  document.getElementById('statusBadge').innerHTML = getStatusBadge(currentInstance.status);
  document.getElementById('tplName').textContent = currentInstance.template?.name || '未知模板';
  document.getElementById('creatorName').textContent = currentInstance.created_by_name || '未知';
  document.getElementById('createTime').textContent = formatDate(currentInstance.created_at);
  document.getElementById('updateTime').textContent = timeAgo(currentInstance.updated_at);

  renderMetadata();
  renderFlowChart();
  renderActionPanel();
  renderTimeline();
}

function renderMetadata() {
  const grid = document.getElementById('metadataGrid');
  const md = currentInstance.metadata || {};
  const entries = Object.entries(md);
  if (entries.length === 0) {
    grid.innerHTML = '<div style="font-size:12px; color:#94a3b8; grid-column:1/-1;">暂无元数据</div>';
    return;
  }
  grid.innerHTML = entries.map(([k, v]) => `
    <div class="metadata-item">
      <div class="metadata-key">${escapeHtml(k)}</div>
      <div class="metadata-value">${escapeHtml(String(v))}</div>
    </div>
  `).join('');
}

function renderFlowChart() {
  const container = document.getElementById('flowChart');
  const tpl = currentInstance.template;
  if (!tpl || !tpl.nodes || tpl.nodes.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无流程图</div>';
    return;
  }
  renderer = new ApprovalSvgRenderer(container, { showStatus: true });
  renderer.render(tpl, currentInstance);
}

function renderActionPanel() {
  const body = document.getElementById('actionPanelBody');
  const tpl = currentInstance.template;
  const currentNodeIds = currentInstance.current_node_ids || [];
  const userId = currentUserId;

  if (currentInstance.status === 'draft') {
    body.innerHTML = `
      <div class="current-node-card" style="background:linear-gradient(135deg,#fef3c7,#fde68a); border-color:#fcd34d;">
        <div class="title" style="color:#92400e;">⚙ 草稿状态</div>
        <div class="name" style="color:#78350f;">尚未启动审批流程</div>
      </div>
      <div class="action-row">
        <button class="action-btn approve" onclick="startApproval()">🚀 启动审批流程</button>
      </div>
    `;
    return;
  }

  if (currentInstance.status === 'completed') {
    body.innerHTML = `
      <div class="current-node-card" style="background:linear-gradient(135deg,#dcfce7,#bbf7d0); border-color:#86efac;">
        <div class="title" style="color:#166534;">✅ 审批完成</div>
        <div class="name" style="color:#14532d;">流程已全部通过</div>
      </div>
    `;
    return;
  }

  if (currentNodeIds.length === 0) {
    body.innerHTML = '<div class="empty-state">当前无待处理节点</div>';
    return;
  }

  const myTodoNodes = [];
  for (const nid of currentNodeIds) {
    const node = tpl.nodes.find(n => n.id === nid);
    if (!node) continue;
    if ((node.type === 'approval' || node.type === 'countersign') && (node.approvers || []).includes(userId)) {
      const records = currentInstance.records || [];
      const hasDone = records.some(r =>
        r.node_id === nid && r.user_id === userId &&
        (r.action === 'approve' || r.action === 'reject')
      );
      if (!hasDone) {
        myTodoNodes.push({ node, records });
      }
    }
  }

  let html = '';

  for (const nid of currentNodeIds) {
    const node = tpl.nodes.find(n => n.id === nid);
    if (!node) continue;
    const isMyTodo = myTodoNodes.some(t => t.node.id === nid);
    const records = currentInstance.records || [];
    const myRecord = records.find(r => r.node_id === nid && r.user_id === userId);

    html += `
      <div class="current-node-card" style="${isMyTodo ? '' : 'opacity:0.7; background:#f8fafc; border-color:#cbd5e1;'}">
        <div class="title">
          ${isMyTodo ? '🎯 您需要处理' : '📍 当前处理节点'}
          ${node.type === 'countersign' ? ' · 会签' : ''}
        </div>
        <div class="name">${escapeHtml(node.name || getNodeTypeLabel(node.type))}</div>
        <div class="approvers">
          审批人: ${(node.approvers || []).map(aid => {
            const done = records.some(r => r.node_id === nid && r.user_id === aid && (r.action === 'approve' || r.action === 'reject'));
            const isMe = aid === userId;
            const name = getUserDisplayName(aid);
            return `<span style="padding:1px 6px; border-radius:4px; margin:0 2px; background:${done ? '#dcfce7; color:#166534;' : (isMe && isMyTodo ? '#fef3c7; color:#92400e;' : '#f1f5f9; color:#475569;')} font-weight:${isMe ? 600 : 500};">${done ? '✓ ' : ''}${escapeHtml(name)}</span>`;
          }).join('')}
        </div>
        ${renderCountersignProgress(node, nid)}
        ${myRecord ? `<div style="margin-top:8px; padding:6px 10px; background:#fff; border-radius:6px; font-size:12px; color:#64748b;">您已: <strong style="color:${myRecord.action === 'approve' ? '#16a34a' : '#dc2626'};">${myRecord.action === 'approve' ? '通过' : '驳回'}</strong>${myRecord.comment ? ` - ${escapeHtml(myRecord.comment)}` : ''}</div>` : ''}
      </div>
    `;
  }

  if (myTodoNodes.length > 0) {
    const todoNode = myTodoNodes[0].node;
    html += `
      <div style="margin-bottom:12px;">
        <label class="form-label">审批意见 / 备注</label>
        <textarea class="form-textarea" id="commentInput" rows="3" placeholder="请输入审批意见（可选）..."></textarea>
      </div>
      <div class="action-row" style="margin-bottom:10px;">
        <button class="action-btn approve" onclick="doApprove('${todoNode.id}')">✓ 通过</button>
        <button class="action-btn reject" onclick="showRejectModal('${todoNode.id}')">✗ 驳回</button>
      </div>
      <div class="action-row">
        <button class="action-btn transfer" onclick="showTransferModal('${todoNode.id}')">↪ 转交他人审批</button>
      </div>
    `;
  } else {
    html += `<div style="padding:14px; background:#f8fafc; border-radius:8px; text-align:center; font-size:13px; color:#64748b;">👆 当前无需要您处理的节点</div>`;
  }

  body.innerHTML = html;
}

function renderCountersignProgress(node, nodeId) {
  if (node.type !== 'countersign') return '';
  const approvers = node.approvers || [];
  const records = currentInstance.records || [];
  const approvedCount = approvers.filter(aid =>
    records.some(r => r.node_id === nodeId && r.user_id === aid && r.action === 'approve')
  ).length;
  const percent = approvers.length > 0 ? Math.round(approvedCount / approvers.length * 100) : 0;
  return `
    <div class="countersign-progress">
      <div class="cs-bar"><div class="cs-bar-fill" style="width:${percent}%;"></div></div>
      <div class="cs-count">会签进度：${approvedCount} / ${approvers.length} 人已通过 (${percent}%)</div>
    </div>
  `;
}

async function startApproval() {
  if (!confirm('确定启动审批流程吗？')) return;
  try {
    const result = await ApprovalAPI.startInstance(currentInstanceId);
    currentInstance = result;
    renderAll();
    showToast('审批流程已启动！', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function doApprove(nodeId) {
  const comment = document.getElementById('commentInput')?.value || '';
  try {
    const result = await ApprovalAPI.approve(currentInstanceId, nodeId, comment);
    currentInstance = result;
    renderAll();
    showToast('审批通过成功！', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadPrecedingNodes(nodeId) {
  if (precedingNodesCache && precedingNodesCache.nodeId === nodeId) return precedingNodesCache;
  try {
    const result = await ApprovalAPI.getPrecedingNodes(currentInstance.template_id, nodeId);
    precedingNodesCache = { nodeId, data: result };
    return precedingNodesCache;
  } catch (e) {
    return { all_options: [] };
  }
}

async function showRejectModal(nodeId) {
  const pres = await loadPrecedingNodes(nodeId);
  const options = pres.all_options || [];
  const comment = document.getElementById('commentInput')?.value || '';
  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3 style="margin:0; color:#dc2626;">✗ 驳回审批</h3>
          <button class="close-btn" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-label">驳回到节点</div>
          <select class="form-select" id="rejectTarget">
            ${options.length === 0 ? '<option value="">(无前置节点)</option>' : options.map((n, i) => `
              <option value="${n.id}">${getNodeTypeLabel(n.type)} - ${escapeHtml(n.name || n.id)}${i === 0 ? '（起点）' : ''}</option>
            `).join('')}
          </select>
          <div class="form-label">驳回原因 *</div>
          <textarea class="form-textarea" id="rejectComment" rows="4" placeholder="请详细说明驳回原因...">${escapeAttr(comment)}</textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
          <button class="btn btn-danger" onclick="doReject('${nodeId}')">确认驳回</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
}

async function doReject(nodeId) {
  const target = document.getElementById('rejectTarget').value;
  const comment = document.getElementById('rejectComment').value.trim();
  if (!comment) { showToast('请填写驳回原因', 'error'); return; }
  try {
    const result = await ApprovalAPI.reject(currentInstanceId, nodeId, comment, target || null);
    currentInstance = result;
    closeModal();
    renderAll();
    showToast('已驳回', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showTransferModal(nodeId) {
  const users = getDemoUsers();
  const html = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3 style="margin:0; color:#d97706;">↪ 转交审批</h3>
          <button class="close-btn" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-label">选择要转交给的用户 *</div>
          <div class="user-pill-list" id="transferUsers">
            ${users.slice(0, 12).map(u => `
              <span class="user-pill" data-id="${u.id}" onclick="selectTransferUser('${u.id}', this)">${escapeHtml(u.name)}</span>
            `).join('')}
          </div>
          <div class="form-label">转交说明</div>
          <textarea class="form-textarea" id="transferComment" rows="3" placeholder="说明转交原因（可选）..."></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" onclick="doTransfer('${nodeId}')">确认转交</button>
        </div>
      </div>
    </div>
  `;
  showModal(html);
  window._selectedTransferUser = null;
}

function selectTransferUser(userId, el) {
  window._selectedTransferUser = userId;
  document.querySelectorAll('#transferUsers .user-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
}

async function doTransfer(nodeId) {
  const toUserId = window._selectedTransferUser;
  if (!toUserId) { showToast('请选择要转交给的用户', 'error'); return; }
  const comment = document.getElementById('transferComment').value.trim();
  try {
    const result = await ApprovalAPI.transfer(
      currentInstanceId, nodeId,
      toUserId, getUserDisplayName(toUserId),
      comment
    );
    currentInstance = result;
    closeModal();
    renderAll();
    showToast(`已转交给 ${getUserDisplayName(toUserId)}`, 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderTimeline() {
  const wrap = document.getElementById('timelineWrap');
  const records = currentInstance.records || [];
  if (records.length === 0) {
    wrap.innerHTML = '<div class="empty-state">暂无审批记录</div>';
    return;
  }
  const tpl = currentInstance.template;
  const actionMap = {
    start: { label: '启动流程', cls: 'start', cls2: 'action-start' },
    advance: { label: '流转', cls: 'system', cls2: 'action-system' },
    approve: { label: '通过', cls: 'approve', cls2: 'action-approve' },
    reject: { label: '驳回', cls: 'reject', cls2: 'action-reject' },
    transfer: { label: '转交', cls: 'transfer', cls2: 'action-transfer' },
    auto_pass: { label: '系统处理', cls: 'system', cls2: 'action-system' }
  };

  wrap.innerHTML = `<div class="timeline">${records.map(r => {
    const am = actionMap[r.action] || { label: r.action, cls: '', cls2: '' };
    const node = tpl?.nodes?.find(n => n.id === r.node_id);
    const nodeName = node ? (node.name || getNodeTypeLabel(node.type)) : '';

    let content = `<strong>${escapeHtml(r.user_name || '系统')}</strong>`;
    if (r.action === 'start') content += ` 启动了审批流程`;
    else if (r.action === 'advance') content += ` ${escapeHtml(r.comment || '')}`;
    else if (r.action === 'approve') content += ` 审批通过` + (nodeName ? `「${escapeHtml(nodeName)}」` : '');
    else if (r.action === 'reject') {
      content += ` 驳回` + (nodeName ? `「${escapeHtml(nodeName)}」` : '');
      if (r.reject_target_node_id) {
        const tgt = tpl?.nodes?.find(n => n.id === r.reject_target_node_id);
        const tgtName = tgt ? (tgt.name || getNodeTypeLabel(tgt.type)) : r.reject_target_node_id;
        content += ` → 驳回到「${escapeHtml(tgtName)}」`;
      }
    }
    else if (r.action === 'transfer') content += ` 将审批转交给 <strong>${escapeHtml(r.to_user_name || r.to_user_id || '')}</strong>`;
    else if (r.action === 'auto_pass') content += ` ${escapeHtml(r.comment || '')}`;

    return `
      <div class="timeline-item ${am.cls}">
        <div class="timeline-head">
          <div>
            <span class="timeline-action ${am.cls2}">${am.label}</span>
            <span class="timeline-user" style="margin-left:8px;">${content}</span>
          </div>
          <span>${timeAgo(r.created_at)}</span>
        </div>
        ${r.comment && r.action !== 'advance' && r.action !== 'auto_pass' && r.action !== 'start' ? `<div class="timeline-comment">💬 ${escapeHtml(r.comment)}</div>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function showModal(html) {
  closeModal();
  document.getElementById('modalContainer').innerHTML = html;
}

function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

function subscribeApprovalWs() {
  initWebSocket();
  subscribeApproval(currentInstanceId);
  onWsEvent('approval_status', handleWsUpdate);
  onWsEvent('approval_updated', handleWsUpdate);
  onWsEvent('approval_started', handleWsUpdate);
  onWsEvent('approval_approved', handleWsUpdate);
  onWsEvent('approval_rejected', handleWsUpdate);
  onWsEvent('approval_transferred', handleWsUpdate);
}

function unsubscribeApprovalWs() {
  unsubscribeApproval(currentInstanceId);
}

function handleWsUpdate(data) {
  if (data.instance && data.instance.id === currentInstanceId) {
    currentInstance = data.instance;
    renderAll();
    showToast('审批状态已更新', 'info');
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

document.addEventListener('DOMContentLoaded', () => {
  renderUserSelector();
  loadInstance();
  subscribeApprovalWs();
});
