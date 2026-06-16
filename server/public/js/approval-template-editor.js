let templateId = null;
let currentTemplate = {
  name: '',
  description: '',
  nodes: [],
  edges: []
};
let selectedNodeId = null;
let renderer = null;

const urlParams = new URLSearchParams(location.search);
const pathMatch = location.pathname.match(/\/approval\/template-editor\/(\d+)/);
if (pathMatch) templateId = parseInt(pathMatch[1]);

async function init() {
  if (templateId) {
    try {
      const tpl = await ApprovalAPI.getTemplate(templateId);
      currentTemplate = {
        name: tpl.name,
        description: tpl.description || '',
        nodes: JSON.parse(JSON.stringify(tpl.nodes || [])),
        edges: JSON.parse(JSON.stringify(tpl.edges || []))
      };
      document.getElementById('tplName').value = tpl.name;
      document.getElementById('tplDesc').value = tpl.description || '';
    } catch (e) {
      showToast('模板加载失败: ' + e.message, 'error');
    }
  }

  if (currentTemplate.nodes.length === 0) {
    const sId = generateNodeId();
    const eId = generateNodeId();
    currentTemplate.nodes.push({ id: sId, type: 'start', name: '开始' });
    currentTemplate.nodes.push({ id: eId, type: 'end', name: '结束' });
  }

  setupInputs();
  renderCanvas();
  updateNodeCount();
}

function setupInputs() {
  document.getElementById('tplName').addEventListener('input', e => {
    currentTemplate.name = e.target.value;
  });
  document.getElementById('tplDesc').addEventListener('input', e => {
    currentTemplate.description = e.target.value;
  });
}

function renderCanvas() {
  const wrap = document.getElementById('canvasSvg');
  wrap.innerHTML = '';
  renderer = new ApprovalSvgRenderer(wrap, {
    interactive: true,
    showStatus: false,
    onNodeClick: (node) => selectNode(node.id)
  });
  renderer.render(currentTemplate);
  renderProps();
}

function updateNodeCount() {
  document.getElementById('nodeCount').textContent = currentTemplate.nodes.length;
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  renderProps();
}

function addNode(type) {
  if (type === 'start') {
    if (currentTemplate.nodes.some(n => n.type === 'start')) {
      showToast('只能有一个开始节点', 'warning');
      return;
    }
    const node = { id: generateNodeId(), type: 'start', name: '开始' };
    currentTemplate.nodes.unshift(node);
  } else if (type === 'end') {
    if (currentTemplate.nodes.some(n => n.type === 'end')) {
      showToast('只能有一个结束节点', 'warning');
      return;
    }
    currentTemplate.nodes.push({ id: generateNodeId(), type: 'end', name: '结束' });
  } else if (type === 'approval') {
    const node = { id: generateNodeId(), type: 'approval', name: '审批节点', approvers: [] };
    insertBeforeEnd(node);
  } else if (type === 'countersign') {
    const node = { id: generateNodeId(), type: 'countersign', name: '会签节点', approvers: [] };
    insertBeforeEnd(node);
  } else if (type === 'condition') {
    const default1 = generateNodeId();
    const default2 = generateNodeId();
    const node = {
      id: generateNodeId(),
      type: 'condition',
      name: '条件判断',
      branches: [
        { condition: 'amount > 5000', label: '大额分支', target_node_id: default1 },
        { condition: '', label: '默认分支', target_node_id: default2 }
      ]
    };
    const app1 = { id: default1, type: 'approval', name: '大额审批', approvers: [] };
    const app2 = { id: default2, type: 'approval', name: '普通审批', approvers: [] };
    insertBeforeEnd(node);
    insertBeforeEnd(app1);
    insertBeforeEnd(app2);
    selectedNodeId = node.id;
  }

  autoWireAll();
  updateNodeCount();
  renderCanvas();
  showToast(`已添加${getNodeTypeLabel(type)}节点`, 'success');
}

function insertBeforeEnd(node) {
  const endIdx = currentTemplate.nodes.findIndex(n => n.type === 'end');
  if (endIdx === -1) {
    currentTemplate.nodes.push(node);
  } else {
    currentTemplate.nodes.splice(endIdx, 0, node);
  }
}

function autoWireAll() {
  currentTemplate.edges = [];
  const nodes = currentTemplate.nodes;
  const nonBranchableNodes = nodes.filter(n =>
    n.type === 'start' || n.type === 'approval' || n.type === 'countersign'
  );

  for (let i = 0; i < nonBranchableNodes.length - 1; i++) {
    const curr = nonBranchableNodes[i];
    const next = nonBranchableNodes[i + 1];

    if (curr.type === 'condition') continue;

    if (next.type === 'start') continue;

    currentTemplate.edges.push({ from: curr.id, to: next.id });
  }

  const startNode = nodes.find(n => n.type === 'start');
  if (startNode) {
    const hasOutgoing = currentTemplate.edges.some(e => e.from === startNode.id);
    if (!hasOutgoing) {
      const firstApproval = nodes.find(n => n.type === 'approval' || n.type === 'countersign' || n.type === 'condition');
      if (firstApproval) {
        currentTemplate.edges.push({ from: startNode.id, to: firstApproval.id });
      } else {
        const endNode = nodes.find(n => n.type === 'end');
        if (endNode) {
          currentTemplate.edges.push({ from: startNode.id, to: endNode.id });
        }
      }
    }
  }

  const conds = nodes.filter(n => n.type === 'condition');
  for (const cond of conds) {
    const branches = cond.branches || [];
    for (const branch of branches) {
      if (!branch.target_node_id) continue;
      const target = nodes.find(n => n.id === branch.target_node_id);
      if (!target) continue;
      if (target.type !== 'end') {
        const hasEdge = currentTemplate.edges.some(e =>
          e.from === branch.target_node_id
        );
        if (!hasEdge) {
          const endNode = nodes.find(n => n.type === 'end');
          if (endNode) {
            const nextAfter = findNextInOrder(target.id);
            if (nextAfter) {
              currentTemplate.edges.push({ from: target.id, to: nextAfter.id });
            } else {
              currentTemplate.edges.push({ from: target.id, to: endNode.id });
            }
          }
        }
      }
    }
  }

  const approvals = nodes.filter(n => n.type === 'approval' || n.type === 'countersign');
  const endNode = nodes.find(n => n.type === 'end');
  if (endNode && approvals.length > 0) {
    const lastApproval = approvals[approvals.length - 1];
    const hasEndEdge = currentTemplate.edges.some(e =>
      e.from === lastApproval.id && e.to === endNode.id
    );
    if (!hasEndEdge) {
      currentTemplate.edges.push({ from: lastApproval.id, to: endNode.id });
    }
  }

  currentTemplate.edges = dedupeEdges(currentTemplate.edges);
}

function findNextInOrder(nodeId) {
  const idx = currentTemplate.nodes.findIndex(n => n.id === nodeId);
  for (let i = idx + 1; i < currentTemplate.nodes.length; i++) {
    const n = currentTemplate.nodes[i];
    if (n.type === 'approval' || n.type === 'countersign' || n.type === 'condition') {
      return n;
    }
  }
  return null;
}

function dedupeEdges(edges) {
  const seen = new Set();
  return edges.filter(e => {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderProps() {
  const panel = document.getElementById('propPanel');
  if (!selectedNodeId) {
    panel.innerHTML = `<div class="empty-prop">点击画布中节点编辑属性<br><br>💡 提示：<br>条件网关的分支连线在属性中配置<br>普通节点自动连线到下一节点</div>`;
    return;
  }

  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node) {
    panel.innerHTML = `<div class="empty-prop">节点不存在</div>`;
    return;
  }

  const typeColors = {
    start: { bg: '#dcfce7', text: '#16a34a' },
    end: { bg: '#f1f5f9', text: '#475569' },
    approval: { bg: '#dbeafe', text: '#2563eb' },
    countersign: { bg: '#ede9fe', text: '#7c3aed' },
    condition: { bg: '#fef3c7', text: '#d97706' }
  };
  const tc = typeColors[node.type] || typeColors.approval;

  let html = `
    <div style="margin-bottom:12px;">
      <span class="node-type-tag" style="background:${tc.bg}; color:${tc.text};">${getNodeTypeBadge(node.type)}</span>
    </div>
  `;

  if (node.type !== 'start' && node.type !== 'end') {
    html += `
      <div style="margin-bottom:10px;">
        <label class="form-label">节点名称</label>
        <input class="form-input" value="${escapeAttr(node.name || '')}" oninput="updateNodeProp('name', this.value)">
      </div>
    `;
  }

  if (node.type === 'approval' || node.type === 'countersign') {
    html += renderApproverProps(node);
  }

  if (node.type === 'condition') {
    html += renderConditionProps(node);
  }

  if (node.type !== 'start' && node.type !== 'end') {
    html += `
      <div style="margin-top:18px; padding-top:14px; border-top:1px dashed #e2e8f0;">
        <button class="mini-btn" style="color:#dc2626; border-color:#fecaca; background:#fef2f2; width:100%;" onclick="deleteSelectedNode()">🗑 删除此节点</button>
      </div>
    `;
  }

  panel.innerHTML = html;
}

function renderApproverProps(node) {
  const users = getDemoUsers();
  const approvers = node.approvers || [];
  let html = `
    <label class="form-label">审批人${node.type === 'countersign' ? '（会签需全部通过）' : '（任一通过即可）'}</label>
    <div class="chip-list" id="approverChips_${node.id}">
      ${approvers.map(uid => `
        <span class="chip">
          ${escapeHtml(getUserDisplayName(uid))}
          <span style="margin-left:4px; cursor:pointer; opacity:0.6;" onclick="removeApprover('${uid}')">×</span>
        </span>
      `).join('') || '<span style="font-size:11px; color:#94a3b8;">暂未添加审批人</span>'}
    </div>
    <div class="relative" style="margin-top:8px;">
      <input class="form-input" id="approverSearch" placeholder="输入姓名搜索并添加..." oninput="searchApprovers(this.value)" onfocus="searchApprovers(this.value)">
      <div id="approverDropdown" class="users-dropdown" style="display:none;"></div>
    </div>
  `;
  return html;
}

function renderConditionProps(node) {
  const branchables = currentTemplate.nodes.filter(n =>
    n.id !== node.id && n.type !== 'start' && n.type !== 'condition'
  );
  let html = `
    <label class="form-label">节点名称</label>
    <input class="form-input" value="${escapeAttr(node.name || '')}" oninput="updateNodeProp('name', this.value)">
    <label class="form-label">分支配置（按顺序匹配，空条件为默认分支）</label>
  `;

  (node.branches || []).forEach((branch, idx) => {
    html += `
      <div class="branch-item">
        <div class="branch-head">
          <strong style="font-size:12px;">分支 #${idx + 1}</strong>
          <button class="remove-btn" onclick="removeBranch(${idx})" title="删除分支">删除</button>
        </div>
        <label class="form-label" style="margin-top:0;">条件表达式 <span style="font-weight:normal; color:#94a3b8;">（如 amount > 5000）</span></label>
        <div style="display:flex; gap:6px;">
          <input class="form-input" value="${escapeAttr(branch.condition || '')}" placeholder="留空表示默认分支" oninput="updateBranchCondition(${idx}, this.value)">
        </div>
        <div id="exprStatus_${idx}"></div>
        <label class="form-label">分支标签</label>
        <input class="form-input" value="${escapeAttr(branch.label || '')}" placeholder="显示在连线上的文字" oninput="updateBranchLabel(${idx}, this.value)">
        <label class="form-label">跳转目标节点</label>
        <select class="form-select" onchange="updateBranchTarget(${idx}, this.value)">
          <option value="">请选择...</option>
          ${branchables.map(n => `
            <option value="${n.id}" ${n.id === branch.target_node_id ? 'selected' : ''}>
              ${getNodeTypeLabel(n.type)} - ${escapeHtml(n.name || n.id)}
            </option>
          `).join('')}
        </select>
      </div>
    `;
    setTimeout(() => validateBranchExpr(idx, branch.condition), 0);
  });

  html += `
    <button class="mini-btn" style="margin-top:6px; width:100%;" onclick="addBranch()">+ 添加分支</button>
  `;
  return html;
}

function updateNodeProp(prop, value) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  node[prop] = value;
  renderCanvas();
}

function removeApprover(userId) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  node.approvers = (node.approvers || []).filter(u => u !== userId);
  renderCanvas();
}

function searchApprovers(keyword) {
  const users = getDemoUsers();
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  const currentApprovers = new Set(node.approvers || []);
  const kw = (keyword || '').toLowerCase();
  const matched = users.filter(u =>
    (u.name.toLowerCase().includes(kw) || u.id.toLowerCase().includes(kw)) &&
    !currentApprovers.has(u.id)
  ).slice(0, 8);

  const dd = document.getElementById('approverDropdown');
  if (!dd) return;
  if (matched.length === 0) {
    dd.style.display = 'none';
    return;
  }
  dd.style.display = 'block';
  dd.innerHTML = matched.map(u => `
    <div onclick="addApprover('${u.id}'); document.getElementById('approverSearch').value=''; searchApprovers('');">
      ${escapeHtml(u.name)} <span style="color:#94a3b8; font-size:11px;">(${u.id})</span>
    </div>
  `).join('');
}

function addApprover(userId) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  if (!node.approvers) node.approvers = [];
  if (!node.approvers.includes(userId)) {
    node.approvers.push(userId);
    renderCanvas();
    showToast(`已添加审批人: ${getUserDisplayName(userId)}`, 'success');
  }
}

function updateBranchCondition(idx, value) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node || !node.branches[idx]) return;
  node.branches[idx].condition = value;
  validateBranchExpr(idx, value);
  autoWireAll();
  renderCanvas();
}

function updateBranchLabel(idx, value) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node || !node.branches[idx]) return;
  node.branches[idx].label = value;
  renderCanvas();
}

function updateBranchTarget(idx, value) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node || !node.branches[idx]) return;
  node.branches[idx].target_node_id = value;
  autoWireAll();
  renderCanvas();
}

async function validateBranchExpr(idx, expr) {
  if (!expr || expr.trim() === '') {
    const el = document.getElementById(`exprStatus_${idx}`);
    if (el) el.innerHTML = `<div class="expr-valid">默认分支（当其它条件不匹配时执行）</div>`;
    return;
  }
  try {
    const result = await ApprovalAPI.validateExpression(expr);
    const el = document.getElementById(`exprStatus_${idx}`);
    if (!el) return;
    if (result.valid) {
      el.innerHTML = `<div class="expr-valid">✓ 表达式合法</div>`;
    } else {
      el.innerHTML = `<div class="expr-invalid">✗ ${escapeHtml(result.error)}</div>`;
    }
  } catch (e) {}
}

function addBranch() {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  if (!node.branches) node.branches = [];
  node.branches.push({ condition: '', label: `分支${node.branches.length + 1}`, target_node_id: '' });
  autoWireAll();
  renderCanvas();
  showToast('已添加新分支', 'success');
}

function removeBranch(idx) {
  const node = currentTemplate.nodes.find(n => n.id === selectedNodeId);
  if (!node || !node.branches) return;
  if (node.branches.length <= 2) {
    showToast('条件网关至少需要2个分支', 'warning');
    return;
  }
  node.branches.splice(idx, 1);
  autoWireAll();
  renderCanvas();
}

function deleteSelectedNode() {
  if (!confirm('确定删除此节点吗？相关连线也会移除。')) return;
  const nodeIdx = currentTemplate.nodes.findIndex(n => n.id === selectedNodeId);
  if (nodeIdx === -1) return;
  const node = currentTemplate.nodes[nodeIdx];

  if (node.type === 'condition' && node.branches) {
  }

  currentTemplate.nodes.splice(nodeIdx, 1);
  currentTemplate.edges = currentTemplate.edges.filter(e =>
    e.from !== selectedNodeId && e.to !== selectedNodeId
  );
  selectedNodeId = null;
  autoWireAll();
  updateNodeCount();
  renderCanvas();
  showToast('节点已删除', 'success');
}

async function saveTemplate() {
  const name = document.getElementById('tplName').value.trim();
  if (!name) {
    showValidationError('请填写模板名称');
    showToast('请填写模板名称', 'error');
    return;
  }

  const startCount = currentTemplate.nodes.filter(n => n.type === 'start').length;
  const endCount = currentTemplate.nodes.filter(n => n.type === 'end').length;
  if (startCount !== 1) {
    showValidationError(`必须有且只有1个开始节点，当前${startCount}个`);
    showToast('开始节点数量错误', 'error');
    return;
  }
  if (endCount !== 1) {
    showValidationError(`必须有且只有1个结束节点，当前${endCount}个`);
    showToast('结束节点数量错误', 'error');
    return;
  }

  for (const n of currentTemplate.nodes) {
    if (n.type === 'approval' || n.type === 'countersign') {
      if (!n.approvers || n.approvers.length === 0) {
        showToast(`节点"${n.name || n.id}"缺少审批人`, 'error');
        selectNode(n.id);
        return;
      }
    }
    if (n.type === 'condition') {
      const branches = n.branches || [];
      if (branches.length < 2) {
        showToast(`条件节点"${n.name || n.id}"至少需要2个分支`, 'error');
        selectNode(n.id);
        return;
      }
      let hasDefault = false;
      for (const b of branches) {
        if (!b.target_node_id) {
          showToast(`条件节点"${n.name || n.id}"的分支缺少目标节点`, 'error');
          selectNode(n.id);
          return;
        }
        if (b.condition === '' || b.condition === null || b.condition === undefined) {
          hasDefault = true;
        }
      }
      if (!hasDefault) {
        showToast(`条件节点"${n.name || n.id}"需要有一个默认分支（空条件）`, 'warning');
      }
    }
  }

  showValidationError(null);

  try {
    const payload = {
      name,
      description: document.getElementById('tplDesc').value.trim(),
      nodes: currentTemplate.nodes,
      edges: currentTemplate.edges
    };
    let result;
    if (templateId) {
      result = await ApprovalAPI.updateTemplate(templateId, payload);
    } else {
      result = await ApprovalAPI.createTemplate(payload);
      templateId = result.id;
      history.replaceState(null, '', `/approval/template-editor/${templateId}`);
    }
    if (result && result.error) {
      showToast(result.error, 'error');
      return;
    }
    showToast('保存成功', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showValidationError(msg) {
  const el = document.getElementById('validationMsg');
  if (!msg) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div style="background:#fef2f2; border:1px solid #fecaca; color:#dc2626; padding:10px 14px; border-radius:8px; font-size:13px; margin-bottom:10px;">⚠ ${escapeHtml(msg)}</div>`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('approverDropdown');
  const search = document.getElementById('approverSearch');
  if (dd && !e.target.closest('.users-dropdown') && e.target !== search) {
    dd.style.display = 'none';
  }
});

init();
