const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'permissions.json');

let data = {
  permissions: [],
  nextPermissionId: 1
};

const ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer'
};

const ROLE_HIERARCHY = {
  [ROLES.OWNER]: 3,
  [ROLES.EDITOR]: 2,
  [ROLES.VIEWER]: 1
};

const USER_NAMES = {
  'user-admin': '系统管理员',
  'user-editor': '编辑者小王',
  'user-viewer': '只读用户小李'
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
        permissions: loaded.permissions || [],
        nextPermissionId: loaded.nextPermissionId || 1
      };
    } catch (e) {
      console.warn('权限数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveData() {
  ensureDataDir();
  const tempFile = dataFile + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, dataFile);
}

function getUserName(userId) {
  return USER_NAMES[userId] || userId;
}

function getRoleHierarchy(role) {
  return ROLE_HIERARCHY[role] || 0;
}

function hasAtLeastRole(actualRole, requiredRole) {
  return getRoleHierarchy(actualRole) >= getRoleHierarchy(requiredRole);
}

function getUserRoleForDocument(documentId, userId) {
  if (!userId) return null;
  loadData();
  const perm = data.permissions.find(
    p => p.document_id === documentId && p.user_id === userId
  );
  return perm ? perm.role : null;
}

function getDocumentPermissions(documentId) {
  loadData();
  return data.permissions.filter(p => p.document_id === documentId);
}

function getUserDocuments(userId) {
  if (!userId) return [];
  loadData();
  return data.permissions
    .filter(p => p.user_id === userId)
    .map(p => ({
      document_id: p.document_id,
      role: p.role,
      created_at: p.created_at
    }));
}

function setOwner(documentId, ownerId) {
  loadData();
  const existingOwner = data.permissions.find(
    p => p.document_id === documentId && p.role === ROLES.OWNER
  );
  if (existingOwner) {
    existingOwner.user_id = ownerId;
    existingOwner.updated_at = Date.now();
  } else {
    data.permissions.push({
      id: data.nextPermissionId++,
      document_id: documentId,
      user_id: ownerId,
      role: ROLES.OWNER,
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }
  saveData();
  return true;
}

function addCollaborator(documentId, userId, role, addedBy) {
  if (![ROLES.EDITOR, ROLES.VIEWER].includes(role)) {
    return { error: '无效的角色，只能添加 editor 或 viewer' };
  }
  loadData();
  const existing = data.permissions.find(
    p => p.document_id === documentId && p.user_id === userId
  );
  if (existing) {
    return { error: '该用户已在此文档中，如需变更角色请使用修改接口' };
  }
  const perm = {
    id: data.nextPermissionId++,
    document_id: documentId,
    user_id: userId,
    role: role,
    added_by: addedBy || null,
    created_at: Date.now(),
    updated_at: Date.now()
  };
  data.permissions.push(perm);
  saveData();
  return perm;
}

function updateCollaboratorRole(documentId, userId, newRole, updatedBy) {
  if (![ROLES.EDITOR, ROLES.VIEWER].includes(newRole)) {
    return { error: '无效的角色，只能修改为 editor 或 viewer' };
  }
  loadData();
  const perm = data.permissions.find(
    p => p.document_id === documentId && p.user_id === userId
  );
  if (!perm) {
    return { error: '该用户不是此文档的协作者' };
  }
  if (perm.role === ROLES.OWNER) {
    return { error: '不能修改所有者的角色' };
  }
  perm.role = newRole;
  perm.updated_by = updatedBy || null;
  perm.updated_at = Date.now();
  saveData();
  return perm;
}

function removeCollaborator(documentId, userId, removedBy) {
  loadData();
  const idx = data.permissions.findIndex(
    p => p.document_id === documentId && p.user_id === userId
  );
  if (idx === -1) {
    return { error: '该用户不是此文档的协作者' };
  }
  const perm = data.permissions[idx];
  if (perm.role === ROLES.OWNER) {
    return { error: '不能移除文档所有者' };
  }
  const removed = data.permissions.splice(idx, 1)[0];
  removed.removed_by = removedBy || null;
  removed.removed_at = Date.now();
  saveData();
  return removed;
}

function checkPermission(documentId, userId, requiredRole, isPublic) {
  if (isPublic && requiredRole === ROLES.VIEWER) {
    return { allowed: true, role: isPublic ? 'public' : null };
  }
  if (!userId) {
    return { allowed: false, role: null, reason: '需要登录' };
  }
  const userRole = getUserRoleForDocument(documentId, userId);
  if (!userRole) {
    return { allowed: false, role: null, reason: '未被授权访问此文档' };
  }
  if (!hasAtLeastRole(userRole, requiredRole)) {
    return { allowed: false, role: userRole, reason: `需要 ${requiredRole} 以上权限` };
  }
  return { allowed: true, role: userRole };
}

function getPermissionDetailsForDocument(documentId) {
  const perms = getDocumentPermissions(documentId);
  return perms.map(p => ({
    ...p,
    user_name: getUserName(p.user_id),
    added_by_name: p.added_by ? getUserName(p.added_by) : null
  }));
}

function deleteDocumentPermissions(documentId) {
  loadData();
  const before = data.permissions.length;
  data.permissions = data.permissions.filter(p => p.document_id !== documentId);
  const removed = before - data.permissions.length;
  if (removed > 0) {
    saveData();
  }
  return removed;
}

loadData();

module.exports = {
  ROLES,
  ROLE_HIERARCHY,
  USER_NAMES,
  getUserName,
  getUserRoleForDocument,
  getDocumentPermissions,
  getPermissionDetailsForDocument,
  getUserDocuments,
  setOwner,
  addCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  checkPermission,
  hasAtLeastRole,
  deleteDocumentPermissions
};
