const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getUserName } = require('./permissionService');

const dataDir = path.join(__dirname, '..', 'data');
const auditFile = path.join(dataDir, 'audit-logs.json');

let logs = [];
let nextLogId = 1;

const OPERATION_TYPES = {
  DOCUMENT_VIEW: 'document.view',
  DOCUMENT_CREATE: 'document.create',
  DOCUMENT_EDIT: 'document.edit',
  DOCUMENT_DELETE: 'document.delete',
  DOCUMENT_REVERT: 'document.revert',
  DOCUMENT_PUBLIC_CHANGE: 'document.public_change',
  TAG_ADD: 'tag.add',
  TAG_REMOVE: 'tag.remove',
  PERMISSION_ADD: 'permission.add',
  PERMISSION_REMOVE: 'permission.remove',
  PERMISSION_CHANGE: 'permission.change',
  TEMPLATE_RENDER: 'template.render',
  REVIEW_CREATE: 'review.create',
  REVIEW_STATUS: 'review.status',
  COMMENT_ADD: 'comment.add',
  COMMENT_RESOLVE: 'comment.resolve',
  PATCH_CREATE: 'patch.create',
  PATCH_MERGE: 'patch.merge',
  VERSION_VIEW: 'version.view',
  VERSION_DIFF: 'version.diff'
};

const RESULT_TYPES = {
  SUCCESS: 'success',
  DENIED: 'denied',
  FAILED: 'failed'
};

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function computeLogHash(logEntry, prevHash) {
  const content = JSON.stringify({
    id: logEntry.id,
    timestamp: logEntry.timestamp,
    user_id: logEntry.user_id,
    operation: logEntry.operation,
    document_id: logEntry.document_id,
    result: logEntry.result,
    params_summary: logEntry.params_summary,
    prev_hash: prevHash
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadData() {
  ensureDataDir();
  if (fs.existsSync(auditFile)) {
    try {
      const raw = fs.readFileSync(auditFile, 'utf8');
      const loaded = JSON.parse(raw);
      logs = loaded.logs || [];
      nextLogId = loaded.nextLogId || 1;
    } catch (e) {
      console.warn('审计日志文件损坏，使用空数据:', e.message);
      logs = [];
      nextLogId = 1;
    }
  }
}

function appendLogFile() {
  ensureDataDir();
  const tempFile = auditFile + '.tmp';
  const data = {
    logs,
    nextLogId,
    exportTime: Date.now()
  };
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, auditFile);
}

function getLastHash() {
  if (logs.length === 0) return null;
  return logs[logs.length - 1].hash;
}

function summarizeParams(obj) {
  if (!obj) return '';
  try {
    const str = JSON.stringify(obj);
    if (str.length <= 200) return str;
    return str.slice(0, 197) + '...';
  } catch (e) {
    return String(obj).slice(0, 200);
  }
}

function createLog({ userId, operation, documentId = null, result = RESULT_TYPES.SUCCESS, params = null, errorMessage = null }) {
  loadData();

  const logEntry = {
    id: nextLogId++,
    timestamp: Date.now(),
    user_id: userId || null,
    user_name: userId ? getUserName(userId) : '匿名用户',
    operation,
    document_id: documentId,
    result,
    params_summary: summarizeParams(params),
    error_message: errorMessage || null
  };

  const prevHash = getLastHash();
  logEntry.prev_hash = prevHash;
  logEntry.hash = computeLogHash(logEntry, prevHash);

  logs.push(logEntry);
  appendLogFile();

  return logEntry;
}

function getLogsByDocument(documentId, { page = 1, pageSize = 20, startTime = null, endTime = null } = {}) {
  loadData();
  let filtered = logs.filter(l => l.document_id === documentId);

  if (startTime) {
    filtered = filtered.filter(l => l.timestamp >= startTime);
  }
  if (endTime) {
    filtered = filtered.filter(l => l.timestamp <= endTime);
  }

  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items: items.map(l => ({ ...l })),
    pagination: {
      page: currentPage,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_next: currentPage < totalPages,
      has_prev: currentPage > 1
    }
  };
}

function getLogsByUser(userId, { page = 1, pageSize = 20, startTime = null, endTime = null } = {}) {
  loadData();
  let filtered = logs.filter(l => l.user_id === userId);

  if (startTime) {
    filtered = filtered.filter(l => l.timestamp >= startTime);
  }
  if (endTime) {
    filtered = filtered.filter(l => l.timestamp <= endTime);
  }

  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items: items.map(l => ({ ...l })),
    pagination: {
      page: currentPage,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_next: currentPage < totalPages,
      has_prev: currentPage > 1
    }
  };
}

function getAllLogs({ page = 1, pageSize = 20, startTime = null, endTime = null, userId = null, documentId = null, operation = null, result = null } = {}) {
  loadData();
  let filtered = [...logs];

  if (userId) {
    filtered = filtered.filter(l => l.user_id === userId);
  }
  if (documentId) {
    filtered = filtered.filter(l => l.document_id === documentId);
  }
  if (operation) {
    filtered = filtered.filter(l => l.operation === operation);
  }
  if (result) {
    filtered = filtered.filter(l => l.result === result);
  }
  if (startTime) {
    filtered = filtered.filter(l => l.timestamp >= startTime);
  }
  if (endTime) {
    filtered = filtered.filter(l => l.timestamp <= endTime);
  }

  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items: items.map(l => ({ ...l })),
    pagination: {
      page: currentPage,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_next: currentPage < totalPages,
      has_prev: currentPage > 1
    }
  };
}

function verifyLogIntegrity() {
  loadData();
  const issues = [];

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const prevHash = i === 0 ? null : logs[i - 1].hash;

    if (log.prev_hash !== prevHash) {
      issues.push({
        logId: log.id,
        type: 'prev_hash_mismatch',
        message: `日志 #${log.id} 的 prev_hash 与前一条日志的 hash 不匹配`
      });
    }

    const expectedHash = computeLogHash(log, prevHash);
    if (log.hash !== expectedHash) {
      issues.push({
        logId: log.id,
        type: 'hash_mismatch',
        message: `日志 #${log.id} 的 hash 校验失败，数据可能被篡改`
      });
    }
  }

  return {
    valid: issues.length === 0,
    totalLogs: logs.length,
    issues
  };
}

loadData();

module.exports = {
  OPERATION_TYPES,
  RESULT_TYPES,
  createLog,
  getLogsByDocument,
  getLogsByUser,
  getAllLogs,
  verifyLogIntegrity
};
