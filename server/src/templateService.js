const fs = require('fs');
const path = require('path');
const { renderTemplate, extractVariables } = require('./templateEngine');
const { createDocument } = require('./documentService');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'templates.json');

let data = {
  templates: [],
  versions: [],
  nextTemplateId: 1,
  nextVersionId: 1
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
        versions: loaded.versions || [],
        nextTemplateId: loaded.nextTemplateId || 1,
        nextVersionId: loaded.nextVersionId || 1
      };
    } catch (e) {
      console.warn('模板数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveData() {
  ensureDataDir();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function now() {
  return Date.now();
}

function listTemplates() {
  loadData();
  return data.templates.map(tpl => {
    const versions = data.versions.filter(v => v.template_id === tpl.id);
    const latestVersion = versions[versions.length - 1];
    const variables = latestVersion ? extractVariables(latestVersion.content) : [];
    return {
      ...tpl,
      versionCount: versions.length,
      latestVersion: latestVersion ? latestVersion.version_number : 0,
      variableCount: variables.length,
      variables: variables,
      updated_at: latestVersion ? latestVersion.created_at : tpl.created_at
    };
  }).sort((a, b) => b.updated_at - a.updated_at);
}

function getTemplateById(id, { reload = true } = {}) {
  if (reload) {
    loadData();
  }
  const tpl = data.templates.find(t => t.id === id);
  if (!tpl) return null;

  const versions = data.versions
    .filter(v => v.template_id === id)
    .sort((a, b) => a.version_number - b.version_number);

  const latestVersion = versions[versions.length - 1];
  const variables = latestVersion ? extractVariables(latestVersion.content) : [];

  return {
    ...tpl,
    versions: versions,
    variables: variables,
    latestContent: latestVersion ? latestVersion.content : ''
  };
}

function createTemplate({ title, content, description = '' }) {
  loadData();

  const tpl = {
    id: data.nextTemplateId++,
    title,
    description,
    created_at: now()
  };

  data.templates.push(tpl);

  const version = {
    id: data.nextVersionId++,
    template_id: tpl.id,
    version_number: 1,
    content,
    commit_message: '初始版本',
    created_at: now()
  };

  data.versions.push(version);
  saveData();

  return getTemplateById(tpl.id);
}

function updateTemplate(id, { content, commit_message = '', title, description }) {
  loadData();

  const tpl = data.templates.find(t => t.id === id);
  if (!tpl) return null;

  if (title !== undefined) tpl.title = title;
  if (description !== undefined) tpl.description = description;

  const versions = data.versions.filter(v => v.template_id === id);
  const latestVersion = versions[versions.length - 1];

  if (content !== undefined && (!latestVersion || latestVersion.content !== content)) {
    const newVersion = {
      id: data.nextVersionId++,
      template_id: id,
      version_number: latestVersion ? latestVersion.version_number + 1 : 1,
      content,
      commit_message: commit_message || `版本 ${latestVersion ? latestVersion.version_number + 1 : 1}`,
      created_at: now()
    };
    data.versions.push(newVersion);
  }

  saveData();
  return getTemplateById(id);
}

function deleteTemplate(id) {
  loadData();

  const tplIndex = data.templates.findIndex(t => t.id === id);
  if (tplIndex === -1) return false;

  data.templates.splice(tplIndex, 1);
  data.versions = data.versions.filter(v => v.template_id !== id);

  saveData();
  return true;
}

function getTemplateVersion(templateId, versionNumber) {
  loadData();
  return data.versions.find(
    v => v.template_id === templateId && v.version_number === versionNumber
  );
}

function renderTemplateById(templateId, variables = {}, { keepMissing = true, versionNumber = null } = {}) {
  loadData();
  const tpl = data.templates.find(t => t.id === templateId);
  if (!tpl) return { error: '模板不存在', status: 404 };

  let version;
  if (versionNumber) {
    version = getTemplateVersion(templateId, versionNumber);
  } else {
    const versions = data.versions
      .filter(v => v.template_id === templateId)
      .sort((a, b) => b.version_number - a.version_number);
    version = versions[0];
  }

  if (!version) return { error: '版本不存在', status: 404 };

  const rendered = renderTemplate(version.content, variables, { keepMissing });
  return {
    template_id: templateId,
    version_number: version.version_number,
    variables: variables,
    content: rendered
  };
}

function batchGenerateDocuments(templateId, variablesList = []) {
  loadData();

  const tpl = data.templates.find(t => t.id === templateId);
  if (!tpl) return { error: '模板不存在', status: 404 };

  if (!Array.isArray(variablesList) || variablesList.length === 0) {
    return { error: '变量数据数组不能为空', status: 400 };
  }

  const versions = data.versions
    .filter(v => v.template_id === templateId)
    .sort((a, b) => b.version_number - a.version_number);
  const latestVersion = versions[0];

  if (!latestVersion) return { error: '模板没有内容版本', status: 400 };

  const generatedDocs = [];

  variablesList.forEach((variables, index) => {
    const rendered = renderTemplate(latestVersion.content, variables, { keepMissing: true });
    const docTitle = `${tpl.title} ${String(index + 1).padStart(2, '0')}`;
    const doc = createDocument({
      title: docTitle,
      content: rendered,
      description: `由模板 #${templateId} 批量生成 (第 ${index + 1}/${variablesList.length} 份)`
    });
    generatedDocs.push({
      document_id: doc.id,
      title: docTitle,
      variables: variables
    });
  });

  return {
    template_id: templateId,
    total: generatedDocs.length,
    documents: generatedDocs
  };
}

loadData();

module.exports = {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateVersion,
  renderTemplateById,
  batchGenerateDocuments,
  saveData,
  loadData
};
