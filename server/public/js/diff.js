let currentDocId = null;
let currentDocument = null;
let selectedOldVersion = null;
let selectedNewVersion = null;
let currentDiffResult = null;
let showOnlyDiff = false;
let currentTagVersionId = null;

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
  }
}

async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
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
    const res = await fetch(`/api/documents/${docId}`);
    const doc = await res.json();
    currentDocument = doc;
    
    document.getElementById('versionPanel').style.display = 'block';
    document.getElementById('docTitle').textContent = doc.title;
    
    renderVersionTimeline(doc.versions);
    updateSelectedVersionsDisplay();
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
              <button class="version-action-btn" onclick="event.stopPropagation(); showTagModal(${v.id})" title="添加标签">🏷️</button>
              <button class="version-action-btn" onclick="event.stopPropagation(); revertToVersion(${v.version_number})" title="回退到此版本">↩️</button>
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
    const res = await fetch(
      `/api/documents/${currentDocId}/diff?old_version=${selectedOldVersion}&new_version=${selectedNewVersion}`
    );
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
        oldHtml += renderLine('unchanged', item.oldIndex + 1, item.value);
        newHtml += renderLine('unchanged', item.newIndex + 1, item.value);
        break;
      case 'added':
        oldHtml += renderLine('empty', '', '');
        newHtml += renderLine('added', item.newIndex + 1, item.value);
        break;
      case 'deleted':
        oldHtml += renderLine('deleted', item.oldIndex + 1, item.value);
        newHtml += renderLine('empty', '', '');
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
  const title = document.getElementById('newDocTitle').value.trim();
  const description = document.getElementById('newDocDesc').value.trim();
  const content = document.getElementById('newDocContent').value;
  
  if (!title) {
    showToast('请输入文档标题', 'error');
    return;
  }
  
  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, description })
    });
    
    if (!res.ok) throw new Error('创建失败');
    
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
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, commit_message: commitMessage })
    });
    
    if (!res.ok) throw new Error('保存失败');
    
    const doc = await res.json();
    currentDocument = doc;
    
    showToast('新版本已保存', 'success');
    hideEditModal();
    renderVersionTimeline(doc.versions);
    loadDocuments();
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

function showTagModal(versionId) {
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
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/versions/${currentTagVersionId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    if (!res.ok) throw new Error('添加失败');
    
    hideTagModal();
    
    const docRes = await fetch(`/api/documents/${currentDocId}`);
    const doc = await docRes.json();
    currentDocument = doc;
    renderVersionTimeline(doc.versions);
    
    showToast('标签添加成功', 'success');
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function revertToVersion(versionNum) {
  if (!confirm(`确定要回退到 v${versionNum} 吗？这将创建一个新版本。`)) {
    return;
  }
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/revert/${versionNum}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (!res.ok) throw new Error('回退失败');
    
    const doc = await res.json();
    currentDocument = doc;
    
    showToast(`已回退到 v${versionNum}，生成新版本`, 'success');
    renderVersionTimeline(doc.versions);
    loadDocuments();
  } catch (e) {
    showToast('回退失败: ' + e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDocuments();
  
  const pathParts = window.location.pathname.split('/');
  const docIdFromUrl = pathParts[pathParts.length - 1];
  if (docIdFromUrl && !isNaN(parseInt(docIdFromUrl))) {
    selectDocument(parseInt(docIdFromUrl));
  }
});
