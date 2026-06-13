const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getUserName } = require('./permissionService');

const dataDir = path.join(__dirname, '..', 'data');
const auditLogFile = path.join(dataDir, 'audit-logs.jsonl');
const auditMetaFile = path.join(dataDir, 'audit-meta.json');

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

function loadMeta() {
  ensureDataDir();
  if (fs.existsSync(auditMetaFile)) {
    try {
      const raw = fs.readFileSync(auditMetaFile, 'utf8');
      const meta = JSON.parse(raw);
      nextLogId = meta.nextLogId || 1;
      lastHash = meta.lastHash || null;
      return true;
    } catch (e) {
      console.warn('[审计] 元数据文件损坏，将从日志文件重建:', e.message);
    }
  }
  return false;
}

function saveMeta() {
  ensureDataDir();
  const tempFile = auditMetaFile + '.tmp';
  const meta = {
    nextLogId,
    lastHash,
    updatedAt: Date.now()
  };
  fs.writeFileSync(tempFile, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tempFile, auditMetaFile);
}

function loadData() {
  if (isLoaded) return;
  ensureDataDir();

  logs = [];
  nextLogId = 1;
  lastHash = null;

  const metaOk = loadMeta();

  if (fs.existsSync(auditLogFile)) {
    try {
      const raw = fs.readFileSync(auditLogFile, 'utf8');
      const lines = raw.split('\n');
      let lineNum = 0;
      let validCount = 0;
      let badLines = 0;

      for (const line of lines) {
        lineNum++;
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const logEntry = JSON.parse(trimmed);
          logs.push(logEntry);
          validCount++;

          if (logEntry.id >= nextLogId) {
            nextLogId = logEntry.id + 1;
          }
          if (logEntry.hash) {
            lastHash = logEntry.hash;
          }
        } catch (e) {
          badLines++;
          console.warn(`[审计] 跳过第 ${lineNum} 行坏数据: ${e.message}`);
        }
      }

      console.log(`[审计] 加载完成: ${validCount} 条有效记录, ${badLines} 条损坏已跳过`);

      if (!metaOk) {
        saveMeta();
        console.log('[审计] 元数据已从日志文件重建');
      }
    } catch (e) {
      console.error('[审计] 读取日志文件失败:', e.message);
    }
  } else {
    console.log('[审计] 日志文件不存在，将创建新文件');
    saveMeta();
  }

  isLoaded = true;
}

function appendLogLine(logEntry) {
  ensureDataDir();

  const line = JSON.stringify(logEntry) + '\n';

  try {
    fs.appendFileSync(auditLogFile, line, 'utf8');

    try {
      const fd = fs.openSync(auditLogFile, 'a');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (fsyncErr) {
      console.warn('[审计] fsync 刷盘失败，数据可能在缓存中:', fsyncErr.message);
    }

    return true;
  } catch (e) {
    console.error('[审计] 追加日志失败:', e.message);
    return false;
  }
}

function getLastHash() {
  return lastHash;
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
    id: nextLogId,
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

  const appendOk = appendLogLine(logEntry);

  if (appendOk) {
    logs.push(logEntry);
    nextLogId++;
    lastHash = logEntry.hash;
    saveMeta();
  } else {
    console.error('[审计] 日志写入失败，未更新内存和元数据');
    return null;
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

  let expectedPrevHash = null;
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];

    if (log.prev_hash !== expectedPrevHash) {
      issues.push({
        logId: log.id,
        type: 'prev_hash_mismatch',
        message: `日志 #${log.id} 的 prev_hash 与前一条日志的 hash 不匹配`
      });
    }

    const computedHash = computeLogHash(log, expectedPrevHash);
    if (log.hash !== computedHash) {
      issues.push({
        logId: log.id,
        type: 'hash_mismatch',
        message: `日志 #${log.id} 的 hash 校验失败，数据可能被篡改`
      });
    }

    expectedPrevHash = log.hash;
  }

  return {
    valid: issues.length === 0,
    totalLogs: logs.length,
    issues,
    storage: {
      format: 'NDJSON (append-only)',
      file: auditLogFile,
      description: '新记录只追加到文件末尾，旧记录永不修改'
    }
  };
}

function migrateLegacyFormat() {
  const legacyFile = path.join(dataDir, 'audit-logs.json');
  if (!fs.existsSync(legacyFile)) {
    return { migrated: false, reason: 'legacy file not found' };
  }

  if (fs.existsSync(auditLogFile)) {
    const stats = fs.statSync(auditLogFile);
    if (stats.size > 0) {
      return { migrated: false, reason: 'new format file already has data' };
    }
  }

  try {
    console.log('[审计] 检测到旧格式日志文件，开始迁移...');
    const raw = fs.readFileSync(legacyFile, 'utf8');
    const legacy = JSON.parse(raw);
    const legacyLogs = legacy.logs || [];

    if (legacyLogs.length === 0) {
      fs.unlinkSync(legacyFile);
      return { migrated: true, count: 0, message: 'legacy file was empty, removed' };
    }

    let migratedCount = 0;
    for (const log of legacyLogs) {
      const ok = appendLogLine(log);
      if (ok) {
        logs.push(log);
        if (log.id >= nextLogId) nextLogId = log.id + 1;
        if (log.hash) lastHash = log.hash;
        migratedCount++;
      }
    }

    saveMeta();

    const backupFile = legacyFile + '.bak';
    fs.renameSync(legacyFile, backupFile);
    console.log(`[审计] 迁移完成: ${migratedCount} 条记录，旧文件已备份为 ${backupFile}`);

    return { migrated: true, count: migratedCount, backup: backupFile };
  } catch (e) {
    console.error('[审计] 迁移失败:', e.message);
    return { migrated: false, error: e.message };
  }
}

if (fs.existsSync(path.join(dataDir, 'audit-logs.json')) && !fs.existsSync(auditLogFile)) {
  migrateLegacyFormat();
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
  migrateLegacyFormat
};
