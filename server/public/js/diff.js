let currentDocId = null;
let currentDocument = null;
let selectedOldVersion = null;
let selectedNewVersion = null;
let currentDiffResult = null;
let showOnlyDiff = false;
let currentTagVersionId = null;

let currentReview = null;
let currentReviewId = null;
let reviewComments = [];
let ws = null;
let showCommentPanel = false;
let selectedLineComments = null;
let selectedOldLine = null;
let selectedNewLine = null;
let addCommentLineData = null;
let reviewerName = localStorage.getItem('reviewerName') || '';

let currentPatches = [];
let currentConflicts = [];
let currentPatchVersion = null;
let currentConflict = null;
let patchAuthorColors = {};

let currentUserId = localStorage.getItem('currentUserId') || '';
let currentUserRole = null;
let currentPermissions = null;
let canManagePermissions = false;
let currentAuditLogs = [];
let currentAuditLogPage = 1;
let hasMoreAuditLogs = false;
let auditLogPanelExpanded = false;
const PATCH_AUTHOR_PALETTE = [
  { bg: 'rgba(102, 126, 234, 0.25)', border: '#667eea', dot: '#667eea' },
  { bg: 'rgba(255, 107, 107, 0.25)', border: '#ff6b6b', dot: '#ff6b6b' },
  { bg: 'rgba(81, 207, 102, 0.25)', border: '#51cf66', dot: '#51cf66' },
  { bg: 'rgba(255, 212, 59, 0.25)', border: '#ffd43b', dot: '#ffd43b' },
  { bg: 'rgba(173, 127, 255, 0.25)', border: '#ad7fff', dot: '#ad7fff' },
  { bg: 'rgba(255, 159, 67, 0.25)', border: '#ff9f43', dot: '#ff9f43' },
  { bg: 'rgba(72, 207, 173, 0.25)', border: '#48cfad', dot: '#48cfad' },
  { bg: 'rgba(236, 100, 155, 0.25)', border: '#ec649b', dot: '#ec649b' }
];

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (currentUserId) {
    headers['X-User-Id'] = currentUserId;
  }
  return fetch(url, { ...options, headers });
}

function changeCurrentUser(userId) {
  currentUserId = userId || '';
  localStorage.setItem('currentUserId', currentUserId);
  showToast(userId ? `已切换为用户: ${userId}` : '已切换为匿名用户', 'info');
  currentDocId = null;
  currentDocument = null;
  selectedOldVersion = null;
  selectedNewVersion = null;
  currentDiffResult = null;
  document.getElementById('versionPanel').style.display = 'none';
  document.getElementById('permissionPanel').style.display = 'none';
  document.getElementById('auditLogPanel').style.display = 'none';
  document.getElementById('reviewPanel').style.display = 'none';
  document.getElementById('patchPanel').style.display = 'none';
  document.getElementById('diffEmptyState').style.display = 'flex';
  document.getElementById('diffResultPanel').style.display = 'none';
  loadDocuments();
}

const ROLE_LEVELS = {
  'owner': 3,
  'editor': 2,
  'viewer': 1,
  'public': 0,
  null: -1
};

function hasPermission(requiredRole) {
  const userLevel = ROLE_LEVELS[currentUserRole] ?? -1;
  const requiredLevel = ROLE_LEVELS[requiredRole] ?? -1;
  return userLevel >= requiredLevel;
}

function setButtonDisabled(btn, disabled, reason) {
  if (!btn) return;
  btn.disabled = disabled;
  if (disabled && reason) {
    btn.title = reason;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.title = '';
    btn.style.opacity = '';
    btn.style.cursor = '';
  }
}

function initUserSelector() {
  const selectEl = document.getElementById('currentUserSelect');
  if (selectEl && currentUserId) {
    selectEl.value = currentUserId;
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function closeModalOutside(event) {
  if (event.target.classList.contains('modal-overlay')) {
    hideCreateDocModal();
    hideEditModal();
    hideTagModal();
    hideCreateReviewModal();
    hideAddCommentModal();
    hideCreatePatchModal();
    hideConflictResolveModal();
    hideAddCollaboratorModal();
  }
}

async function loadDocuments() {
  try {
    const res = await apiFetch('/api/documents');
    const docs = await res.json();
    renderDocList(docs);
  } catch (e) {
    console.error('加载文档列表失败:', e);
    document.getElementById('docList').innerHTML = `
      <div class="empty-state-small">加载失败</div>
    `;
  }
}

function renderDocList(docs) {
  const listEl = document.getElementById('docList');
  
  if (!docs || docs.length === 0) {
    listEl.innerHTML = `<div class="empty-state-small">暂无文档</div>`;
    return;
  }

  listEl.innerHTML = docs.map(doc => `
    <div class="doc-item ${currentDocId === doc.id ? 'active' : ''}" onclick="selectDocument(${doc.id})">
      <div class="doc-item-title">${escapeHtml(doc.title)}</div>
      <div class="doc-item-meta">
        <span>v${doc.latestVersion} · ${doc.versionCount} 个版本</span>
      </div>
      <div class="doc-item-time">${formatDate(doc.updated_at)}</div>
    </div>
  `).join('');
}

async function selectDocument(docId) {
  currentDocId = docId;
  selectedOldVersion = null;
  selectedNewVersion = null;
  
  try {
    const res = await apiFetch(`/api/documents/${docId}`);
    if (!res.ok) {
      const data = await res.json();
      if (res.status === 403) {
        showToast('无权限访问此文档: ' + (data.error || '权限不足'), 'error');
      } else {
        showToast('加载文档失败: ' + (data.error || res.statusText), 'error');
      }
      return;
    }
    const doc = await res.json();
    currentDocument = doc;
    currentUserRole = doc.current_user_role;
    
    document.getElementById('versionPanel').style.display = 'block';
    document.getElementById('docTitle').textContent = doc.title;
    
    renderVersionTimeline(doc.versions);
    updateSelectedVersionsDisplay();
    updateUIByPermissions();
    
    await loadPermissions();
    await loadAuditLogs();
    loadReviewList();
    
    if (currentDocument && currentDocument.versions && currentDocument.versions.length > 0) {
      const lastVersion = currentDocument.versions[currentDocument.versions.length - 1];
      loadPatches(lastVersion.version_number);
    }
    
    loadDocuments();
  } catch (e) {
    console.error('加载文档失败:', e);
    showToast('加载文档失败', 'error');
  }
}

function renderVersionTimeline(versions) {
  const timelineEl = document.getElementById('versionTimeline');
  
  const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);
  
  timelineEl.innerHTML = sortedVersions.map((v, index) => {
    const isOld = selectedOldVersion === v.version_number;
    const isNew = selectedNewVersion === v.version_number;
    const tagsHtml = (v.tags || []).map(tag => 
      `<span class="version-tag">${escapeHtml(tag)}</span>`
    ).join('');
    
    const canTag = hasPermission('editor');
    const canRevert = hasPermission('owner');
    const tagBtnTitle = canTag ? '添加标签' : '权限不足（需编辑者以上）';
    const revertBtnTitle = canRevert ? '回退到此版本' : '权限不足（需所有者）';
    
    return `
      <div class="version-item ${isOld ? 'selected-old' : ''} ${isNew ? 'selected-new' : ''}" 
           onclick="toggleVersionSelection(${v.version_number})"
           data-version="${v.version_number}">
        <div class="version-dot"></div>
        <div class="version-line ${index === sortedVersions.length - 1 ? 'last' : ''}"></div>
        <div class="version-content">
          <div class="version-header">
            <span class="version-number">v${v.version_number}</span>
            <div class="version-actions">
              <button class="version-action-btn" onclick="event.stopPropagation(); showTagModal(${v.id})" 
                title="${tagBtnTitle}" ${canTag ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;"'}>🏷️</button>
              <button class="version-action-btn" onclick="event.stopPropagation(); revertToVersion(${v.version_number})" 
                title="${revertBtnTitle}" ${canRevert ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;"'}>↩️</button>
            </div>
          </div>
          ${tagsHtml ? `<div class="version-tags">${tagsHtml}</div>` : ''}
          <div class="version-message">${escapeHtml(v.commit_message || '无描述')}</div>
          <div class="version-time">${formatDate(v.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleVersionSelection(versionNum) {
  if (selectedOldVersion === versionNum) {
    selectedOldVersion = null;
  } else if (selectedNewVersion === versionNum) {
    selectedNewVersion = null;
  } else if (selectedOldVersion === null) {
    selectedOldVersion = versionNum;
  } else if (selectedNewVersion === null) {
    selectedNewVersion = versionNum;
    if (selectedOldVersion > selectedNewVersion) {
      [selectedOldVersion, selectedNewVersion] = [selectedNewVersion, selectedOldVersion];
    }
  } else {
    selectedOldVersion = selectedNewVersion;
    selectedNewVersion = versionNum;
    if (selectedOldVersion > selectedNewVersion) {
      [selectedOldVersion, selectedNewVersion] = [selectedNewVersion, selectedOldVersion];
    }
  }
  
  renderVersionTimeline(currentDocument.versions);
  updateSelectedVersionsDisplay();
}

function updateSelectedVersionsDisplay() {
  const displayEl = document.getElementById('selectedVersions');
  const compareBtn = document.getElementById('compareBtn');
  
  if (selectedOldVersion !== null && selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} → v${selectedNewVersion}`;
    compareBtn.disabled = false;
  } else if (selectedOldVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} (请再选一个)`;
    compareBtn.disabled = true;
  } else if (selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedNewVersion} (请再选一个)`;
    compareBtn.disabled = true;
  } else {
    displayEl.textContent = '-';
    compareBtn.disabled = true;
  }
}

function clearSelection() {
  selectedOldVersion = null;
  selectedNewVersion = null;
  renderVersionTimeline(currentDocument.versions);
  updateSelectedVersionsDisplay();
}

async function compareVersions() {
  if (!currentDocId || selectedOldVersion === null || selectedNewVersion === null) {
    showToast('请选择两个版本进行对比', 'error');
    return;
  }

  try {
    const res = await apiFetch(
      `/api/documents/${currentDocId}/diff?old_version=${selectedOldVersion}&new_version=${selectedNewVersion}`
    );
    if (!res.ok) {
      const data = await res.json();
      if (res.status === 403) {
        showToast('无权限对比: ' + (data.error || '权限不足'), 'error');
      } else {
        showToast('对比失败: ' + (data.error || res.statusText), 'error');
      }
      return;
    }
    const result = await res.json();
    currentDiffResult = result;
    
    renderDiffResult(result);
  } catch (e) {
    console.error('对比失败:', e);
    showToast('对比失败: ' + e.message, 'error');
  }
}

function renderDiffResult(result) {
  document.getElementById('diffEmptyState').style.display = 'none';
  document.getElementById('diffResultPanel').style.display = 'block';
  
  document.getElementById('diffTitle').textContent = 
    `${currentDocument.title} - v${selectedOldVersion} vs v${selectedNewVersion}`;
  
  document.getElementById('oldVersionLabel').textContent = `v${selectedOldVersion} (旧版本)`;
  document.getElementById('newVersionLabel').textContent = `v${selectedNewVersion} (新版本)`;
  
  const stats = result.stats;
  document.getElementById('diffStats').innerHTML = `
    <span class="stat-item stat-added">+ ${stats.added} 新增</span>
    <span class="stat-item stat-deleted">- ${stats.deleted} 删除</span>
    <span class="stat-item stat-modified">~ ${stats.modified} 修改</span>
    <span class="stat-item stat-unchanged"> ${stats.unchanged} 未变</span>
  `;
  
  renderDiffContent(result.diff);
}

function renderDiffContent(diff) {
  const oldContent = document.getElementById('oldDiffContent');
  const newContent = document.getElementById('newDiffContent');
  
  let oldHtml = '';
  let newHtml = '';
  
  diff.forEach((item) => {
    const isDiff = item.type !== 'unchanged';
    
    if (showOnlyDiff && !isDiff) {
      return;
    }
    
    switch (item.type) {
      case 'unchanged':
        oldHtml += renderLine('unchanged', item.oldIndex + 1, item.value, null, 'old');
        newHtml += renderLine('unchanged', item.newIndex + 1, item.value, null, 'new');
        break;
      case 'added':
        oldHtml += renderLine('empty', '', '', null, 'old');
        newHtml += renderLine('added', item.newIndex + 1, item.value, null, 'new');
        break;
      case 'deleted':
        oldHtml += renderLine('deleted', item.oldIndex + 1, item.value, null, 'old');
        newHtml += renderLine('empty', '', '', null, 'new');
        break;
      case 'modified':
        oldHtml += renderLine('modified-old', item.oldIndex + 1, item.oldValue, item.charDiff, 'old');
        newHtml += renderLine('modified-new', item.newIndex + 1, item.newValue, item.charDiff, 'new');
        break;
    }
  });
  
  oldContent.innerHTML = oldHtml;
  newContent.innerHTML = newHtml;
}

function renderLine(type, lineNum, content, charDiff = null, side = null) {
  const lineNumStr = lineNum !== '' ? lineNum : '';
  let contentHtml = escapeHtml(content);
  
  if (charDiff && (type === 'modified-old' || type === 'modified-new')) {
    contentHtml = renderCharDiff(charDiff, side);
  }
  
  const prefix = type === 'added' ? '+' : (type === 'deleted' ? '-' : ' ');
  
  return `
    <div class="diff-line diff-line-${type}">
      <span class="line-number">${lineNumStr}</span>
      <span class="line-prefix">${prefix}</span>
      <span class="line-content">${contentHtml || '&nbsp;'}</span>
    </div>
  `;
}

function renderCharDiff(charDiff, side) {
  let html = '';
  
  charDiff.forEach(char => {
    const escaped = escapeHtml(char.value || ' ');
    if (char.type === 'unchanged') {
      html += `<span>${escaped === ' ' ? '&nbsp;' : escaped}</span>`;
    } else if (char.type === 'added' && side === 'new') {
      html += `<span class="char-added">${escaped === ' ' ? '&nbsp;' : escaped}</span>`;
    } else if (char.type === 'deleted' && side === 'old') {
      html += `<span class="char-deleted">${escaped === ' ' ? '&nbsp;' : escaped}</span>`;
    }
  });
  
  return html;
}

function toggleOnlyDiff() {
  showOnlyDiff = document.getElementById('showOnlyDiff').checked;
  if (currentDiffResult) {
    renderDiffContent(currentDiffResult.diff);
  }
}

function updateUIByPermissions() {
  const editBtn = document.querySelector('#diffResultPanel button[onclick="showEditModal()"]');
  if (editBtn) {
    const canEdit = hasPermission('editor');
    setButtonDisabled(editBtn, !canEdit, canEdit ? '' : '权限不足（需编辑者以上）');
  }
  
  const createReviewBtn = document.getElementById('createReviewBtn');
  if (createReviewBtn) {
    const canCreateReview = hasPermission('editor');
    if (!canCreateReview) {
      createReviewBtn.disabled = true;
      createReviewBtn.title = '权限不足（需编辑者以上）';
      createReviewBtn.style.opacity = '0.5';
      createReviewBtn.style.cursor = 'not-allowed';
    } else {
      createReviewBtn.title = '';
      createReviewBtn.style.opacity = '';
      createReviewBtn.style.cursor = '';
    }
  }
  
  const badgeEl = document.getElementById('currentUserRoleBadge');
  if (badgeEl) {
    const roleMap = {
      'owner': { text: '所有者', class: 'role-owner' },
      'editor': { text: '编辑者', class: 'role-editor' },
      'viewer': { text: '只读者', class: 'role-viewer' },
      'public': { text: '公开访问', class: 'role-public' }
    };
    const role = roleMap[currentUserRole] || { text: '未知', class: 'role-viewer' };
    badgeEl.textContent = role.text;
    badgeEl.className = `role-badge ${role.class}`;
  }
}

async function loadPermissions() {
  if (!currentDocId) return;
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/permissions`);
    if (!res.ok) {
      const data = await res.json();
      if (res.status !== 403) {
        showToast('加载权限失败: ' + (data.error || res.statusText), 'error');
      }
      return;
    }
    const data = await res.json();
    currentPermissions = data.permissions;
    canManagePermissions = data.can_manage;
    currentDocument.is_public = data.is_public;
    renderPermissions(data);
  } catch (e) {
    console.error('加载权限失败:', e);
  }
}

function renderPermissions(data) {
  const panel = document.getElementById('permissionPanel');
  if (!panel) return;
  panel.style.display = 'block';
  
  const visibilitySection = document.getElementById('docVisibilitySection');
  const publicToggle = document.getElementById('isPublicToggle');
  const publicStatusText = document.getElementById('publicStatusText');
  
  if (canManagePermissions) {
    visibilitySection.style.display = 'block';
    publicToggle.checked = data.is_public === true;
    publicStatusText.textContent = data.is_public ? '公开' : '私有';
  } else {
    visibilitySection.style.display = 'none';
  }
  
  const addBtn = document.getElementById('addCollaboratorBtn');
  addBtn.style.display = canManagePermissions ? 'block' : 'none';
  
  const listEl = document.getElementById('collaboratorsList');
  
  if (!currentPermissions || currentPermissions.length === 0) {
    listEl.innerHTML = '<div class="empty-state-small">暂无协作者</div>';
    return;
  }
  
  const roleDisplay = {
    'owner': { text: '所有者', class: 'role-owner', icon: '👑' },
    'editor': { text: '编辑者', class: 'role-editor', icon: '✏️' },
    'viewer': { text: '只读者', class: 'role-viewer', icon: '👁️' }
  };
  
  listEl.innerHTML = currentPermissions.map(p => {
    const role = roleDisplay[p.role] || roleDisplay['viewer'];
    const isOwner = p.role === 'owner';
    const canChange = canManagePermissions && !isOwner;
    
    return `
      <div class="collaborator-item">
        <div class="collaborator-info">
          <div class="collaborator-avatar">${p.user_name ? p.user_name[0].toUpperCase() : '?'}</div>
          <div>
            <div class="collaborator-name">${escapeHtml(p.user_name || p.user_id)}</div>
            <div class="collaborator-id">${escapeHtml(p.user_id)}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${canChange ? `
            <select class="collaborator-role-select" onchange="updateCollaboratorRole('${escapeHtml(p.user_id)}', this.value)" ${canChange ? '' : 'disabled'}>
              <option value="editor" ${p.role === 'editor' ? 'selected' : ''}>编辑者</option>
              <option value="viewer" ${p.role === 'viewer' ? 'selected' : ''}>只读者</option>
            </select>
            <button class="collaborator-remove-btn" onclick="removeCollaborator('${escapeHtml(p.user_id)}')" title="移除协作者">×</button>
          ` : `
            <span class="collaborator-role-badge ${role.class}">${role.icon} ${role.text}</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

async function toggleDocumentPublic(isPublic) {
  if (!currentDocId || !canManagePermissions) return;
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/public`, {
      method: 'PUT',
      body: JSON.stringify({ is_public: isPublic })
    });
    
    if (!res.ok) {
      const data = await res.json();
      showToast('设置失败: ' + (data.error || res.statusText), 'error');
      const toggle = document.getElementById('isPublicToggle');
      if (toggle) toggle.checked = !isPublic;
      return;
    }
    
    document.getElementById('publicStatusText').textContent = isPublic ? '公开' : '私有';
    showToast(isPublic ? '文档已设为公开' : '文档已设为私有', 'success');
    await loadAuditLogs();
  } catch (e) {
    showToast('设置失败: ' + e.message, 'error');
  }
}

function showAddCollaboratorModal() {
  document.getElementById('newCollaboratorUserId').value = '';
  document.getElementById('newCollaboratorRole').value = 'editor';
  document.getElementById('addCollaboratorModal').classList.add('active');
}

function hideAddCollaboratorModal() {
  document.getElementById('addCollaboratorModal').classList.remove('active');
}

async function addCollaborator() {
  if (!currentDocId) return;
  
  const userId = document.getElementById('newCollaboratorUserId').value.trim();
  const role = document.getElementById('newCollaboratorRole').value;
  
  if (!userId) {
    showToast('请输入用户ID', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role })
    });
    
    if (!res.ok) {
      const data = await res.json();
      showToast('添加失败: ' + (data.error || res.statusText), 'error');
      return;
    }
    
    hideAddCollaboratorModal();
    showToast('协作者添加成功', 'success');
    await loadPermissions();
    await loadAuditLogs();
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function updateCollaboratorRole(userId, newRole) {
  if (!currentDocId || !canManagePermissions) return;
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/permissions/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    
    if (!res.ok) {
      const data = await res.json();
      showToast('修改失败: ' + (data.error || res.statusText), 'error');
      return;
    }
    
    showToast('角色已更新', 'success');
    await loadPermissions();
    await loadAuditLogs();
  } catch (e) {
    showToast('修改失败: ' + e.message, 'error');
  }
}

async function removeCollaborator(userId) {
  if (!currentDocId || !canManagePermissions) return;
  
  if (!confirm(`确定要移除协作者 ${userId} 吗？`)) return;
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/permissions/${encodeURIComponent(userId)}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const data = await res.json();
      showToast('移除失败: ' + (data.error || res.statusText), 'error');
      return;
    }
    
    showToast('协作者已移除', 'success');
    await loadPermissions();
    await loadAuditLogs();
  } catch (e) {
    showToast('移除失败: ' + e.message, 'error');
  }
}

const OPERATION_DISPLAY = {
  'document_view': { text: '查看文档', icon: '👁️' },
  'document_create': { text: '创建文档', icon: '📄' },
  'document_edit': { text: '编辑文档', icon: '✏️' },
  'document_delete': { text: '删除文档', icon: '🗑️' },
  'document_revert': { text: '回退版本', icon: '↩️' },
  'document_public_change': { text: '修改公开状态', icon: '🔓' },
  'version_view': { text: '查看版本', icon: '📋' },
  'version_diff': { text: '版本对比', icon: '🔍' },
  'tag_add': { text: '添加标签', icon: '🏷️' },
  'permission_add': { text: '添加协作者', icon: '➕' },
  'permission_remove': { text: '移除协作者', icon: '➖' },
  'permission_change': { text: '修改权限', icon: '🔧' },
  'review_create': { text: '创建评审', icon: '📝' },
  'review_status': { text: '评审状态', icon: '✅' },
  'comment_add': { text: '添加评论', icon: '💬' },
  'comment_resolve': { text: '解决评论', icon: '✔️' },
  'patch_create': { text: '创建补丁', icon: '🔧' },
  'patch_merge': { text: '合并补丁', icon: '🔀' },
  'template_render': { text: '渲染模板', icon: '📄' }
};

const RESULT_DISPLAY = {
  'success': { text: '成功', class: 'result-success' },
  'denied': { text: '拒绝', class: 'result-denied' },
  'failed': { text: '失败', class: 'result-failed' }
};

function getOperationDisplay(op) {
  return OPERATION_DISPLAY[op] || { text: op, icon: '📌' };
}

async function loadAuditLogs(page = 1) {
  if (!currentDocId) return;
  
  try {
    const res = await apiFetch(`/api/audit-logs/document/${currentDocId}?page=${page}&page_size=20`);
    if (!res.ok) {
      if (res.status !== 403) {
        const data = await res.json();
        showToast('加载日志失败: ' + (data.error || res.statusText), 'error');
      }
      return;
    }
    const data = await res.json();
    
    if (page === 1) {
      currentAuditLogs = data.logs || [];
    } else {
      currentAuditLogs = [...currentAuditLogs, ...(data.logs || [])];
    }
    currentAuditLogPage = page;
    hasMoreAuditLogs = data.has_more || false;
    
    renderAuditLogs();
  } catch (e) {
    console.error('加载审计日志失败:', e);
  }
}

async function loadMoreAuditLogs() {
  await loadAuditLogs(currentAuditLogPage + 1);
}

function renderAuditLogs() {
  const panel = document.getElementById('auditLogPanel');
  if (!panel) return;
  panel.style.display = 'block';
  
  const listEl = document.getElementById('auditLogList');
  
  if (!currentAuditLogs || currentAuditLogs.length === 0) {
    listEl.innerHTML = '<div class="empty-state-small">暂无操作记录</div>';
    return;
  }
  
  listEl.innerHTML = currentAuditLogs.map(log => {
    const op = getOperationDisplay(log.operation);
    const result = RESULT_DISPLAY[log.result] || RESULT_DISPLAY['success'];
    
    return `
      <div class="audit-log-item">
        <div class="audit-log-icon">${op.icon}</div>
        <div class="audit-log-content">
          <div class="audit-log-header">
            <span class="audit-log-operation">${op.text}</span>
            <span class="audit-log-result ${result.class}">${result.text}</span>
          </div>
          <div class="audit-log-meta">
            <span>${escapeHtml(log.user_name || log.user_id || '匿名用户')}</span>
            <span class="audit-log-time">${formatDate(log.timestamp)}</span>
          </div>
          ${log.error_message ? `<div class="audit-log-error">${escapeHtml(log.error_message)}</div>` : ''}
          ${log.params_summary ? `<div class="audit-log-params">${escapeHtml(log.params_summary)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function toggleAuditLogPanel() {
  const content = document.getElementById('auditLogContent');
  const icon = document.getElementById('auditLogToggleIcon');
  auditLogPanelExpanded = !auditLogPanelExpanded;
  
  if (auditLogPanelExpanded) {
    content.style.display = 'block';
    icon.textContent = '▲';
  } else {
    content.style.display = 'none';
    icon.textContent = '▼';
  }
}

function showCreateDocModal() {
  document.getElementById('newDocTitle').value = '';
  document.getElementById('newDocDesc').value = '';
  document.getElementById('newDocContent').value = '';
  document.getElementById('createDocModal').classList.add('active');
}

function hideCreateDocModal() {
  document.getElementById('createDocModal').classList.remove('active');
}

async function createDocument() {
  if (!currentUserId) {
    showToast('请先登录后再创建文档', 'error');
    return;
  }
  
  const title = document.getElementById('newDocTitle').value.trim();
  const description = document.getElementById('newDocDesc').value.trim();
  const content = document.getElementById('newDocContent').value;
  
  if (!title) {
    showToast('请输入文档标题', 'error');
    return;
  }
  
  try {
    const res = await apiFetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title, content, description })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '创建失败');
    }
    
    const doc = await res.json();
    showToast('文档创建成功', 'success');
    hideCreateDocModal();
    loadDocuments();
    selectDocument(doc.id);
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

function showEditModal() {
  if (!currentDocument || currentDocument.versions.length === 0) {
    showToast('没有可编辑的文档', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  const latestVersion = currentDocument.versions[currentDocument.versions.length - 1];
  document.getElementById('editContent').value = latestVersion.content;
  document.getElementById('editCommitMsg').value = '';
  document.getElementById('editModal').classList.add('active');
}

function hideEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

async function saveEdit() {
  const content = document.getElementById('editContent').value;
  const commitMessage = document.getElementById('editCommitMsg').value.trim();
  
  if (!currentDocId) {
    showToast('请先选择文档', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, commit_message: commitMessage })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '保存失败');
    }
    
    const doc = await res.json();
    currentDocument = doc;
    
    showToast('新版本已保存', 'success');
    hideEditModal();
    renderVersionTimeline(doc.versions);
    loadPermissions();
    loadAuditLogs();
    loadDocuments();
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

function showTagModal(versionId) {
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  currentTagVersionId = versionId;
  document.getElementById('tagNameInput').value = '';
  document.getElementById('tagModal').classList.add('active');
}

function hideTagModal() {
  document.getElementById('tagModal').classList.remove('active');
  currentTagVersionId = null;
}

async function addTag() {
  const name = document.getElementById('tagNameInput').value.trim();
  
  if (!name) {
    showToast('请输入标签名称', 'error');
    return;
  }
  
  if (!currentDocId || !currentTagVersionId) {
    showToast('参数错误', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/versions/${currentTagVersionId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '添加失败');
    }
    
    hideTagModal();
    
    const docRes = await apiFetch(`/api/documents/${currentDocId}`);
    const doc = await docRes.json();
    currentDocument = doc;
    renderVersionTimeline(doc.versions);
    loadAuditLogs();
    
    showToast('标签添加成功', 'success');
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function revertToVersion(versionNum) {
  if (!hasPermission('owner')) {
    showToast('权限不足（需所有者）', 'error');
    return;
  }
  
  if (!confirm(`确定要回退到 v${versionNum} 吗？这将创建一个新版本。`)) {
    return;
  }
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/revert/${versionNum}`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '回退失败');
    }
    
    const doc = await res.json();
    currentDocument = doc;
    
    showToast(`已回退到 v${versionNum}，生成新版本`, 'success');
    renderVersionTimeline(doc.versions);
    loadPermissions();
    loadAuditLogs();
    loadDocuments();
  } catch (e) {
    showToast('回退失败: ' + e.message, 'error');
  }
}

function connectWebSocket() {
  if (ws) return;
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket 已连接');
    if (currentReviewId) {
      subscribeToReview(currentReviewId);
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error('WebSocket 消息解析失败:', e);
    }
  };
  
  ws.onclose = () => {
    console.log('WebSocket 已断开');
    ws = null;
    setTimeout(() => connectWebSocket(), 3000);
  };
  
  ws.onerror = (e) => {
    console.error('WebSocket 错误:', e);
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'review_status':
      if (data.review) {
        currentReview = data.review;
        updateReviewPanel();
      }
      if (data.comments) {
        reviewComments = data.comments;
        refreshCommentBubbles();
        if (selectedLineComments) {
          updateCommentPanelContent();
        }
      }
      break;
    case 'review_updated':
    case 'review_status_updated':
      if (data.review) {
        currentReview = data.review;
        updateReviewPanel();
        loadReviewList();
      }
      break;
    case 'new_comment':
      if (data.reviewId === currentReviewId && data.comment) {
        loadReviewComments();
      }
      break;
    case 'comment_resolved':
    case 'comment_unresolved':
      if (data.reviewId === currentReviewId && data.comment) {
        loadReviewComments();
      }
      break;
    case 'error':
      showToast(data.message, 'error');
      break;
  }
}

function subscribeToReview(reviewId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'subscribe_review',
      reviewId: reviewId
    }));
  }
}

function unsubscribeFromReview(reviewId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'unsubscribe_review',
      reviewId: reviewId
    }));
  }
}

async function loadReviewList() {
  if (!currentDocId) return;
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/reviews`);
    if (!res.ok) {
      if (res.status === 403) return;
      throw new Error(res.statusText);
    }
    const reviews = await res.json();
    renderReviewList(reviews);
  } catch (e) {
    console.error('加载评审列表失败:', e);
  }
}

function renderReviewList(reviews) {
  const listEl = document.getElementById('reviewList');
  
  if (!reviews || reviews.length === 0) {
    listEl.innerHTML = '<div class="empty-state-small">暂无评审</div>';
    return;
  }
  
  listEl.innerHTML = reviews.map(review => {
    const statusClass = `review-status-${review.status}`;
    const statusText = {
      pending: '待处理',
      approved: '已通过',
      rejected: '已拒绝'
    }[review.status] || review.status;
    
    const mergedBadge = review.merged_version 
      ? `<span class="review-item-badge" style="background: linear-gradient(135deg, #10b981, #059669);">🚀 产出v${review.merged_version}</span>`
      : '';
    
    return `
      <div class="review-item ${currentReviewId === review.id ? 'active' : ''}" 
           onclick="joinReview(${review.id})">
        <div class="review-item-title">${escapeHtml(review.title)}</div>
        <div class="review-item-meta">
          <span>v${review.old_version} → v${review.new_version}</span>
          <span class="review-item-badge ${statusClass}">${statusText}</span>
          ${mergedBadge}
        </div>
        <div class="review-item-time">
          ${review.top_level_comment_count || 0} 条评论 · ${formatDate(review.created_at)}
        </div>
      </div>
    `;
  }).join('');
}

async function joinReview(reviewId) {
  try {
    const res = await apiFetch(`/api/reviews/${reviewId}`);
    const review = await res.json();
    if (!review) {
      showToast('评审不存在', 'error');
      return;
    }
    
    if (currentReviewId && currentReviewId !== reviewId) {
      unsubscribeFromReview(currentReviewId);
    }
    
    currentReview = review;
    currentReviewId = reviewId;
    selectedOldVersion = review.old_version;
    selectedNewVersion = review.new_version;
    
    document.getElementById('reviewPanel').style.display = 'block';
    updateReviewPanel();
    
    await loadDiffForReview();
    await loadReviewComments();
    await loadPatches(review.new_version);
    loadReviewList();
    
    connectWebSocket();
    subscribeToReview(reviewId);
    
  } catch (e) {
    showToast('加入评审失败: ' + e.message, 'error');
  }
}

async function loadDiffForReview() {
  if (!currentDocId || !currentReview) return;
  
  try {
    const res = await apiFetch(
      `/api/documents/${currentDocId}/diff?old_version=${currentReview.old_version}&new_version=${currentReview.new_version}`
    );
    if (!res.ok) {
      const data = await res.json();
      if (res.status === 403) {
        showToast('无权限对比: ' + (data.error || '权限不足'), 'error');
        return;
      }
    }
    const result = await res.json();
    currentDiffResult = result;
    renderDiffResult(result);
  } catch (e) {
    console.error('加载对比结果失败:', e);
    showToast('加载对比结果失败', 'error');
  }
}

async function loadReviewComments() {
  if (!currentReviewId) return;
  
  try {
    const res = await apiFetch(`/api/reviews/${currentReviewId}/comments`);
    const comments = await res.json();
    reviewComments = comments;
    refreshCommentBubbles();
    if (selectedLineComments !== null) {
      selectedLineComments = getCommentsForLine(selectedOldLine, selectedNewLine);
      updateCommentPanelContent();
    }
  } catch (e) {
    console.error('加载评论失败:', e);
  }
}

function refreshCommentBubbles() {
  if (!currentDiffResult) return;
  renderDiffContent(currentDiffResult.diff);
}

function updateReviewPanel() {
  if (!currentReview) return;
  
  document.getElementById('reviewTitle').textContent = currentReview.title;
  document.getElementById('reviewMeta').textContent = 
    `${currentReview.created_by} 创建于 ${formatDate(currentReview.created_at)}`;
  
  const statusBadge = document.getElementById('reviewStatusBadge');
  const statusMap = {
    pending: { text: '待处理', class: 'status-pending' },
    approved: { text: '已通过', class: 'status-approved' },
    rejected: { text: '已拒绝', class: 'status-rejected' }
  };
  const status = statusMap[currentReview.status] || statusMap.pending;
  statusBadge.textContent = status.text;
  statusBadge.className = `review-status-badge ${status.class}`;
  
  let statsHtml = `
    <span class="review-stat">💬 ${currentReview.top_level_comment_count || 0} 条评论</span>
    <span class="review-stat">✅ ${currentReview.resolved_count || 0} 已解决</span>
  `;
  
  if (currentReview.merged_version) {
    statsHtml += `<span class="review-stat" style="background: linear-gradient(135deg, #10b981, #059669);">🚀 已产出 v${currentReview.merged_version}</span>`;
  }
  
  document.getElementById('reviewStats').innerHTML = statsHtml;
  
  const infoBar = document.getElementById('reviewInfoBar');
  infoBar.style.display = 'block';
  let infoText = `当前评审: ${currentReview.title} (${status.text})`;
  if (currentReview.merged_version) {
    infoText += ` · 已合并产出 v${currentReview.merged_version}`;
  }
  document.getElementById('reviewInfoText').textContent = infoText;
}

function showCreateReviewModal() {
  if (selectedOldVersion === null || selectedNewVersion === null) {
    showToast('请先选择两个版本', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  document.getElementById('reviewOldVersion').textContent = `v${selectedOldVersion}`;
  document.getElementById('reviewNewVersion').textContent = `v${selectedNewVersion}`;
  document.getElementById('reviewTitleInput').value = 
    `v${selectedOldVersion} vs v${selectedNewVersion} 评审`;
  document.getElementById('reviewerNameInput').value = reviewerName;
  document.getElementById('createReviewModal').classList.add('active');
}

function hideCreateReviewModal() {
  document.getElementById('createReviewModal').classList.remove('active');
}

async function createReview() {
  const title = document.getElementById('reviewTitleInput').value.trim();
  const created_by = document.getElementById('reviewerNameInput').value.trim();
  
  if (!title) {
    showToast('请输入评审标题', 'error');
    return;
  }
  if (!created_by) {
    showToast('请输入你的名字', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  reviewerName = created_by;
  localStorage.setItem('reviewerName', reviewerName);
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        old_version: selectedOldVersion,
        new_version: selectedNewVersion,
        title,
        created_by
      })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '创建失败');
    }
    
    const review = await res.json();
    hideCreateReviewModal();
    showToast('评审创建成功', 'success');
    
    await joinReview(review.id);
    loadReviewList();
    loadAuditLogs();
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

function showAddCommentModal(oldLine, newLine, side) {
  if (!currentReviewId) {
    showToast('请先加入一个评审', 'error');
    return;
  }
  
  addCommentLineData = { oldLine, newLine, side };
  
  let lineInfo = '';
  if (side === 'old' && oldLine) {
    lineInfo = `旧版本第 ${oldLine} 行`;
  } else if (side === 'new' && newLine) {
    lineInfo = `新版本第 ${newLine} 行`;
  }
  
  document.getElementById('commentLineInfo').textContent = lineInfo;
  document.getElementById('commentAuthorInput').value = reviewerName;
  document.getElementById('commentContentInput').value = '';
  document.getElementById('addCommentModal').classList.add('active');
}

function hideAddCommentModal() {
  document.getElementById('addCommentModal').classList.remove('active');
  addCommentLineData = null;
}

async function submitComment() {
  const author = document.getElementById('commentAuthorInput').value.trim();
  const content = document.getElementById('commentContentInput').value.trim();
  
  if (!author) {
    showToast('请输入你的名字', 'error');
    return;
  }
  if (!content) {
    showToast('请输入评论内容', 'error');
    return;
  }
  
  reviewerName = author;
  localStorage.setItem('reviewerName', reviewerName);
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_line: addCommentLineData?.oldLine,
        new_line: addCommentLineData?.newLine,
        content,
        author
      })
    });
    
    if (!res.ok) throw new Error('提交失败');
    
    hideAddCommentModal();
    showToast('评论已添加', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('提交失败: ' + e.message, 'error');
  }
}

async function submitReply(parentId, content, author) {
  if (!author) {
    showToast('请输入你的名字', 'error');
    return;
  }
  if (!content) {
    showToast('请输入回复内容', 'error');
    return;
  }
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        author,
        parent_id: parentId
      })
    });
    
    if (!res.ok) throw new Error('回复失败');
    
    showToast('回复已添加', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('回复失败: ' + e.message, 'error');
  }
}

async function resolveComment(commentId) {
  try {
    const res = await fetch(`/api/comments/${commentId}/resolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    showToast('已标记为已解决', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function unresolveComment(commentId) {
  try {
    const res = await fetch(`/api/comments/${commentId}/unresolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    showToast('已重新打开', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function approveReview() {
  if (!currentReviewId) return;
  
  if (!confirm('确定要将此评审标记为"通过"吗？')) return;
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' })
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    const review = await res.json();
    currentReview = review;
    updateReviewPanel();
    showToast('评审已通过', 'success');
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function rejectReview() {
  if (!currentReviewId) return;
  
  if (!confirm('确定要将此评审标记为"拒绝"吗？')) return;
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' })
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    const review = await res.json();
    currentReview = review;
    updateReviewPanel();
    showToast('评审已拒绝', 'success');
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

function toggleCommentPanel() {
  showCommentPanel = !showCommentPanel;
  const panel = document.getElementById('commentPanel');
  if (showCommentPanel) {
    panel.style.display = 'flex';
    updateCommentPanelContent();
  } else {
    panel.style.display = 'none';
  }
}

function getCommentsForLine(oldLine, newLine) {
  return reviewComments.filter(c => {
    if (oldLine !== null && c.old_line === oldLine) return true;
    if (newLine !== null && c.new_line === newLine) return true;
    return false;
  });
}

function showLineComments(oldLine, newLine) {
  const comments = getCommentsForLine(oldLine, newLine);
  if (comments.length === 0 && !currentReviewId) {
    showToast('请先加入一个评审才能查看评论', 'error');
    return;
  }
  
  selectedOldLine = oldLine;
  selectedNewLine = newLine;
  selectedLineComments = comments;
  
  if (!showCommentPanel) {
    showCommentPanel = true;
    document.getElementById('commentPanel').style.display = 'flex';
  }
  
  updateCommentPanelContent();
}

function updateCommentPanelContent() {
  const contentEl = document.getElementById('commentPanelContent');
  
  if (!currentReviewId) {
    contentEl.innerHTML = '<div class="empty-state-small">请先加入一个评审</div>';
    return;
  }
  
  if (!selectedLineComments || selectedLineComments.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state-small">
        <p>该位置暂无评论</p>
        <p style="font-size: 12px; color: #999; margin-top: 8px;">点击行号旁的 + 按钮添加评论</p>
      </div>
    `;
    return;
  }
  
  let html = '';
  selectedLineComments.forEach(comment => {
    const resolvedClass = comment.resolved ? 'comment-resolved' : '';
    html += `
      <div class="comment-item ${resolvedClass}">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(comment.author)}</span>
          <span class="comment-time">${formatDate(comment.created_at)}</span>
        </div>
        <div class="comment-content">${escapeHtml(comment.content)}</div>
        <div class="comment-actions">
          ${comment.resolved 
            ? `<button class="comment-action-btn" onclick="unresolveComment(${comment.id})">↩ 重新打开</button>`
            : `<button class="comment-action-btn" onclick="resolveComment(${comment.id})">✓ 标记已解决</button>`
          }
          <button class="comment-action-btn" onclick="toggleReplyForm(${comment.id})">💬 回复</button>
        </div>
        <div id="replyForm-${comment.id}" class="reply-form" style="display: none;">
          <input type="text" id="replyAuthor-${comment.id}" placeholder="你的名字" 
                 value="${escapeHtml(reviewerName)}" class="reply-input">
          <textarea id="replyContent-${comment.id}" placeholder="输入回复内容..." 
                    class="reply-textarea"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitReply(${comment.id}, 
            document.getElementById('replyContent-${comment.id}').value,
            document.getElementById('replyAuthor-${comment.id}').value)">
            发送回复
          </button>
        </div>
        ${comment.replies && comment.replies.length > 0 ? `
          <div class="comment-replies">
            ${comment.replies.map(reply => `
              <div class="comment-reply">
                <div class="comment-header">
                  <span class="comment-author">${escapeHtml(reply.author)}</span>
                  <span class="comment-time">${formatDate(reply.created_at)}</span>
                </div>
                <div class="comment-content">${escapeHtml(reply.content)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  });
  
  contentEl.innerHTML = html;
}

function toggleReplyForm(commentId) {
  const form = document.getElementById(`replyForm-${commentId}`);
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  }
}

function getCommentBubbleCount(oldLine, newLine) {
  const comments = getCommentsForLine(
    oldLine !== undefined ? oldLine : null,
    newLine !== undefined ? newLine : null
  );
  return comments.length;
}

function updateSelectedVersionsDisplay() {
  const displayEl = document.getElementById('selectedVersions');
  const compareBtn = document.getElementById('compareBtn');
  const createReviewBtn = document.getElementById('createReviewBtn');
  
  if (selectedOldVersion !== null && selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} → v${selectedNewVersion}`;
    compareBtn.disabled = false;
    createReviewBtn.disabled = false;
  } else if (selectedOldVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} (请再选一个)`;
    compareBtn.disabled = true;
    createReviewBtn.disabled = true;
  } else if (selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedNewVersion} (请再选一个)`;
    compareBtn.disabled = true;
    createReviewBtn.disabled = true;
  } else {
    displayEl.textContent = '-';
    compareBtn.disabled = true;
    createReviewBtn.disabled = true;
  }
}

function renderLine(type, lineNum, content, charDiff = null, side = null) {
  const lineNumStr = lineNum !== '' ? lineNum : '';
  let contentHtml = escapeHtml(content);
  
  if (charDiff && (type === 'modified-old' || type === 'modified-new')) {
    contentHtml = renderCharDiff(charDiff, side);
  }
  
  const prefix = type === 'added' ? '+' : (type === 'deleted' ? '-' : ' ');
  
  const oldLine = side === 'old' && lineNum !== '' ? lineNum : null;
  const newLine = side === 'new' && lineNum !== '' ? lineNum : null;
  const bubbleCount = currentReviewId ? getCommentBubbleCount(oldLine, newLine) : 0;
  
  const bubbleHtml = bubbleCount > 0 
    ? `<span class="comment-bubble" onclick="event.stopPropagation(); showLineComments(${oldLine || 'null'}, ${newLine || 'null'})">${bubbleCount}</span>`
    : '';
  
  const addCommentBtn = currentReviewId && lineNum !== ''
    ? `<span class="add-comment-btn" onclick="event.stopPropagation(); showAddCommentModal(${oldLine || 'null'}, ${newLine || 'null'}, '${side}')" title="添加评论">+</span>`
    : '';
  
  const patchOverlays = lineNum !== '' ? getPatchOverlaysForLine(lineNum, side) : [];
  const hasConflict = lineNum !== '' ? isLineInConflict(lineNum, side) : false;
  
  let patchOverlayHtml = '';
  let patchClass = '';
  let patchStyle = '';
  
  if (patchOverlays.length > 0 && side === 'old') {
    const colors = patchOverlays.map(p => p.color.border).join(', ');
    patchClass = 'has-patch-overlay';
    
    if (patchOverlays.length === 1) {
      patchStyle = `background: ${patchOverlays[0].color.bg}; border-left: 3px solid ${patchOverlays[0].color.border};`;
    } else {
      const gradientStops = patchOverlays.map((p, i) => {
        const percent = (i / patchOverlays.length) * 100;
        const endPercent = ((i + 1) / patchOverlays.length) * 100;
        return `${p.color.border} ${percent}%, ${p.color.border} ${endPercent}%`;
      }).join(', ');
      patchStyle = `background: linear-gradient(to right, ${patchOverlays.map(p => p.color.bg).join(', ')}); border-left: 3px solid ${patchOverlays[0].color.border};`;
    }
  }
  
  if (hasConflict && side === 'old') {
    patchClass += ' patch-conflict-line';
  }
  
  return `
    <div class="diff-line diff-line-${type} ${patchClass}" 
         style="${patchStyle}"
         onclick="showLineComments(${oldLine || 'null'}, ${newLine || 'null'})">
      ${addCommentBtn}
      <span class="line-number">${lineNumStr}</span>
      <span class="line-prefix">${prefix}</span>
      <span class="line-content">${contentHtml || '&nbsp;'}</span>
      ${bubbleHtml}
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  initUserSelector();
  loadDocuments();
  connectWebSocket();
  
  const pathParts = window.location.pathname.split('/');
  const pathType = pathParts[pathParts.length - 2];
  const idFromUrl = pathParts[pathParts.length - 1];
  
  if (idFromUrl && !isNaN(parseInt(idFromUrl))) {
    const id = parseInt(idFromUrl);
    if (pathType === 'review') {
      selectDocumentFromReview(id);
    } else {
      selectDocument(id);
    }
  }
});

async function selectDocumentFromReview(reviewId) {
  try {
    const res = await apiFetch(`/api/reviews/${reviewId}`);
    const review = await res.json();
    if (!review) {
      showToast('评审不存在', 'error');
      return;
    }
    
    currentDocId = review.document_id;
    
    const docRes = await apiFetch(`/api/documents/${review.document_id}`);
    if (!docRes.ok) {
      const data = await docRes.json();
      if (docRes.status === 403) {
        showToast('无权限访问此文档: ' + (data.error || '权限不足'), 'error');
      } else {
        showToast('加载文档失败: ' + (data.error || docRes.statusText), 'error');
      }
      return;
    }
    const doc = await docRes.json();
    currentDocument = doc;
    currentUserRole = doc.current_user_role;
    
    document.getElementById('versionPanel').style.display = 'block';
    document.getElementById('docTitle').textContent = doc.title;
    renderVersionTimeline(doc.versions);
    updateUIByPermissions();
    loadPermissions();
    loadAuditLogs();
    loadDocuments();
    loadReviewList();
    
    await joinReview(reviewId);
  } catch (e) {
    console.error('加载评审失败:', e);
    showToast('加载评审失败', 'error');
  }
}

function getAuthorColor(author) {
  if (!patchAuthorColors[author]) {
    const index = Object.keys(patchAuthorColors).length % PATCH_AUTHOR_PALETTE.length;
    patchAuthorColors[author] = PATCH_AUTHOR_PALETTE[index];
  }
  return patchAuthorColors[author];
}

async function loadPatches(versionNumber) {
  if (!currentDocId) return;
  
  currentPatchVersion = versionNumber;
  patchAuthorColors = {};
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/patches?version=${versionNumber}`);
    if (!res.ok) {
      if (res.status === 403) return;
      throw new Error(res.statusText);
    }
    currentPatches = await res.json();
    
    const conflictRes = await apiFetch(`/api/documents/${currentDocId}/conflicts?version=${versionNumber}`);
    if (!conflictRes.ok) {
      currentConflicts = [];
    } else {
      currentConflicts = await conflictRes.json();
    }
    
    currentPatches.forEach(p => getAuthorColor(p.created_by));
    
    renderPatchPanel();
    refreshPatchOverlays();
  } catch (e) {
    console.error('加载补丁失败:', e);
  }
}

function renderPatchPanel() {
  const panel = document.getElementById('patchPanel');
  if (!panel) return;
  
  panel.style.display = 'block';
  
  const pendingPatches = currentPatches.filter(p => p.status === 'pending' || p.status === 'accepted');
  document.getElementById('patchCountBadge').textContent = pendingPatches.length;
  
  const hasConflicts = currentConflicts.length > 0;
  const statsEl = document.getElementById('patchStats');
  
  const stats = {
    pending: currentPatches.filter(p => p.status === 'pending').length,
    accepted: currentPatches.filter(p => p.status === 'accepted').length,
    rejected: currentPatches.filter(p => p.status === 'rejected').length,
    merged: currentPatches.filter(p => p.status === 'merged').length
  };
  
  statsEl.innerHTML = `
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <span class="patch-stat patch-stat-pending">待处理 ${stats.pending}</span>
      <span class="patch-stat patch-stat-accepted">已采纳 ${stats.accepted}</span>
      ${hasConflicts ? '<span class="patch-stat patch-stat-conflict">⚠️ 冲突 ' + currentConflicts.length + '</span>' : ''}
    </div>
  `;
  
  const listEl = document.getElementById('patchList');
  
  if (currentPatches.length === 0) {
    listEl.innerHTML = '<div class="empty-state-small">暂无补丁</div>';
    return;
  }
  
  const conflictPatchIds = new Set();
  currentConflicts.forEach(c => {
    conflictPatchIds.add(c.patch1_id);
    conflictPatchIds.add(c.patch2_id);
  });
  
  listEl.innerHTML = currentPatches.map(patch => {
    const color = getAuthorColor(patch.created_by);
    const hasConflict = conflictPatchIds.has(patch.id);
    const statusText = {
      pending: '待处理',
      accepted: '已采纳',
      rejected: '已拒绝',
      merged: '已合并'
    }[patch.status] || patch.status;
    
    const statusClass = `patch-status-${patch.status}`;
    
    return `
      <div class="patch-item ${hasConflict ? 'patch-conflict' : ''} ${statusClass}" 
           onclick="highlightPatch(${patch.id})"
           data-patch-id="${patch.id}">
        <div class="patch-item-header">
          <div class="patch-author-info">
            <span class="patch-author-dot" style="background: ${color.dot}"></span>
            <span class="patch-author-name">${escapeHtml(patch.created_by)}</span>
          </div>
          <span class="patch-status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="patch-item-desc">${escapeHtml(patch.description || '无描述')}</div>
        <div class="patch-item-meta">
          <span>第 ${patch.start_line}-${patch.end_line} 行</span>
          ${hasConflict ? '<span class="patch-conflict-badge">⚠️ 冲突</span>' : ''}
        </div>
        ${patch.status === 'pending' ? `
          <div class="patch-item-actions">
            <button class="patch-action-btn accept" onclick="event.stopPropagation(); acceptPatch(${patch.id})">采纳</button>
            <button class="patch-action-btn reject" onclick="event.stopPropagation(); rejectPatch(${patch.id})">拒绝</button>
            ${hasConflict ? `<button class="patch-action-btn resolve" onclick="event.stopPropagation(); resolvePatchConflict(${patch.id})">解决冲突</button>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
  
  const mergeBtn = document.getElementById('mergeBtn');
  const mergeableCount = stats.pending + stats.accepted;
  mergeBtn.disabled = hasConflicts || mergeableCount === 0;
  if (hasConflicts) {
    mergeBtn.textContent = '🔒 存在冲突，无法合并';
  } else if (mergeableCount === 0) {
    mergeBtn.textContent = '🔀 无可合并补丁';
  } else {
    mergeBtn.textContent = `🔀 一键合并 ${mergeableCount} 个补丁`;
  }
}

function refreshPatchOverlays() {
  if (currentDiffResult && currentPatches.length > 0) {
    renderDiffContent(currentDiffResult.diff);
  }
}

function getPatchOverlaysForLine(lineNum, side) {
  if (!currentPatchVersion || !currentPatches.length) return [];
  
  const overlays = [];
  
  const isOldSide = side === 'old';
  const versionOnSide = isOldSide ? selectedOldVersion : selectedNewVersion;
  
  if (versionOnSide !== currentPatchVersion) return overlays;
  
  currentPatches.forEach(patch => {
    if (patch.status === 'rejected' || patch.status === 'merged') return;
    if (patch.version_number !== currentPatchVersion) return;
    
    if (lineNum >= patch.start_line && lineNum <= patch.end_line) {
      overlays.push({
        patchId: patch.id,
        author: patch.created_by,
        color: getAuthorColor(patch.created_by),
        isConflict: false,
        status: patch.status
      });
    }
  });
  
  return overlays;
}

function isLineInConflict(lineNum, side) {
  if (!currentConflicts.length) return false;
  
  const isOldSide = side === 'old';
  const versionOnSide = isOldSide ? selectedOldVersion : selectedNewVersion;
  
  if (versionOnSide !== currentPatchVersion) return false;
  
  return currentConflicts.some(c => {
    const overlapStart = Math.max(c.patch1.start_line, c.patch2.start_line);
    const overlapEnd = Math.min(c.patch1.end_line, c.patch2.end_line);
    return lineNum >= overlapStart && lineNum <= overlapEnd;
  });
}

function highlightPatch(patchId) {
  const patch = currentPatches.find(p => p.id === patchId);
  if (!patch) return;
  
  const isOldVersion = currentPatchVersion === selectedOldVersion;
  const contentEl = isOldVersion 
    ? document.getElementById('oldDiffContent') 
    : document.getElementById('newDiffContent');
  
  if (!contentEl) return;
  
  const allLines = document.querySelectorAll('.diff-line');
  allLines.forEach(line => {
    line.classList.remove('patch-highlighted');
  });
  
  const lines = contentEl.querySelectorAll('.diff-line');
  lines.forEach(line => {
    const lineNumEl = line.querySelector('.line-number');
    if (lineNumEl) {
      const lineNum = parseInt(lineNumEl.textContent);
      if (lineNum >= patch.start_line && lineNum <= patch.end_line) {
        line.classList.add('patch-highlighted');
        line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });
}

function showCreatePatchModal() {
  if (!currentDocId) {
    showToast('请先选择文档', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  const version = currentPatchVersion || (currentDocument && currentDocument.versions.length > 0 
    ? currentDocument.versions[currentDocument.versions.length - 1].version_number 
    : 1);
  
  document.getElementById('patchAuthorInput').value = reviewerName;
  document.getElementById('patchDescInput').value = '';
  document.getElementById('patchStartLine').value = '';
  document.getElementById('patchEndLine').value = '';
  document.getElementById('patchContentInput').value = '';
  
  document.getElementById('createPatchModal').classList.add('active');
}

function hideCreatePatchModal() {
  document.getElementById('createPatchModal').classList.remove('active');
}

async function submitPatch() {
  const created_by = document.getElementById('patchAuthorInput').value.trim();
  const description = document.getElementById('patchDescInput').value.trim();
  const start_line = parseInt(document.getElementById('patchStartLine').value);
  const end_line = parseInt(document.getElementById('patchEndLine').value);
  const replacement_text = document.getElementById('patchContentInput').value;
  
  if (!created_by) {
    showToast('请输入提交人名字', 'error');
    return;
  }
  if (!start_line || !end_line || start_line > end_line) {
    showToast('请输入有效的行范围', 'error');
    return;
  }
  if (replacement_text === '') {
    showToast('替换内容不能为空', 'error');
    return;
  }
  
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  reviewerName = created_by;
  localStorage.setItem('reviewerName', reviewerName);
  
  const version = currentPatchVersion || (currentDocument && currentDocument.versions.length > 0 
    ? currentDocument.versions[currentDocument.versions.length - 1].version_number 
    : 1);
  
  try {
    const res = await apiFetch(`/api/documents/${currentDocId}/patches`, {
      method: 'POST',
      body: JSON.stringify({
        start_line,
        end_line,
        replacement_text,
        created_by,
        description,
        version_number: version,
        review_id: currentReviewId
      })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '提交失败');
    }
    
    hideCreatePatchModal();
    showToast('补丁提交成功', 'success');
    await loadPatches(version);
    await loadAuditLogs();
    
    if (currentDiffResult) {
      renderDiffContent(currentDiffResult.diff);
    }
  } catch (e) {
    showToast('提交失败: ' + e.message, 'error');
  }
}

async function acceptPatch(patchId) {
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`/api/patches/${patchId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'accepted' })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '操作失败');
    }
    
    showToast('已采纳该补丁', 'success');
    await loadPatches(currentPatchVersion);
    await loadAuditLogs();
    
    if (currentDiffResult) {
      renderDiffContent(currentDiffResult.diff);
    }
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function rejectPatch(patchId) {
  if (!hasPermission('editor')) {
    showToast('权限不足（需编辑者以上）', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`/api/patches/${patchId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'rejected' })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '操作失败');
    }
    
    showToast('已拒绝该补丁', 'success');
    await loadPatches(currentPatchVersion);
    await loadAuditLogs();
    
    if (currentDiffResult) {
      renderDiffContent(currentDiffResult.diff);
    }
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

function resolvePatchConflict(patchId) {
  const conflict = currentConflicts.find(
    c => c.patch1_id === patchId || c.patch2_id === patchId
  );
  
  if (!conflict) {
    showToast('未找到冲突', 'error');
    return;
  }
  
  currentConflict = conflict;
  showConflictResolveModal();
}

function showConflictResolveModal() {
  if (!currentConflict) return;
  
  const { patch1, patch2, overlap_start, overlap_end } = currentConflict;
  
  document.getElementById('conflictPatch1Author').textContent = patch1.created_by;
  document.getElementById('conflictPatch1Lines').textContent = `第 ${patch1.start_line}-${patch1.end_line} 行`;
  document.getElementById('conflictPatch2Author').textContent = patch2.created_by;
  document.getElementById('conflictPatch2Lines').textContent = `第 ${patch2.start_line}-${patch2.end_line} 行`;
  
  document.getElementById('conflictPane1Title').textContent = `${patch1.created_by} 的修改`;
  document.getElementById('conflictPane2Title').textContent = `${patch2.created_by} 的修改`;
  
  const patch1Full = currentPatches.find(p => p.id === patch1.id);
  const patch2Full = currentPatches.find(p => p.id === patch2.id);
  
  document.getElementById('conflictPane1Content').textContent = 
    patch1Full ? patch1Full.replacement_text : patch1.description;
  document.getElementById('conflictPane2Content').textContent = 
    patch2Full ? patch2Full.replacement_text : patch2.description;
  
  document.getElementById('conflictMergeEditor').value = 
    patch1Full ? patch1Full.replacement_text : '';
  
  document.getElementById('conflictResolveModal').classList.add('active');
}

function hideConflictResolveModal() {
  document.getElementById('conflictResolveModal').classList.remove('active');
  currentConflict = null;
}

function chooseLeftPatch() {
  if (!currentConflict) return;
  const patchFull = currentPatches.find(p => p.id === currentConflict.patch1_id);
  if (patchFull) {
    document.getElementById('conflictMergeEditor').value = patchFull.replacement_text;
  }
}

function chooseRightPatch() {
  if (!currentConflict) return;
  const patchFull = currentPatches.find(p => p.id === currentConflict.patch2_id);
  if (patchFull) {
    document.getElementById('conflictMergeEditor').value = patchFull.replacement_text;
  }
}

async function rejectBothPatches() {
  if (!currentConflict) return;
  
  if (!confirm('确定要拒绝这两个冲突的补丁吗？')) return;
  
  try {
    await Promise.all([
      fetch(`/api/patches/${currentConflict.patch1_id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      }),
      fetch(`/api/patches/${currentConflict.patch2_id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      })
    ]);
    
    hideConflictResolveModal();
    showToast('两个补丁均已拒绝', 'success');
    await loadPatches(currentPatchVersion);
    
    if (currentDiffResult) {
      renderDiffContent(currentDiffResult.diff);
    }
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function confirmResolveConflict() {
  if (!currentConflict) return;
  
  const resolvedContent = document.getElementById('conflictMergeEditor').value;
  const patch1Full = currentPatches.find(p => p.id === currentConflict.patch1_id);
  const patch2Full = currentPatches.find(p => p.id === currentConflict.patch2_id);
  
  const leftContent = patch1Full ? patch1Full.replacement_text : '';
  const rightContent = patch2Full ? patch2Full.replacement_text : '';
  
  try {
    if (resolvedContent === leftContent) {
      await fetch(`/api/patches/${currentConflict.patch1_id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'accept' })
      });
      await fetch(`/api/patches/${currentConflict.patch2_id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
    } else if (resolvedContent === rightContent) {
      await fetch(`/api/patches/${currentConflict.patch2_id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'accept' })
      });
      await fetch(`/api/patches/${currentConflict.patch1_id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
    } else {
      await fetch(`/api/patches/${currentConflict.patch1_id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'manual', resolved_content: resolvedContent })
      });
      await fetch(`/api/patches/${currentConflict.patch2_id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
    }
    
    hideConflictResolveModal();
    showToast('冲突已解决', 'success');
    await loadPatches(currentPatchVersion);
    
    if (currentDiffResult) {
      renderDiffContent(currentDiffResult.diff);
    }
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function mergePatches() {
  if (!currentDocId || !currentPatchVersion) {
    showToast('请先选择文档和版本', 'error');
    return;
  }
  
  if (currentConflicts.length > 0) {
    showToast('存在未解决的冲突，请先解决所有冲突', 'error');
    return;
  }
  
  if (!confirm('确定要合并所有待处理和已采纳的补丁吗？这将创建一个新版本。')) {
    return;
  }
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: currentPatchVersion,
        commit_message: '合并评审补丁',
        merged_by: reviewerName || '系统'
      })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || '合并失败');
    }
    
    showToast(`合并成功！已生成 v${data.new_version.version_number}`, 'success');
    
    const docRes = await fetch(`/api/documents/${currentDocId}`);
    const doc = await docRes.json();
    currentDocument = doc;
    renderVersionTimeline(doc.versions);
    loadDocuments();
    
    if (currentReviewId) {
      const reviewRes = await fetch(`/api/reviews/${currentReviewId}`);
      const updatedReview = await reviewRes.json();
      if (updatedReview) {
        currentReview = updatedReview;
        updateReviewPanel();
      }
    }
    loadReviews();
    
    await loadPatches(data.new_version.version_number);
    
    if (currentDiffResult) {
      selectedNewVersion = data.new_version.version_number;
      const diffRes = await fetch(
        `/api/documents/${currentDocId}/diff?old_version=${currentPatchVersion}&new_version=${data.new_version.version_number}`
      );
      currentDiffResult = await diffRes.json();
      renderDiffResult(currentDiffResult);
    }
  } catch (e) {
    showToast('合并失败: ' + e.message, 'error');
  }
}
