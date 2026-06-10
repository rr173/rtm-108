let currentTemplateId = null;
let debounceTimer = null;

const DEMO_TEMPLATES = {
  1: {
    title: '商务合同模板',
    description: '包含签署人变量和条款条件块的合同模板',
    content: `商务合同

合同编号：{{合同编号}}
签订日期：{{签订日期}}

甲方：{{甲方名称}}
地址：{{甲方地址}}

乙方：{{乙方名称}}
地址：{{乙方地址}}

鉴于甲乙双方本着平等互利的原则，经友好协商，达成如下协议：

第一条 合作内容
{{#if 合作内容}}
{{合作内容}}
{{/if}}
{{#if 无合作内容}}
双方同意在以下领域开展合作：技术研发、市场推广等。
{{/if}}

第二条 合同金额
本合同总金额为人民币 {{合同金额}} 元。
{{#if 含税}}
以上金额已包含相关税费。
{{/if}}
{{#if 不含税}}
以上金额不含税费，税费由付款方另行承担。
{{/if}}

第三条 付款方式
{{#if 分期付款}}
1. 合同签订后支付30%预付款
2. 项目中期支付40%进度款
3. 项目验收完成后支付30%尾款
{{/if}}
{{#if 一次性付款}}
合同签订后一次性全额付款。
{{/if}}

第四条 违约责任
任何一方违反本合同约定，应承担相应的违约责任。

第五条 争议解决
因本合同引起的争议，双方应友好协商解决。

签署：

甲方签署人：{{甲方签署人}}
日期：{{甲方签署日期}}

乙方签署人：{{乙方签署人}}
日期：{{乙方签署日期}}
`,
    sampleData: {
      "合同编号": "HT-2024-001",
      "签订日期": "2024年6月15日",
      "甲方名称": "北京科技有限公司",
      "甲方地址": "北京市朝阳区建国路88号",
      "乙方名称": "上海信息技术有限公司",
      "乙方地址": "上海市浦东新区张江路100号",
      "合作内容": "双方同意在软件开发领域开展深度合作，甲方委托乙方开发企业管理系统一套。",
      "无合作内容": false,
      "合同金额": "500000",
      "含税": true,
      "不含税": false,
      "分期付款": true,
      "一次性付款": false,
      "甲方签署人": "张三",
      "甲方签署日期": "2024年6月15日",
      "乙方签署人": "李四",
      "乙方签署日期": "2024年6月16日"
    },
    batchData: [
      {
        "合同编号": "HT-2024-001",
        "签订日期": "2024年6月15日",
        "甲方名称": "北京科技有限公司",
        "甲方地址": "北京市朝阳区建国路88号",
        "乙方名称": "上海信息技术有限公司",
        "乙方地址": "上海市浦东新区张江路100号",
        "合作内容": "软件开发合作",
        "合同金额": "500000",
        "含税": true,
        "分期付款": true,
        "甲方签署人": "张三",
        "甲方签署日期": "2024年6月15日",
        "乙方签署人": "李四",
        "乙方签署日期": "2024年6月16日"
      },
      {
        "合同编号": "HT-2024-002",
        "签订日期": "2024年6月20日",
        "甲方名称": "北京科技有限公司",
        "甲方地址": "北京市朝阳区建国路88号",
        "乙方名称": "广州网络科技有限公司",
        "乙方地址": "广州市天河区珠江新城",
        "无合作内容": true,
        "合同金额": "300000",
        "不含税": true,
        "一次性付款": true,
        "甲方签署人": "王五",
        "甲方签署日期": "2024年6月20日",
        "乙方签署人": "赵六",
        "乙方签署日期": "2024年6月21日"
      }
    ]
  },
  2: {
    title: '批量通知模板',
    description: '包含收件人列表循环块的通知模板',
    content: `通知

发件人：{{发件人}}
主题：{{通知主题}}

亲爱的收件人：

{{#if 重要通知}}
【重要】请务必仔细阅读以下内容：
{{/if}}

{{通知正文}}

{{#each 收件人列表}}
---
致：{{姓名}}
邮箱：{{邮箱}}
{{#if 部门}}
部门：{{部门}}
{{/if}}
{{/each}}

{{#if 需要回复}}
请各位收到请回复确认。
{{/if}}

{{#if 附件列表}}
附件：
{{#each 附件列表}}
- {{文件名}}
{{/each}}
{{/if}}

此致
敬礼！

{{发件人公司}}
{{发送日期}}
`,
    sampleData: {
      "发件人": "人力资源部",
      "通知主题": "2024年度培训通知",
      "重要通知": true,
      "通知正文": "公司将于下周组织年度技能培训，请各位同事积极参加。培训内容包括：项目管理、团队协作、技术提升等课程。",
      "收件人列表": [
        { "姓名": "张三", "邮箱": "zhangsan@company.com", "部门": "技术部" },
        { "姓名": "李四", "邮箱": "lisi@company.com", "部门": "市场部" },
        { "姓名": "王五", "邮箱": "wangwu@company.com", "部门": "产品部" },
        { "姓名": "赵六", "邮箱": "zhaoliu@company.com" }
      ],
      "需要回复": true,
      "附件列表": [
        { "文件名": "培训日程安排.pdf" },
        { "文件名": "培训报名表.docx" }
      ],
      "发件人公司": "北京科技有限公司",
      "发送日期": "2024年6月15日"
    },
    batchData: [
      {
        "发件人": "人力资源部",
        "通知主题": "2024年度培训通知",
        "重要通知": true,
        "通知正文": "公司将于下周组织年度技能培训。",
        "收件人列表": [
          { "姓名": "张三", "邮箱": "zhangsan@company.com", "部门": "技术部" }
        ],
        "发件人公司": "北京科技有限公司",
        "发送日期": "2024年6月15日"
      },
      {
        "发件人": "行政部",
        "通知主题": "办公区域调整通知",
        "通知正文": "因办公区域将于本周末进行调整，请配合搬迁。",
        "收件人列表": [
          { "姓名": "李四", "邮箱": "lisi@company.com" }
        ],
        "发件人公司": "北京科技有限公司",
        "发送日期": "2024年6月16日"
      }
    ]
  }
};

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = `toast ${type}`;
  }, 3000);
}

function getCurrentTemplateId() {
  const match = window.location.pathname.match(/\/template-editor\/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function syncScroll() {
  const textarea = document.getElementById('templateContent');
  const pre = document.getElementById('highlightOverlay');
  pre.scrollTop = textarea.scrollTop;
  pre.scrollLeft = textarea.scrollLeft;
}

function updateHighlight() {
  const textarea = document.getElementById('templateContent');
  const pre = document.getElementById('highlightOverlay');
  const template = textarea.value;
  pre.innerHTML = TemplateEngine.highlightTemplate(template) + '\n';
  syncScroll();
}

function updatePreview() {
  const template = document.getElementById('templateContent').value;
  const variables = getSampleData();
  const { result } = TemplateEngine.renderTemplate(template, variables, { keepMissing: true });
  document.getElementById('previewContent').innerHTML = result;
}

function updateVariableList() {
  const template = document.getElementById('templateContent').value;
  const variables = TemplateEngine.extractVariables(template);
  document.getElementById('varCount').textContent = `${variables.length} 个变量`;

  const tagsContainer = document.getElementById('variableTags');
  if (variables.length === 0) {
    tagsContainer.innerHTML = '<span style="font-size: 12px; color: #999;">暂无变量</span>';
  } else {
    tagsContainer.innerHTML = variables.map(v => `<span class="var-tag">${TemplateEngine.escapeHtml(v)}</span>`).join('');
  }
}

function onTemplateChange() {
  updateHighlight();
  updatePreview();
  updateVariableList();
  updateBatchCount();
}

function getSampleData() {
  const raw = document.getElementById('sampleData').value;
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function validateJson() {
  const raw = document.getElementById('sampleData').value;
  const status = document.getElementById('jsonStatus');
  if (!raw.trim()) {
    status.textContent = '';
    status.className = '';
    return;
  }
  try {
    JSON.parse(raw);
    status.textContent = '✓ JSON 有效';
    status.className = 'json-valid';
  } catch (e) {
    status.textContent = '✗ JSON 无效';
    status.className = 'json-invalid';
  }
}

function formatJson() {
  const raw = document.getElementById('sampleData').value;
  try {
    const data = raw.trim() ? JSON.parse(raw) : {};
    document.getElementById('sampleData').value = JSON.stringify(data, null, 2);
    validateJson();
    updatePreview();
  } catch (e) {
    showToast('JSON 格式错误，无法格式化', 'error');
  }
}

function updateBatchCount() {
  const raw = document.getElementById('batchData').value;
  const countSpan = document.getElementById('batchCount');
  if (!raw.trim()) {
    countSpan.textContent = '将生成 0 份文档';
    return;
  }
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      countSpan.textContent = `将生成 ${data.length} 份文档`;
    } else {
      countSpan.textContent = '数据格式错误（应为数组）';
    }
  } catch (e) {
    countSpan.textContent = 'JSON 格式错误';
  }
}

function loadDemo(type) {
  const demo = DEMO_TEMPLATES[type];
  if (!demo) return;

  if (!document.getElementById('templateTitle').value) {
    document.getElementById('templateTitle').value = demo.title;
  }
  if (!document.getElementById('templateDesc').value) {
    document.getElementById('templateDesc').value = demo.description;
  }
  if (!document.getElementById('templateContent').value) {
    document.getElementById('templateContent').value = demo.content;
  }
  if (!document.getElementById('sampleData').value.trim()) {
    document.getElementById('sampleData').value = JSON.stringify(demo.sampleData, null, 2);
  }
  if (!document.getElementById('batchData').value.trim()) {
    document.getElementById('batchData').value = JSON.stringify(demo.batchData, null, 2);
  }

  onTemplateChange();
  validateJson();
  updateBatchCount();
}

async function saveTemplate() {
  const title = document.getElementById('templateTitle').value.trim();
  const content = document.getElementById('templateContent').value;
  const description = document.getElementById('templateDesc').value.trim();

  if (!title) {
    showToast('请输入模板标题', 'error');
    return;
  }
  if (!content) {
    showToast('请输入模板内容', 'error');
    return;
  }

  try {
    let response;
    if (currentTemplateId) {
      response = await fetch(`/api/templates/${currentTemplateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, description, commit_message: '编辑更新' })
      });
    } else {
      response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, description })
      });
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '保存失败');
    }

    const tpl = await response.json();
    currentTemplateId = tpl.id;
    showTemplateInfo(tpl);
    showToast(currentTemplateId ? '保存成功，已创建新版本' : '创建成功', 'success');
    history.replaceState(null, '', `/template-editor/${tpl.id}`);
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

function showTemplateInfo(tpl) {
  document.getElementById('templateInfo').style.display = 'block';
  document.getElementById('templateId').textContent = tpl.id;
  document.getElementById('templateVersion').textContent = `v${tpl.versions ? tpl.versions.length : 1}`;
}

async function loadTemplate(id) {
  try {
    const response = await fetch(`/api/templates/${id}`);
    if (!response.ok) throw new Error('模板不存在');
    const tpl = await response.json();
    currentTemplateId = id;
    document.getElementById('templateTitle').value = tpl.title;
    document.getElementById('templateDesc').value = tpl.description || '';
    document.getElementById('templateContent').value = tpl.latestContent || '';
    showTemplateInfo(tpl);
    onTemplateChange();

    if (!document.getElementById('sampleData').value.trim()) {
      autoGenerateSampleData(tpl.variables);
    }
  } catch (e) {
    showToast('加载模板失败: ' + e.message, 'error');
  }
}

function autoGenerateSampleData(variables) {
  const data = {};
  variables.forEach(v => {
    if (v.includes('列表') || v.includes('列表') || v.endsWith('s') || v.endsWith('List')) {
      data[v] = [
        { name: '示例1' },
        { name: '示例2' }
      ];
    } else if (v.toLowerCase().includes('if') || v.includes('是否') || v.startsWith('is') || v.startsWith('has')) {
      data[v] = true;
    } else if (v.includes('日期') || v.includes('时间')) {
      data[v] = new Date().toLocaleDateString('zh-CN');
    } else if (v.includes('金额') || v.includes('价格') || v.includes('数量')) {
      data[v] = '10000';
    } else {
      data[v] = `示例${v}`;
    }
  });
  document.getElementById('sampleData').value = JSON.stringify(data, null, 2);
  validateJson();
}

async function batchGenerate() {
  if (!currentTemplateId) {
    showToast('请先保存模板再批量生成', 'error');
    return;
  }

  const raw = document.getElementById('batchData').value;
  let variablesList;
  try {
    variablesList = JSON.parse(raw);
  } catch (e) {
    showToast('批量数据 JSON 格式错误', 'error');
    return;
  }

  if (!Array.isArray(variablesList) || variablesList.length === 0) {
    showToast('批量数据应为非空数组', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/templates/${currentTemplateId}/batch-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables_list: variablesList })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '生成失败');
    }

    const result = await response.json();
    const resultDiv = document.getElementById('batchResult');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div style="padding: 12px; background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 8px;">
        <div style="font-weight: 600; color: #52c41a; margin-bottom: 10px;">✓ 成功生成 ${result.total} 份文档</div>
        ${result.documents.map(doc => `
          <div class="batch-result-item">
            <span>${TemplateEngine.escapeHtml(doc.title)}</span>
            <a href="/diff/${doc.document_id}" target="_blank">查看文档 →</a>
          </div>
        `).join('')}
      </div>
    `;
    showToast(`成功生成 ${result.total} 份文档`, 'success');
  } catch (e) {
    showToast('批量生成失败: ' + e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('templateContent');
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onTemplateChange, 100);
  });
  textarea.addEventListener('scroll', syncScroll);

  const sampleData = document.getElementById('sampleData');
  sampleData.addEventListener('input', () => {
    validateJson();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updatePreview, 150);
  });

  const batchData = document.getElementById('batchData');
  batchData.addEventListener('input', updateBatchCount);

  document.getElementById('saveBtn').addEventListener('click', saveTemplate);
  document.getElementById('batchGenerateBtn').addEventListener('click', batchGenerate);

  const id = getCurrentTemplateId();
  if (id) {
    loadTemplate(id);
  } else {
    onTemplateChange();
  }

  validateJson();
  updateBatchCount();
  syncScroll();
});
