const fs = require('fs');
const path = require('path');
const { evaluateExpression, validateExpression } = require('./approvalExpressionParser');
const {
  DELEGATION_MODES,
  findEffectiveDelegation,
  shouldDelegateByTimeout,
  isRuleEffective
} = require('./delegationService');

const NODE_TYPES = {
  START: 'start',
  END: 'end',
  APPROVAL: 'approval',
  COUNTERSIGN: 'countersign',
  CONDITION: 'condition'
};

const APPROVAL_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  COMPLETED: 'completed'
};

const ACTION_TYPES = {
  APPROVE: 'approve',
  REJECT: 'reject',
  TRANSFER: 'transfer',
  START: 'start',
  ADVANCE: 'advance',
  AUTO_PASS: 'auto_pass',
  DELEGATE: 'delegate'
};

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'approvals.json');

let data = {
  templates: [],
  instances: [],
  records: [],
  nextTemplateId: 1,
  nextInstanceId: 1,
  nextRecordId: 1
};

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  if (fs.existsSync(dataFile)) {
    try {
      const raw = fs.readFileSync(dataFile, 'utf8');
      const loaded = JSON.parse(raw);
      data = {
        templates: loaded.templates || [],
        instances: loaded.instances || [],
        records: loaded.records || [],
        nextTemplateId: loaded.nextTemplateId || 1,
        nextInstanceId: loaded.nextInstanceId || 1,
        nextRecordId: loaded.nextRecordId || 1
      };
    } catch (e) {
      console.warn('审批数据文件损坏，使用空数据:', e.message);
    }
  }
  if (data.templates.length === 0) {
    initDemoData();
  }
}

function initDemoData() {
  console.log('初始化审批工作流演示数据...');

  const startNode = { id: 'node_start', type: NODE_TYPES.START, name: '开始' };
  const conditionNode = {
    id: 'node_condition_amount',
    type: NODE_TYPES.CONDITION,
    name: '金额判断',
    branches: [
      {
        label: '金额大于5000',
        condition: 'amount > 5000',
        target_node_id: 'node_l1_approval'
      },
      {
        label: '其他（默认）',
        condition: '',
        target_node_id: 'node_dept_manager'
      }
    ]
  };
  const l1Approval = {
    id: 'node_l1_approval',
    type: NODE_TYPES.APPROVAL,
    name: '一级主管审批',
    approvers: ['user-lisi']
  };
  const deptManager = {
    id: 'node_dept_manager',
    type: NODE_TYPES.APPROVAL,
    name: '部门经理审批',
    approvers: ['user-zhaoliu']
  };
  const l2Approval = {
    id: 'node_l2_approval',
    type: NODE_TYPES.COUNTERSIGN,
    name: '财务会签审批',
    approvers: ['user-zhaoliu', 'user-wangwu']
  };
  const finalApproval = {
    id: 'node_final_approval',
    type: NODE_TYPES.APPROVAL,
    name: '总监终审',
    approvers: ['user-qianda']
  };
  const endNode = { id: 'node_end', type: NODE_TYPES.END, name: '结束' };

  const edges = [
    { from: 'node_start', to: 'node_condition_amount' },
    { from: 'node_l1_approval', to: 'node_l2_approval' },
    { from: 'node_dept_manager', to: 'node_end' },
    { from: 'node_l2_approval', to: 'node_final_approval' },
    { from: 'node_final_approval', to: 'node_end' }
  ];

  const layout = {
    node_start: { x: 80, y: 180 },
    node_condition_amount: { x: 260, y: 180 },
    node_l1_approval: { x: 460, y: 60 },
    node_dept_manager: { x: 460, y: 300 },
    node_l2_approval: { x: 660, y: 60 },
    node_final_approval: { x: 860, y: 60 },
    node_end: { x: 1060, y: 180 }
  };

  const template = {
    id: data.nextTemplateId++,
    name: '费用报销审批流程（演示）',
    description: '预置演示流程：金额>5000元走三级审批（一级主管 → 财务会签 → 总监终审），5000元以下走两级审批（部门经理直接审批）',
    nodes: [startNode, conditionNode, l1Approval, deptManager, l2Approval, finalApproval, endNode],
    edges,
    layout,
    created_at: now(),
    updated_at: now(),
    created_by: 'system'
  };

  data.templates.push(template);

  const instance = {
    id: data.nextInstanceId++,
    template_id: template.id,
    document_id: 'demo-doc-001',
    document_title: '【演示】2025年Q1市场推广费用报销单 #88231',
    metadata: {
      amount: 12800,
      department: '市场部',
      category: '市场推广',
      applicant: '张三',
      submit_date: '2025-07-15'
    },
    status: APPROVAL_STATUS.PENDING,
    current_node_ids: ['node_l2_approval'],
    visited_node_ids: ['node_start', 'node_condition_amount', 'node_l1_approval', 'node_l2_approval'],
    active_path: ['node_start', 'node_condition_amount', 'node_l1_approval', 'node_l2_approval'],
    reject_round: 1,
    created_at: now() - 1000 * 60 * 60 * 24 * 2,
    updated_at: now() - 1000 * 60 * 60 * 3,
    created_by: 'user-zhangsan',
    created_by_name: '张三'
  };

  data.instances.push(instance);

  const t0 = instance.created_at;
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_start',
    action: ACTION_TYPES.START,
    user_id: 'user-zhangsan',
    user_name: '张三',
    comment: '提交Q1市场推广费用报销申请，金额 ¥12,800元，包含活动物料采购及场地租赁费用',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0
  });
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_condition_amount',
    action: ACTION_TYPES.AUTO_PASS,
    user_id: 'system',
    user_name: '系统',
    comment: '条件网关判断: amount=12800 > 5000，走三级审批分支',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0 + 1000
  });
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_l1_approval',
    action: ACTION_TYPES.ADVANCE,
    user_id: 'user-zhangsan',
    user_name: '张三',
    comment: '进入审批节点: 一级主管审批',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0 + 2000
  });
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_l1_approval',
    action: ACTION_TYPES.APPROVE,
    user_id: 'user-lisi',
    user_name: '李四（一级主管）',
    comment: '审核通过，费用明细核对无误，该活动为公司季度重点项目，预算范围内。',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0 + 1000 * 60 * 60 * 5
  });
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_l1_approval',
    action: ACTION_TYPES.AUTO_PASS,
    user_id: 'system',
    user_name: '系统',
    comment: '审批通过',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0 + 1000 * 60 * 60 * 5 + 1000
  });
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_l2_approval',
    action: ACTION_TYPES.ADVANCE,
    user_id: 'user-lisi',
    user_name: '李四（一级主管）',
    comment: '进入会签节点: 财务会签审批',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0 + 1000 * 60 * 60 * 5 + 2000
  });
  data.records.push({
    id: data.nextRecordId++,
    instance_id: instance.id,
    node_id: 'node_l2_approval',
    action: ACTION_TYPES.APPROVE,
    user_id: 'user-zhaoliu',
    user_name: '赵六（财务主管）',
    comment: '财务会计核算通过，发票齐全，会计科目编码正确。',
    to_user_id: null,
    to_user_name: null,
    reject_target_node_id: null,
    round: 1,
    created_at: t0 + 1000 * 60 * 60 * 22
  });

  saveData();
  console.log(`演示数据初始化完成：模板 ${template.id}，文档审批实例 ${instance.id}`);
}

function saveData() {
  ensureDataDir();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function now() {
  return Date.now();
}

function generateId() {
  return 'node_' + Math.random().toString(36).substr(2, 9);
}

function listTemplates() {
  loadData();
  return data.templates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    node_count: t.nodes ? t.nodes.length : 0,
    created_at: t.created_at,
    updated_at: t.updated_at,
    created_by: t.created_by
  })).sort((a, b) => b.updated_at - a.updated_at);
}

function getTemplateById(id, { reload = true } = {}) {
  if (reload) loadData();
  const tpl = data.templates.find(t => t.id === id);
  if (!tpl) return null;
  return JSON.parse(JSON.stringify(tpl));
}

function validateTemplate(template) {
  const { name, nodes, edges } = template;
  if (!name || !name.trim()) {
    return { valid: false, error: '模板名称不能为空' };
  }
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return { valid: false, error: '模板至少需要一个节点' };
  }
  const nodeIds = new Set();
  const startNodes = nodes.filter(n => n.type === NODE_TYPES.START);
  const endNodes = nodes.filter(n => n.type === NODE_TYPES.END);
  if (startNodes.length !== 1) {
    return { valid: false, error: '模板必须有且只有一个开始节点' };
  }
  if (endNodes.length !== 1) {
    return { valid: false, error: '模板必须有且只有一个结束节点' };
  }
  for (const node of nodes) {
    if (!node.id) return { valid: false, error: '所有节点必须有id' };
    if (nodeIds.has(node.id)) return { valid: false, error: `节点id重复: ${node.id}` };
    nodeIds.add(node.id);
    if (!node.type) return { valid: false, error: `节点 ${node.id} 缺少类型` };
    if (!Object.values(NODE_TYPES).includes(node.type)) {
      return { valid: false, error: `节点 ${node.id} 类型无效: ${node.type}` };
    }
    if (node.type === NODE_TYPES.APPROVAL || node.type === NODE_TYPES.COUNTERSIGN) {
      if (!node.approvers || !Array.isArray(node.approvers) || node.approvers.length === 0) {
        return { valid: false, error: `审批节点 ${node.name || node.id} 至少需要一个审批人` };
      }
    }
    if (node.type === NODE_TYPES.CONDITION) {
      if (!node.branches || !Array.isArray(node.branches) || node.branches.length < 2) {
        return { valid: false, error: `条件节点 ${node.name || node.id} 至少需要两个分支` };
      }
      for (const branch of node.branches) {
        if (branch.condition === undefined) {
          return { valid: false, error: `条件节点 ${node.name || node.id} 的分支缺少条件表达式` };
        }
        if (branch.condition !== null && branch.condition !== '') {
          const result = validateExpression(branch.condition);
          if (!result.valid) {
            return { valid: false, error: `条件表达式错误: ${result.error}` };
          }
        }
      }
    }
  }

  const inDegree = {};
  const graph = {};
  nodeIds.forEach(id => { inDegree[id] = 0; graph[id] = []; });

  const addEdge = (from, to) => {
    graph[from].push(to);
    inDegree[to]++;
  };

  if (edges && Array.isArray(edges)) {
    for (const edge of edges) {
      if (!nodeIds.has(edge.from)) return { valid: false, error: `边的源节点不存在: ${edge.from}` };
      if (!nodeIds.has(edge.to)) return { valid: false, error: `边的目标节点不存在: ${edge.to}` };
      addEdge(edge.from, edge.to);
    }
  }

  for (const node of nodes) {
    if (node.type === NODE_TYPES.CONDITION) {
      for (const branch of node.branches || []) {
        if (branch.target_node_id) {
          if (!nodeIds.has(branch.target_node_id)) {
            return { valid: false, error: `条件节点 ${node.name || node.id} 的分支目标节点不存在: ${branch.target_node_id}` };
          }
          addEdge(node.id, branch.target_node_id);
        }
      }
    }
  }

  const queue = [];
  const visited = [];
  Object.keys(inDegree).forEach(id => {
    if (inDegree[id] === 0) queue.push(id);
  });

  while (queue.length > 0) {
    const current = queue.shift();
    visited.push(current);
    for (const next of graph[current]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (visited.length !== nodeIds.size) {
    const cycleNodes = Array.from(nodeIds).filter(id => !visited.includes(id));
    const cycleNames = cycleNodes.map(id => {
      const n = nodes.find(x => x.id === id);
      return n ? (n.name || id) : id;
    }).join('、');
    return { valid: false, error: `检测到环路！流程模板不能包含循环。涉及节点：${cycleNames}` };
  }

  return { valid: true };
}

function createTemplate({ name, description, nodes, edges, layout, created_by }) {
  loadData();
  const validation = validateTemplate({ name, nodes, edges });
  if (!validation.valid) {
    return { error: validation.error, status: 400 };
  }
  const template = {
    id: data.nextTemplateId++,
    name: name.trim(),
    description: description || '',
    nodes: nodes || [],
    edges: edges || [],
    layout: layout || {},
    created_at: now(),
    updated_at: now(),
    created_by: created_by || null
  };
  data.templates.push(template);
  saveData();
  return getTemplateById(template.id, { reload: false });
}

function updateTemplate(id, { name, description, nodes, edges, layout }) {
  loadData();
  const idx = data.templates.findIndex(t => t.id === id);
  if (idx === -1) return null;
  if (name !== undefined) {
    const validation = validateTemplate({
      name,
      nodes: nodes || data.templates[idx].nodes,
      edges: edges || data.templates[idx].edges
    });
    if (!validation.valid) {
      return { error: validation.error, status: 400 };
    }
    data.templates[idx].name = name.trim();
  }
  if (description !== undefined) data.templates[idx].description = description;
  if (nodes !== undefined || edges !== undefined) {
    const validation = validateTemplate({
      name: data.templates[idx].name,
      nodes: nodes || data.templates[idx].nodes,
      edges: edges || data.templates[idx].edges
    });
    if (!validation.valid) {
      return { error: validation.error, status: 400 };
    }
    if (nodes !== undefined) data.templates[idx].nodes = nodes;
    if (edges !== undefined) data.templates[idx].edges = edges;
  }
  if (layout !== undefined) data.templates[idx].layout = layout;
  data.templates[idx].updated_at = now();
  saveData();
  return getTemplateById(id, { reload: false });
}

function deleteTemplate(id) {
  loadData();
  const idx = data.templates.findIndex(t => t.id === id);
  if (idx === -1) return false;
  const inUse = data.instances.some(inst => inst.template_id === id);
  if (inUse) {
    return { error: '该模板已被审批实例使用，无法删除', status: 400 };
  }
  data.templates.splice(idx, 1);
  saveData();
  return true;
}

function getNextNodes(template, fromNodeId, metadata) {
  const fromNode = template.nodes.find(n => n.id === fromNodeId);
  if (!fromNode) return [];
  if (fromNode.type === NODE_TYPES.END) return [];
  if (fromNode.type === NODE_TYPES.CONDITION) {
    for (const branch of fromNode.branches || []) {
      if (branch.condition === null || branch.condition === '') {
        return [branch.target_node_id];
      }
      try {
        const result = evaluateExpression(branch.condition, metadata || {});
        if (result) {
          return [branch.target_node_id];
        }
      } catch (e) {
        console.error('条件表达式执行错误:', e.message);
      }
    }
    return [];
  }
  const outgoingEdges = (template.edges || []).filter(e => e.from === fromNodeId);
  return outgoingEdges.map(e => e.to);
}

function findNodePath(template, startNodeId, targetNodeId) {
  const visited = new Set();
  const queue = [[startNodeId, [startNodeId]]];
  while (queue.length > 0) {
    const [current, path] = queue.shift();
    if (current === targetNodeId) return path;
    if (visited.has(current)) continue;
    visited.add(current);
    const currentNode = template.nodes.find(n => n.id === current);
    let nextIds = [];
    if (currentNode && currentNode.type === NODE_TYPES.CONDITION) {
      nextIds = (currentNode.branches || []).map(b => b.target_node_id);
    } else {
      nextIds = (template.edges || []).filter(e => e.from === current).map(e => e.to);
    }
    for (const nextId of nextIds) {
      if (!visited.has(nextId)) {
        queue.push([nextId, [...path, nextId]]);
      }
    }
  }
  return null;
}

function getPrecedingNodes(template, nodeId) {
  const result = [];
  const startNode = template.nodes.find(n => n.type === NODE_TYPES.START);
  if (!startNode) return result;
  for (const node of template.nodes) {
    if (node.id === nodeId) continue;
    if (node.type === NODE_TYPES.END) continue;
    const path = findNodePath(template, startNode.id, node.id);
    if (path) {
      const toTarget = findNodePath(template, node.id, nodeId);
      if (toTarget) {
        result.push({
          node,
          path_length: path.length
        });
      }
    }
  }
  return result.sort((a, b) => a.path_length - b.path_length).map(r => r.node);
}

function listInstances({ userId, status, templateId, createdBy } = {}) {
  loadData();
  return data.instances.filter(inst => {
    if (status && inst.status !== status) return false;
    if (templateId && inst.template_id !== templateId) return false;
    if (createdBy && inst.created_by !== createdBy) return false;
    if (userId) {
      const isTodo = isUserTodo(inst, userId);
      const isCreator = inst.created_by === userId;
      const hasHistory = hasUserHistory(inst.id, userId);
      if (!isTodo && !isCreator && !hasHistory) return false;
    }
    return true;
  }).sort((a, b) => b.updated_at - a.updated_at);
}

function getInstanceById(id, { reload = true } = {}) {
  if (reload) loadData();
  const inst = data.instances.find(i => i.id === id);
  if (!inst) return null;
  const template = getTemplateById(inst.template_id, { reload: false });
  const records = getRecordsByInstanceId(inst.id, false);
  return {
    ...JSON.parse(JSON.stringify(inst)),
    template,
    records
  };
}

function getRecordsByInstanceId(instanceId, reload = true) {
  if (reload) loadData();
  return data.records
    .filter(r => r.instance_id === instanceId)
    .sort((a, b) => a.created_at - b.created_at);
}

function getApproverForNode(instance, nodeId, userId) {
  const currentRound = instance ? (instance.reject_round || 0) : 0;
  const records = data.records.filter(r =>
    r.instance_id === instance.id &&
    r.node_id === nodeId &&
    r.round === currentRound
  );
  
  const delegateRecord = records.find(r =>
    r.action === ACTION_TYPES.DELEGATE &&
    (r.user_id === userId || r.to_user_id === userId)
  );
  
  if (delegateRecord) {
    if (delegateRecord.to_user_id === userId) {
      return {
        isApprover: true,
        isDelegate: true,
        delegatorId: delegateRecord.user_id,
        delegatorName: delegateRecord.user_name,
        delegateRuleId: delegateRecord.delegate_rule_id
      };
    }
    if (delegateRecord.user_id === userId) {
      return {
        isApprover: false,
        isDelegated: true,
        agentId: delegateRecord.to_user_id,
        agentName: delegateRecord.to_user_name
      };
    }
  }
  
  return { isApprover: false };
}

function isUserTodo(instance, userId) {
  if (!instance) return false;
  if (!userId) return false;
  if (instance.status !== APPROVAL_STATUS.PENDING) return false;
  const currentNodeIds = instance.current_node_ids || [];
  const template = getTemplateById(instance.template_id, { reload: false });
  if (!template) return false;
  const currentRound = instance.reject_round || 0;
  for (const nodeId of currentNodeIds) {
    const node = template.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    
    const approverInfo = getApproverForNode(instance, nodeId, userId);
    if (approverInfo.isApprover) return true;
    
    if (node.type === NODE_TYPES.APPROVAL || node.type === NODE_TYPES.COUNTERSIGN) {
      if ((node.approvers || []).includes(userId)) {
        if (approverInfo.isDelegated) continue;
        
        const hasApproved = data.records.some(r =>
          r.instance_id === instance.id &&
          r.node_id === nodeId &&
          r.user_id === userId &&
          (r.action === ACTION_TYPES.APPROVE || r.action === ACTION_TYPES.REJECT) &&
          r.round === currentRound
        );
        if (!hasApproved) return true;
      }
    }
  }
  return false;
}

function delegateTodo(instanceId, nodeId, { delegatorId, delegatorName, agentId, agentName, ruleId, comment }) {
  loadData();
  const instIdx = data.instances.findIndex(i => i.id === instanceId);
  if (instIdx === -1) return { error: '审批实例不存在', status: 404 };
  const inst = data.instances[instIdx];
  const currentRound = inst.reject_round || 0;
  
  addRecord(instanceId, nodeId, ACTION_TYPES.DELEGATE, {
    userId: delegatorId,
    userName: delegatorName,
    toUserId: agentId,
    toUserName: agentName,
    delegateRuleId: ruleId,
    comment: comment || '自动委托',
    round: currentRound
  });
  
  data.instances[instIdx].updated_at = now();
  saveData();
  
  return getInstanceById(instanceId, { reload: false });
}

function hasUserHistory(instanceId, userId) {
  return data.records.some(r => r.instance_id === instanceId && r.user_id === userId);
}

function listTodos(userId) {
  if (!userId) return [];
  loadData();
  const todos = [];
  for (const inst of data.instances) {
    if (inst.status !== APPROVAL_STATUS.PENDING) continue;
    const template = getTemplateById(inst.template_id, { reload: false });
    if (!template) continue;
    const currentNodeIds = inst.current_node_ids || [];
    const currentRound = inst.reject_round || 0;
    for (const nodeId of currentNodeIds) {
      const node = template.nodes.find(n => n.id === nodeId);
      if (!node) continue;
      let isTodo = false;
      let nodeType = node.type;
      let delegateInfo = null;
      
      const approverInfo = getApproverForNode(inst, nodeId, userId);
      if (approverInfo.isApprover) {
        isTodo = true;
        if (approverInfo.isDelegate) {
          delegateInfo = {
            is_delegate: true,
            delegator_id: approverInfo.delegatorId,
            delegator_name: approverInfo.delegatorName,
            delegate_rule_id: approverInfo.delegateRuleId
          };
        }
      }
      
      if (!isTodo && (node.type === NODE_TYPES.APPROVAL || node.type === NODE_TYPES.COUNTERSIGN) &&
        (node.approvers || []).includes(userId)) {
        if (approverInfo.isDelegated) {
          delegateInfo = {
            is_delegated: true,
            agent_id: approverInfo.agentId,
            agent_name: approverInfo.agentName
          };
        } else {
          const hasApproved = data.records.some(r =>
            r.instance_id === inst.id &&
            r.node_id === nodeId &&
            r.user_id === userId &&
            (r.action === ACTION_TYPES.APPROVE || r.action === ACTION_TYPES.REJECT) &&
            r.round === currentRound
          );
          if (!hasApproved) isTodo = true;
        }
      }
      
      if (isTodo || delegateInfo) {
        const todoCreatedAt = getTodoCreatedAt(inst.id, nodeId, currentRound);
        const todo = {
          instance_id: inst.id,
          document_title: inst.document_title,
          document_id: inst.document_id,
          node_id: nodeId,
          node_name: node.name,
          node_type: nodeType,
          template_id: template.id,
          template_name: template.name,
          created_at: todoCreatedAt || inst.created_at,
          updated_at: inst.updated_at,
          started_by: inst.created_by_name,
          delegate: delegateInfo,
          is_todo: isTodo,
          delegator_id: null,
          delegator_name: null,
          delegated_to_user_id: null,
          delegated_to_user_name: null,
          delegate_rule_id: null
        };
        
        if (delegateInfo) {
          if (delegateInfo.is_delegate) {
            todo.delegator_id = delegateInfo.delegator_id;
            todo.delegator_name = delegateInfo.delegator_name;
            todo.delegate_rule_id = delegateInfo.delegate_rule_id;
          } else if (delegateInfo.is_delegated) {
            todo.delegated_to_user_id = delegateInfo.agent_id;
            todo.delegated_to_user_name = delegateInfo.agent_name;
          }
        }
        
        todos.push(todo);
      }
    }
  }
  return todos.sort((a, b) => b.updated_at - a.updated_at);
}

function getTodoCreatedAt(instanceId, nodeId, round) {
  const advanceRecord = data.records.find(r =>
    r.instance_id === instanceId &&
    r.node_id === nodeId &&
    r.action === ACTION_TYPES.ADVANCE &&
    r.round === round
  );
  return advanceRecord ? advanceRecord.created_at : null;
}

function processAutoDelegation(instance, node, round) {
  const approvers = node.approvers || [];
  const instanceId = instance.id;
  const nodeId = node.id;
  
  for (const approverId of approvers) {
    const delegation = findEffectiveDelegation(approverId);
    if (!delegation) continue;
    
    const existingDelegate = data.records.some(r =>
      r.instance_id === instanceId &&
      r.node_id === nodeId &&
      r.action === ACTION_TYPES.DELEGATE &&
      r.user_id === approverId &&
      r.round === round
    );
    
    if (existingDelegate) continue;
    
    if (delegation.mode === DELEGATION_MODES.TIME_RANGE && isRuleEffective(delegation)) {
      const { getUserName } = require('./permissionService');
      addRecord(instanceId, nodeId, ACTION_TYPES.DELEGATE, {
        userId: approverId,
        userName: delegation.delegator_name || getUserName(approverId),
        toUserId: delegation.agent_id,
        toUserName: delegation.agent_name || getUserName(delegation.agent_id),
        delegateRuleId: delegation.id,
        comment: `时间段自动委托（${delegation.mode === DELEGATION_MODES.TIME_RANGE ? '生效中' : '超时未处理'}）`,
        round
      });
    }
  }
}

function checkTimeoutAndDelegate() {
  loadData();
  const { getUserName } = require('./permissionService');
  const results = [];
  
  for (const inst of data.instances) {
    if (inst.status !== APPROVAL_STATUS.PENDING) continue;
    
    const template = getTemplateById(inst.template_id, { reload: false });
    if (!template) continue;
    
    const currentNodeIds = inst.current_node_ids || [];
    const currentRound = inst.reject_round || 0;
    
    for (const nodeId of currentNodeIds) {
      const node = template.nodes.find(n => n.id === nodeId);
      if (!node || (node.type !== NODE_TYPES.APPROVAL && node.type !== NODE_TYPES.COUNTERSIGN)) continue;
      
      const approvers = node.approvers || [];
      const todoCreatedAt = getTodoCreatedAt(inst.id, nodeId, currentRound);
      
      for (const approverId of approvers) {
        const delegation = findEffectiveDelegation(approverId);
        if (!delegation || delegation.mode !== DELEGATION_MODES.TIMEOUT) continue;
        
        const existingDelegate = data.records.some(r =>
          r.instance_id === inst.id &&
          r.node_id === nodeId &&
          r.action === ACTION_TYPES.DELEGATE &&
          r.user_id === approverId &&
          r.round === currentRound
        );
        
        if (existingDelegate) continue;
        
        const hasApproved = data.records.some(r =>
          r.instance_id === inst.id &&
          r.node_id === nodeId &&
          r.user_id === approverId &&
          (r.action === ACTION_TYPES.APPROVE || r.action === ACTION_TYPES.REJECT) &&
          r.round === currentRound
        );
        
        if (hasApproved) continue;
        
        if (shouldDelegateByTimeout(delegation, todoCreatedAt)) {
          addRecord(inst.id, nodeId, ACTION_TYPES.DELEGATE, {
            userId: approverId,
            userName: delegation.delegator_name || getUserName(approverId),
            toUserId: delegation.agent_id,
            toUserName: delegation.agent_name || getUserName(delegation.agent_id),
            delegateRuleId: delegation.id,
            comment: `超时${delegation.timeout_hours}小时未处理，自动委托`,
            round: currentRound
          });
          
          results.push({
            instance_id: inst.id,
            node_id: nodeId,
            delegator_id: approverId,
            agent_id: delegation.agent_id,
            rule_id: delegation.id
          });
        }
      }
    }
  }
  
  if (results.length > 0) {
    saveData();
  }
  
  return results;
}

function createInstance({ templateId, documentId, documentTitle, metadata, createdBy, createdByName }) {
  loadData();
  const template = getTemplateById(templateId, { reload: false });
  if (!template) {
    return { error: '模板不存在', status: 404 };
  }
  if (template.nodes.length < 2) {
    return { error: '模板不完整，缺少节点', status: 400 };
  }
  const instance = {
    id: data.nextInstanceId++,
    template_id: templateId,
    document_id: documentId || null,
    document_title: documentTitle || '',
    metadata: metadata || {},
    status: APPROVAL_STATUS.DRAFT,
    current_node_ids: [],
    visited_node_ids: [],
    active_path: [],
    reject_round: 0,
    created_at: now(),
    updated_at: now(),
    created_by: createdBy || null,
    created_by_name: createdByName || '匿名用户'
  };
  data.instances.push(instance);
  saveData();
  return getInstanceById(instance.id, { reload: false });
}

function addRecord(instanceId, nodeId, action, { userId, userName, comment, toUserId, toUserName, rejectTargetNodeId, round, delegatorId, delegatorName, delegateRuleId }) {
  const record = {
    id: data.nextRecordId++,
    instance_id: instanceId,
    node_id: nodeId || null,
    action,
    user_id: userId || null,
    user_name: userName || null,
    comment: comment || '',
    to_user_id: toUserId || null,
    to_user_name: toUserName || null,
    reject_target_node_id: rejectTargetNodeId || null,
    round: round !== undefined ? round : null,
    delegator_id: delegatorId || null,
    delegator_name: delegatorName || null,
    delegate_rule_id: delegateRuleId || null,
    created_at: now()
  };
  data.records.push(record);
  return record;
}

function startInstance(instanceId, { userId, userName }) {
  loadData();
  const instIdx = data.instances.findIndex(i => i.id === instanceId);
  if (instIdx === -1) return { error: '审批实例不存在', status: 404 };
  const inst = data.instances[instIdx];
  if (inst.status !== APPROVAL_STATUS.DRAFT) {
    return { error: '只能启动草稿状态的审批', status: 400 };
  }
  const template = getTemplateById(inst.template_id, { reload: false });
  if (!template) return { error: '模板不存在', status: 404 };
  const startNode = template.nodes.find(n => n.type === NODE_TYPES.START);
  if (!startNode) return { error: '模板缺少开始节点', status: 400 };

  inst.status = APPROVAL_STATUS.PENDING;
  inst.visited_node_ids = [startNode.id];
  inst.active_path = [startNode.id];
  inst.reject_round = 1;

  const currentRound = inst.reject_round;
  addRecord(instanceId, startNode.id, ACTION_TYPES.START, {
    userId, userName,
    comment: '启动审批流程',
    round: currentRound
  });

  const advanceResult = advanceToNextNodes(instIdx, template, startNode.id, userId, userName);
  if (advanceResult && advanceResult.error) {
    saveData();
    return advanceResult;
  }

  data.instances[instIdx].updated_at = now();
  saveData();

  return getInstanceById(instanceId, { reload: false });
}

function advanceToNextNodes(instIdx, template, fromNodeId, userId, userName) {
  const inst = data.instances[instIdx];
  const currentRound = inst.reject_round || 0;
  const nextNodeIds = getNextNodes(template, fromNodeId, inst.metadata);

  if (nextNodeIds.length === 0) {
    inst.status = APPROVAL_STATUS.COMPLETED;
    inst.current_node_ids = [];
    addRecord(inst.id, fromNodeId, ACTION_TYPES.AUTO_PASS, {
      userId: 'system', userName: '系统',
      comment: '流程到达终点，审批完成',
      round: currentRound
    });
    return { completed: true };
  }

  const newCurrentNodes = [];

  for (const nextNodeId of nextNodeIds) {
    if (inst.visited_node_ids.includes(nextNodeId)) continue;
    inst.visited_node_ids.push(nextNodeId);
    if (!inst.active_path.includes(nextNodeId)) {
      inst.active_path.push(nextNodeId);
    }
    const nextNode = template.nodes.find(n => n.id === nextNodeId);
    if (!nextNode) continue;

    if (nextNode.type === NODE_TYPES.END) {
      addRecord(inst.id, nextNodeId, ACTION_TYPES.AUTO_PASS, {
        userId: 'system', userName: '系统',
        comment: '流程到达结束节点',
        round: currentRound
      });
      inst.status = APPROVAL_STATUS.COMPLETED;
      continue;
    }

    if (nextNode.type === NODE_TYPES.CONDITION) {
      addRecord(inst.id, nextNodeId, ACTION_TYPES.AUTO_PASS, {
        userId: 'system', userName: '系统',
        comment: `条件网关判断: ${nextNode.name || nextNodeId}`,
        round: currentRound
      });
      const branchResult = advanceToNextNodes(instIdx, template, nextNodeId, userId, userName);
      if (branchResult && branchResult.error) return branchResult;
      continue;
    }

    if (nextNode.type === NODE_TYPES.APPROVAL || nextNode.type === NODE_TYPES.COUNTERSIGN) {
      newCurrentNodes.push(nextNodeId);
      addRecord(inst.id, nextNodeId, ACTION_TYPES.ADVANCE, {
        userId, userName,
        comment: `进入${nextNode.type === NODE_TYPES.COUNTERSIGN ? '会签' : '审批'}节点: ${nextNode.name || nextNodeId}`,
        round: currentRound
      });
      
      processAutoDelegation(inst, nextNode, currentRound);
    }
  }

  const stillPending = (inst.current_node_ids || []).filter(nid => {
    const node = template.nodes.find(n => n.id === nid);
    if (!node) return false;
    if (node.type === NODE_TYPES.APPROVAL || node.type === NODE_TYPES.COUNTERSIGN) {
      return !isNodeCompleted(inst.id, node, inst);
    }
    return false;
  });

  inst.current_node_ids = [...stillPending, ...newCurrentNodes];

  if (inst.current_node_ids.length === 0 && inst.status !== APPROVAL_STATUS.COMPLETED) {
    inst.status = APPROVAL_STATUS.COMPLETED;
  }
}

function isNodeCompleted(instanceId, node, instance) {
  const currentRound = instance ? (instance.reject_round || 0) : 0;
  const records = data.records.filter(r =>
    r.instance_id === instanceId &&
    r.node_id === node.id &&
    r.round === currentRound
  );
  const approvals = records.filter(r => r.action === ACTION_TYPES.APPROVE);
  const rejections = records.filter(r => r.action === ACTION_TYPES.REJECT);

  if (rejections.length > 0) return true;

  const delegateRecords = records.filter(r => r.action === ACTION_TYPES.DELEGATE);
  
  const effectiveApproverIds = new Set(node.approvers || []);
  delegateRecords.forEach(dr => {
    if (effectiveApproverIds.has(dr.user_id)) {
      effectiveApproverIds.delete(dr.user_id);
      effectiveApproverIds.add(dr.to_user_id);
    }
  });

  if (node.type === NODE_TYPES.APPROVAL) {
    return approvals.some(r => {
      if (effectiveApproverIds.has(r.user_id)) return true;
      if (r.delegator_id && effectiveApproverIds.has(r.delegator_id)) return true;
      return false;
    });
  }

  if (node.type === NODE_TYPES.COUNTERSIGN) {
    const approverIds = node.approvers || [];
    return approverIds.every(approverId => {
      const hasDirectApproval = approvals.some(a => a.user_id === approverId);
      if (hasDirectApproval) return true;
      
      const delegate = delegateRecords.find(d => d.user_id === approverId);
      if (delegate) {
        return approvals.some(a => 
          a.user_id === delegate.to_user_id || 
          (a.delegator_id === approverId && a.user_id === delegate.to_user_id)
        );
      }
      
      return false;
    });
  }

  return false;
}

function approveInstance(instanceId, nodeId, { userId, userName, comment }) {
  loadData();
  const instIdx = data.instances.findIndex(i => i.id === instanceId);
  if (instIdx === -1) return { error: '审批实例不存在', status: 404 };
  const inst = data.instances[instIdx];
  if (inst.status !== APPROVAL_STATUS.PENDING) {
    return { error: '只能处理进行中的审批', status: 400 };
  }
  if (!(inst.current_node_ids || []).includes(nodeId)) {
    return { error: '当前节点不是待处理节点', status: 400 };
  }
  const template = getTemplateById(inst.template_id, { reload: false });
  if (!template) return { error: '模板不存在', status: 404 };
  const node = template.nodes.find(n => n.id === nodeId);
  if (!node) return { error: '节点不存在', status: 404 };
  
  const currentRound = inst.reject_round || 0;
  
  const approverInfo = getApproverForNode(inst, nodeId, userId);
  const isApprover = (node.approvers || []).includes(userId);
  const isDelegate = approverInfo.isApprover && approverInfo.isDelegate;
  
  if (!isApprover && !isDelegate) {
    return { error: '您不是该节点的审批人或代理人', status: 403 };
  }
  
  const existingRecord = data.records.find(r =>
    r.instance_id === instanceId &&
    r.node_id === nodeId &&
    r.user_id === userId &&
    (r.action === ACTION_TYPES.APPROVE || r.action === ACTION_TYPES.REJECT) &&
    r.round === currentRound
  );
  if (existingRecord) {
    return { error: '您已在此节点处理过', status: 400 };
  }

  const recordOptions = { userId, userName, comment, round: currentRound };
  if (isDelegate) {
    recordOptions.delegatorId = approverInfo.delegatorId;
    recordOptions.delegatorName = approverInfo.delegatorName;
    recordOptions.delegateRuleId = approverInfo.delegateRuleId;
  }
  
  addRecord(instanceId, nodeId, ACTION_TYPES.APPROVE, recordOptions);

  if (isNodeCompleted(instanceId, node, inst)) {
    addRecord(instanceId, nodeId, ACTION_TYPES.AUTO_PASS, {
      userId: 'system', userName: '系统',
      comment: node.type === NODE_TYPES.COUNTERSIGN ? '会签全部通过' : '审批通过',
      round: currentRound
    });
    const advanceResult = advanceToNextNodes(instIdx, template, nodeId, userId, userName);
    if (advanceResult && advanceResult.error) {
      data.instances[instIdx].updated_at = now();
      saveData();
      return advanceResult;
    }
  }

  data.instances[instIdx].updated_at = now();
  saveData();
  return getInstanceById(instanceId, { reload: false });
}

function rejectInstance(instanceId, nodeId, { userId, userName, comment, targetNodeId }) {
  loadData();
  const instIdx = data.instances.findIndex(i => i.id === instanceId);
  if (instIdx === -1) return { error: '审批实例不存在', status: 404 };
  const inst = data.instances[instIdx];
  if (inst.status !== APPROVAL_STATUS.PENDING) {
    return { error: '只能处理进行中的审批', status: 400 };
  }
  if (!(inst.current_node_ids || []).includes(nodeId)) {
    return { error: '当前节点不是待处理节点', status: 400 };
  }
  const template = getTemplateById(inst.template_id, { reload: false });
  if (!template) return { error: '模板不存在', status: 404 };
  const node = template.nodes.find(n => n.id === nodeId);
  if (!node) return { error: '节点不存在', status: 404 };
  
  const approverInfo = getApproverForNode(inst, nodeId, userId);
  const isApprover = (node.approvers || []).includes(userId);
  const isDelegate = approverInfo.isApprover && approverInfo.isDelegate;
  
  if (!isApprover && !isDelegate) {
    return { error: '您不是该节点的审批人或代理人', status: 403 };
  }

  let actualTargetNodeId = targetNodeId;
  if (!actualTargetNodeId) {
    const startNode = template.nodes.find(n => n.type === NODE_TYPES.START);
    const nextFromStart = getNextNodes(template, startNode.id, inst.metadata);
    actualTargetNodeId = nextFromStart.length > 0 ? nextFromStart[0] : startNode.id;
  } else {
    const precedings = getPrecedingNodes(template, nodeId);
    const startNode = template.nodes.find(n => n.type === NODE_TYPES.START);
    const validTargets = [startNode.id, ...precedings.map(n => n.id)];
    if (!validTargets.includes(actualTargetNodeId)) {
      return { error: '驳回目标节点无效，必须是前置节点', status: 400 };
    }
  }

  const oldRound = inst.reject_round || 0;
  const newRound = oldRound + 1;
  inst.reject_round = newRound;

  const recordOptions = { userId, userName, comment, rejectTargetNodeId: actualTargetNodeId, round: oldRound };
  if (isDelegate) {
    recordOptions.delegatorId = approverInfo.delegatorId;
    recordOptions.delegatorName = approverInfo.delegatorName;
    recordOptions.delegateRuleId = approverInfo.delegateRuleId;
  }
  
  addRecord(instanceId, nodeId, ACTION_TYPES.REJECT, recordOptions);

  const targetNode = template.nodes.find(n => n.id === actualTargetNodeId);
  const targetName = targetNode ? (targetNode.name || targetNode.id) : actualTargetNodeId;
  addRecord(instanceId, actualTargetNodeId, ACTION_TYPES.ADVANCE, {
    userId: 'system', userName: '系统',
    comment: `被驳回到节点: ${targetName}，进入第 ${newRound} 轮审批`,
    round: newRound
  });

  inst.current_node_ids = [actualTargetNodeId];
  const path = findNodePath(template, actualTargetNodeId, nodeId);
  if (path) {
    const keepInVisited = new Set([actualTargetNodeId]);
    inst.visited_node_ids = inst.visited_node_ids.filter(id => !path.includes(id) || keepInVisited.has(id));
    inst.active_path = inst.active_path.filter(id => !path.includes(id) || id === actualTargetNodeId);
  }
  inst.status = APPROVAL_STATUS.PENDING;

  if (targetNode && (targetNode.type === NODE_TYPES.START || targetNode.type === NODE_TYPES.CONDITION)) {
    const advanceResult = advanceToNextNodes(instIdx, template, actualTargetNodeId, userId, userName);
    if (advanceResult && advanceResult.error) {
      data.instances[instIdx].updated_at = now();
      saveData();
      return advanceResult;
    }
  }

  data.instances[instIdx].updated_at = now();
  saveData();
  return getInstanceById(instanceId, { reload: false });
}

function transferInstance(instanceId, nodeId, { userId, userName, toUserId, toUserName, comment }) {
  loadData();
  const instIdx = data.instances.findIndex(i => i.id === instanceId);
  if (instIdx === -1) return { error: '审批实例不存在', status: 404 };
  const inst = data.instances[instIdx];
  if (inst.status !== APPROVAL_STATUS.PENDING) {
    return { error: '只能处理进行中的审批', status: 400 };
  }
  if (!(inst.current_node_ids || []).includes(nodeId)) {
    return { error: '当前节点不是待处理节点', status: 400 };
  }
  const template = getTemplateById(inst.template_id, { reload: false });
  if (!template) return { error: '模板不存在', status: 404 };
  const nodeIdx = template.nodes.findIndex(n => n.id === nodeId);
  if (nodeIdx === -1) return { error: '节点不存在', status: 404 };
  const node = template.nodes[nodeIdx];
  
  const approverInfo = getApproverForNode(inst, nodeId, userId);
  const isApprover = (node.approvers || []).includes(userId);
  const isDelegate = approverInfo.isApprover && approverInfo.isDelegate;
  
  if (!isApprover && !isDelegate) {
    return { error: '您不是该节点的审批人或代理人，无法转交', status: 403 };
  }

  const currentRound = inst.reject_round || 0;
  const recordOptions = { userId, userName, comment, toUserId, toUserName, round: currentRound };
  if (isDelegate) {
    recordOptions.delegatorId = approverInfo.delegatorId;
    recordOptions.delegatorName = approverInfo.delegatorName;
    recordOptions.delegateRuleId = approverInfo.delegateRuleId;
  }
  
  addRecord(instanceId, nodeId, ACTION_TYPES.TRANSFER, recordOptions);

  if (!node.approvers.includes(toUserId)) {
    template.nodes[nodeIdx].approvers.push(toUserId);
    data.templates = data.templates.map(t =>
      t.id === template.id ? template : t
    );
  }

  data.instances[instIdx].updated_at = now();
  saveData();
  return getInstanceById(instanceId, { reload: false });
}

function getNodeStatus(instance, nodeId) {
  if (!instance) return 'unknown';
  if (instance.active_path && instance.active_path.includes(nodeId)) {
    if (instance.current_node_ids && instance.current_node_ids.includes(nodeId)) {
      return 'current';
    }
    return 'passed';
  }
  return 'pending';
}

module.exports = {
  NODE_TYPES,
  APPROVAL_STATUS,
  ACTION_TYPES,
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  validateTemplate,
  listInstances,
  getInstanceById,
  createInstance,
  startInstance,
  approveInstance,
  rejectInstance,
  transferInstance,
  listTodos,
  getRecordsByInstanceId,
  getNextNodes,
  getPrecedingNodes,
  getNodeStatus,
  findNodePath,
  isUserTodo,
  generateId,
  initDemoData,
  delegateTodo,
  checkTimeoutAndDelegate,
  getApproverForNode,
  getTodoCreatedAt
};
