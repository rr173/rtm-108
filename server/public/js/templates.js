function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = `toast ${type}`;
  }, 3000);
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function loadTemplates() {
  try {
    const response = await fetch('/api/templates');
    const templates = await response.json();
    renderTemplates(templates);
  } catch (e) {
    showToast('加载模板列表失败: ' + e.message, 'error');
  }
}

function renderTemplates(templates) {
  const container = document.getElementById('templateList');

  if (!templates || templates.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>📋 暂无模板</h3>
        <p>点击右上角"新建模板"按钮创建第一个模板</p>
      </div>
    `;
    return;
  }

  container.innerHTML = templates.map(tpl => `
    <div class="card template-card">
      <div class="card-title">
        <div>
          <div style="font-size: 17px; font-weight: 600; margin-bottom: 4px;">${TemplateEngine.escapeHtml(tpl.title)}</div>
          ${tpl.description ? `<div style="font-size: 13px; color: #666;">${TemplateEngine.escapeHtml(tpl.description)}</div>` : ''}
        </div>
        <span class="version-badge">v${tpl.latestVersion}</span>
      </div>
      <div class="template-meta-info">
        <span>📊 ${tpl.variableCount} 个变量</span>
        <span>📝 ${tpl.versionCount} 个版本</span>
        <span>🕐 ${formatDate(tpl.updated_at)}</span>
      </div>
      ${tpl.variables && tpl.variables.length > 0 ? `
        <div class="template-vars">
          <div class="template-vars-label">变量:</div>
          <div>${tpl.variables.slice(0, 8).map(v => `<span class="var-tag">${TemplateEngine.escapeHtml(v)}</span>`).join('')}
          ${tpl.variables.length > 8 ? `<span class="var-tag" style="background: #f0f0f0; color: #999;">+${tpl.variables.length - 8} 更多</span>` : ''}
        </div>
      ` : ''}
      <div class="template-card-actions">
        <button class="btn btn-primary btn-sm" onclick="location.href='/template-editor/${tpl.id}'">✏️ 编辑</button>
        <button class="btn btn-secondary btn-sm" onclick="batchGenerate(${tpl.id})">🚀 批量生成</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${tpl.id}, '${TemplateEngine.escapeHtml(tpl.title).replace(/'/g, "\\'")}')">🗑️ 删除</button>
      </div>
    </div>
  `).join('');
}

function batchGenerate(templateId) {
  location.href = `/template-editor/${templateId}`;
}

async function deleteTemplate(id, title) {
  if (!confirm(`确定要删除模板"${title}"吗？此操作不可恢复。`)) return;

  try {
    const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (result.success) {
      showToast('删除成功', 'success');
      loadTemplates();
    } else {
      showToast('删除失败', 'error');
    }
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

loadTemplates();
