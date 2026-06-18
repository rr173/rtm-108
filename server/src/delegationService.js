const fs = require('fs');
const path = require('path');

const DELEGATION_MODES = {
  TIME_RANGE: 'time_range',
  TIMEOUT: 'timeout'
};

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'delegations.json');

let data = {
  rules: [],
  nextRuleId: 1
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
        rules: loaded.rules || [],
        nextRuleId: loaded.nextRuleId || 1
      };
    } catch (e) {
      console.warn('委托规则数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveData() {
  ensureDataDir();
  const tempFile = dataFile + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, dataFile);
}

function now() {
  return Date.now();
}

function detectCycle(userId, agentId, excludeRuleId = null) {
  const visited = new Set();
  const queue = [agentId];
  
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === userId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    
    const activeRules = data.rules.filter(r => 
      r.enabled && 
      r.delegator_id === current && 
      r.id !== excludeRuleId &&
      isRuleEffective(r)
    );
    
    for (const rule of activeRules) {
      if (!visited.has(rule.agent_id)) {
        queue.push(rule.agent_id);
      }
    }
  }
  
  return false;
}

function isRuleEffective(rule) {
  if (!rule.enabled) return false;
  
  if (rule.mode === DELEGATION_MODES.TIME_RANGE) {
    const currentTime = now();
    const startTime = rule.start_time || 0;
    const endTime = rule.end_time || 0;
    return currentTime >= startTime && currentTime <= endTime;
  }
  
  if (rule.mode === DELEGATION_MODES.TIMEOUT) {
    return true;
  }
  
  return false;
}

function validateRule(rule, { excludeRuleId = null } = {}) {
  if (!rule.delegator_id) {
    return { valid: false, error: '委托人ID不能为空' };
  }
  if (!rule.agent_id) {
    return { valid: false, error: '代理人ID不能为空' };
  }
  if (rule.delegator_id === rule.agent_id) {
    return { valid: false, error: '不能委托给自己' };
  }
  if (!rule.mode || !Object.values(DELEGATION_MODES).includes(rule.mode)) {
    return { valid: false, error: '无效的委托模式' };
  }
  
  if (rule.mode === DELEGATION_MODES.TIME_RANGE) {
    if (!rule.start_time || !rule.end_time) {
      return { valid: false, error: '时间段模式需要指定开始和结束时间' };
    }
    if (rule.start_time >= rule.end_time) {
      return { valid: false, error: '开始时间必须早于结束时间' };
    }
  }
  
  if (rule.mode === DELEGATION_MODES.TIMEOUT) {
    if (!rule.timeout_hours || rule.timeout_hours <= 0) {
      return { valid: false, error: '超时模式需要指定大于0的超时小时数' };
    }
  }
  
  if (detectCycle(rule.delegator_id, rule.agent_id, excludeRuleId)) {
    return { valid: false, error: '检测到委托循环，不能创建环形委托关系' };
  }
  
  return { valid: true };
}

function listRulesByDelegator(delegatorId) {
  loadData();
  return data.rules
    .filter(r => r.delegator_id === delegatorId)
    .sort((a, b) => b.created_at - a.created_at);
}

function listRulesByAgent(agentId) {
  loadData();
  return data.rules
    .filter(r => r.agent_id === agentId && isRuleEffective(r))
    .sort((a, b) => b.created_at - a.created_at);
}

function getRuleById(id) {
  loadData();
  return data.rules.find(r => r.id === id) || null;
}

function createRule({ delegatorId, delegatorName, agentId, agentName, mode, startTime, endTime, timeoutHours, enabled = true }) {
  loadData();
  
  const rule = {
    id: data.nextRuleId++,
    delegator_id: delegatorId,
    delegator_name: delegatorName,
    agent_id: agentId,
    agent_name: agentName,
    mode,
    start_time: startTime || null,
    end_time: endTime || null,
    timeout_hours: timeoutHours || null,
    enabled,
    created_at: now(),
    updated_at: now()
  };
  
  const validation = validateRule(rule);
  if (!validation.valid) {
    return { error: validation.error, status: 400 };
  }
  
  data.rules.push(rule);
  saveData();
  
  return getRuleById(rule.id);
}

function updateRule(id, { agentId, agentName, mode, startTime, endTime, timeoutHours, enabled }) {
  loadData();
  const idx = data.rules.findIndex(r => r.id === id);
  if (idx === -1) return null;
  
  const rule = data.rules[idx];
  
  const updated = {
    ...rule,
    agent_id: agentId !== undefined ? agentId : rule.agent_id,
    agent_name: agentName !== undefined ? agentName : rule.agent_name,
    mode: mode !== undefined ? mode : rule.mode,
    start_time: startTime !== undefined ? startTime : rule.start_time,
    end_time: endTime !== undefined ? endTime : rule.end_time,
    timeout_hours: timeoutHours !== undefined ? timeoutHours : rule.timeout_hours,
    enabled: enabled !== undefined ? enabled : rule.enabled,
    updated_at: now()
  };
  
  const validation = validateRule(updated, { excludeRuleId: id });
  if (!validation.valid) {
    return { error: validation.error, status: 400 };
  }
  
  data.rules[idx] = updated;
  saveData();
  
  return getRuleById(id);
}

function deleteRule(id) {
  loadData();
  const idx = data.rules.findIndex(r => r.id === id);
  if (idx === -1) return false;
  
  data.rules.splice(idx, 1);
  saveData();
  return true;
}

function toggleRuleEnabled(id, enabled) {
  return updateRule(id, { enabled });
}

function findEffectiveDelegation(delegatorId) {
  loadData();
  
  const timeRangeRule = data.rules.find(r =>
    r.delegator_id === delegatorId &&
    r.enabled &&
    r.mode === DELEGATION_MODES.TIME_RANGE &&
    isRuleEffective(r)
  );
  
  if (timeRangeRule) {
    return timeRangeRule;
  }
  
  const timeoutRule = data.rules.find(r =>
    r.delegator_id === delegatorId &&
    r.enabled &&
    r.mode === DELEGATION_MODES.TIMEOUT
  );
  
  return timeoutRule || null;
}

function shouldDelegateByTimeout(rule, todoCreatedAt) {
  if (!rule || rule.mode !== DELEGATION_MODES.TIMEOUT) return false;
  if (!todoCreatedAt) return false;
  
  const timeoutMs = rule.timeout_hours * 60 * 60 * 1000;
  const elapsed = now() - todoCreatedAt;
  
  return elapsed >= timeoutMs;
}

function checkAndProcessTimeoutTodos(getTodos, processDelegate) {
  loadData();
  const timeoutRules = data.rules.filter(r =>
    r.enabled && r.mode === DELEGATION_MODES.TIMEOUT
  );
  
  const results = [];
  
  for (const rule of timeoutRules) {
    const todos = getTodos(rule.delegator_id) || [];
    
    for (const todo of todos) {
      if (todo.delegated_by) continue;
      
      if (shouldDelegateByTimeout(rule, todo.created_at)) {
        try {
          const result = processDelegate(todo, rule);
          results.push(result);
        } catch (e) {
          console.error('处理超时委托失败:', e.message);
        }
      }
    }
  }
  
  return results;
}

loadData();

module.exports = {
  DELEGATION_MODES,
  listRulesByDelegator,
  listRulesByAgent,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  toggleRuleEnabled,
  validateRule,
  isRuleEffective,
  findEffectiveDelegation,
  shouldDelegateByTimeout,
  checkAndProcessTimeoutTodos,
  detectCycle
};
