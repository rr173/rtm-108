const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getUserName } = require('./permissionService');

const dataDir = path.join(__dirname, '..', 'data');
const auditLogFile = path.join(dataDir, 'audit-logs.log');
const auditIndexFile = path.join(dataDir, 'audit-index.json');

let logs = [];
let nextLogId = 1;
let lastHash = null;
let isLoaded = false;

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
  VERSION_DIFF: 'version.diff',
  MIRROR_CREATE: 'mirror.create',
  MIRROR_DELETE: 'mirror.delete',
  MIRROR_VERSION_CREATE: 'mirror.version_create',
  PARAGRAPH_TRANSLATE: 'paragraph.translate',
  PARAGRAPH_DELETE_CONFIRM: 'paragraph.delete_confirm',
  MIRROR_SYNC_STATUS_CHANGE: 'mirror.sync_status_change'
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

function computeLogHash(logEntry) {
  const content = JSON.stringify({
    id: logEntry.id,
    timestamp: logEntry.timestamp,
    user_id: logEntry.user_id,
    operation: logEntry.operation,
    document_id: logEntry.document_id,
    result: logEntry.result,
    params_summary: logEntry.params_summary,
    prev_hash: logEntry.prev_hash
  });
  return crypto.createHash('sha256').update(content).digest('hex');
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

function saveIndex() {
  ensureDataDir();
  const indexData = {
    nextLogId,
    lastHash,
    lastLogId: logs.length > 0 ? logs[logs.length - 1].id : 0,
    updatedAt: Date.now()
  };
  const tempFile = auditIndexFile + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(indexData, null, 2), 'utf8');
  fs.renameSync(tempFile, auditIndexFile);
}

function loadIndex() {
  if (fs.existsSync(auditIndexFile)) {
    try {
      const raw = fs.readFileSync(auditIndexFile, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('审计索引文件损坏，将重建:', e.message);
    }
  }
  return null;
}

function loadData() {
  if (isLoaded) return;
  ensureDataDir();

  logs = [];
  nextLogId = 1;
  lastHash = null;

  const index = loadIndex();

  if (!fs.existsSync(auditLogFile)) {
    isLoaded = true;
    saveIndex();
    return;
  }

  let validCount = 0;
  let corruptedCount = 0;
  let lastValidHash = null;
  let lastValidId = 0;

  const rawContent = fs.readFileSync(auditLogFile, 'utf8');
  const lines = rawContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const logEntry = JSON.parse(line);

      const expectedPrevHash = logs.length === 0 ? null : logs[logs.length - 1].hash;
      if (logEntry.prev_hash !== expectedPrevHash) {
        console.warn(`审计日志第${i + 1}行（ID=${logEntry.id}）prev_hash 不匹配，跳过该记录及之后所有记录`);
        corruptedCount += (lines.length - i);
        break;
      }

      const expectedHash = computeLogHash(logEntry);
      if (logEntry.hash !== expectedHash) {
        console.warn(`审计日志第${i + 1}行（ID=${logEntry.id}）hash 校验失败，跳过该记录及之后所有记录`);
        corruptedCount += (lines.length - i);
        break;
      }

      logs.push(logEntry);
      lastValidHash = logEntry.hash;
      lastValidId = logEntry.id;
      validCount++;
    } catch (e) {
      console.warn(`审计日志第${i + 1}行解析失败，跳过该记录及之后所有记录:`, e.message);
      corruptedCount += (lines.length - i);
      break;
    }
  }

  if (logs.length > 0) {
    nextLogId = lastValidId + 1;
    lastHash = lastValidHash;
  } else {
    nextLogId = 1;
    lastHash = null;
  }

  if (corruptedCount > 0) {
    console.warn(`审计日志加载完成：有效 ${validCount} 条，丢弃损坏 ${corruptedCount} 条（从损坏处截断）`);
    truncateCorruptedLogs(validCount);
  } else {
    console.log(`审计日志加载完成：共 ${validCount} 条记录`);
  }

  if (index && logs.length > 0) {
    if (index.lastLogId !== logs[logs.length - 1].id) {
      console.warn('索引与实际日志不一致，重建索引');
      saveIndex();
    }
  }

  isLoaded = true;
}

function truncateCorruptedLogs(validCount) {
  if (validCount === 0) {
    fs.writeFileSync(auditLogFile, '', 'utf8');
    return;
  }

  const rawContent = fs.readFileSync(auditLogFile, 'utf8');
  const lines = rawContent.split('\n');
  let validLines = [];
  let count = 0;

  for (const line of lines) {
    if (line.trim()) {
      if (count < validCount) {
        validLines.push(line);
        count++;
      } else {
        break;
      }
    }
  }

  const tempFile = auditLogFile + '.tmp';
  fs.writeFileSync(tempFile, validLines.join('\n') + (validLines.length > 0 ? '\n' : ''), 'utf8');
  fs.renameSync(tempFile, auditLogFile);
  saveIndex();
  console.log('已截断损坏的审计日志，保留有效部分');
}

function appendLogLine(logEntry) {
  ensureDataDir();
  const line = JSON.stringify(logEntry) + '\n';
  fs.appendFileSync(auditLogFile, line, 'utf8');
}

function createLog({ userId, operation, documentId = null, result = RESULT_TYPES.SUCCESS, params = null, errorMessage = null }) {
  loadData();

  const logEntry = {
    id: nextLogId,
    timestamp: Date.now(),
    user_id: userId || null,
    user_name: userId ? getUserName(userId) : '匿名用户',
    operation,
    document_id: documentId,
    result,
    params_summary: summarizeParams(params),
    error_message: errorMessage || null,
    prev_hash: lastHash
  };

  logEntry.hash = computeLogHash(logEntry);

  try {
    appendLogLine(logEntry);
  } catch (e) {
    console.error('写入审计日志失败:', e.message);
    throw new Error(`审计日志写入失败: ${e.message}`);
  }

  logs.push(logEntry);
  lastHash = logEntry.hash;
  nextLogId++;

  try {
    saveIndex();
  } catch (e) {
    console.warn('保存审计索引失败（不影响日志完整性）:', e.message);
  }

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

    const expectedHash = computeLogHash(log);
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

function simulateWriteFailure() {
  loadData();
  const testEntry = {
    id: nextLogId,
    timestamp: Date.now(),
    user_id: 'test',
    user_name: '测试',
    operation: 'test.failure',
    document_id: null,
    result: 'success',
    params_summary: '{}',
    error_message: null,
    prev_hash: lastHash,
    hash: 'INVALID_HASH_THIS_WILL_CAUSE_VERIFY_FAIL'
  };
  const line = JSON.stringify(testEntry) + '\n';
  fs.appendFileSync(auditLogFile, line, 'utf8');
  console.log('已写入一条损坏的测试日志，下次加载时会被检测并截断');
}

loadData();

module.exports = {
  OPERATION_TYPES,
  RESULT_TYPES,
  createLog,
  getLogsByDocument,
  getLogsByUser,
  getAllLogs,
  verifyLogIntegrity,
  simulateWriteFailure
};
