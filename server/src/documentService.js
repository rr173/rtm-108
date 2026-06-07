const fs = require('fs');
const path = require('path');
const { lineDiff } = require('./diffEngine');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'documents.json');

let data = {
  documents: [],
  versions: [],
  tags: [],
  nextDocId: 1,
  nextVersionId: 1,
  nextTagId: 1
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
        documents: loaded.documents || [],
        versions: loaded.versions || [],
        tags: loaded.tags || [],
        nextDocId: loaded.nextDocId || 1,
        nextVersionId: loaded.nextVersionId || 1,
        nextTagId: loaded.nextTagId || 1
      };
    } catch (e) {
      console.warn('文档数据文件损坏，使用空数据:', e.message);
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

function listDocuments() {
  loadData();
  return data.documents.map(doc => {
    const versions = data.versions.filter(v => v.document_id === doc.id);
    const latestVersion = versions[versions.length - 1];
    return {
      ...doc,
      versionCount: versions.length,
      latestVersion: latestVersion ? latestVersion.version_number : 0,
      updated_at: latestVersion ? latestVersion.created_at : doc.created_at
    };
  }).sort((a, b) => b.updated_at - a.updated_at);
}

function getDocumentById(id) {
  loadData();
  const doc = data.documents.find(d => d.id === id);
  if (!doc) return null;

  const versions = data.versions
    .filter(v => v.document_id === id)
    .sort((a, b) => a.version_number - b.version_number);

  const tags = data.tags.filter(t => t.document_id === id);

  return {
    ...doc,
    versions: versions.map(v => ({
      ...v,
      tags: tags.filter(t => t.version_id === v.id).map(t => t.name)
    }))
  };
}

function createDocument({ title, content, description = '' }) {
  loadData();
  
  const doc = {
    id: data.nextDocId++,
    title,
    description,
    created_at: now()
  };

  data.documents.push(doc);

  const version = {
    id: data.nextVersionId++,
    document_id: doc.id,
    version_number: 1,
    content,
    commit_message: '初始版本',
    created_at: now()
  };

  data.versions.push(version);
  saveData();

  return getDocumentById(doc.id);
}

function updateDocument(id, { content, commit_message = '' }) {
  loadData();
  
  const doc = data.documents.find(d => d.id === id);
  if (!doc) return null;

  const versions = data.versions.filter(v => v.document_id === id);
  const latestVersion = versions[versions.length - 1];

  if (latestVersion && latestVersion.content === content) {
    return getDocumentById(id);
  }

  const newVersion = {
    id: data.nextVersionId++,
    document_id: id,
    version_number: latestVersion ? latestVersion.version_number + 1 : 1,
    content,
    commit_message: commit_message || `版本 ${latestVersion ? latestVersion.version_number + 1 : 1}`,
    created_at: now()
  };

  data.versions.push(newVersion);
  saveData();

  return getDocumentById(id);
}

function deleteDocument(id) {
  loadData();
  
  const docIndex = data.documents.findIndex(d => d.id === id);
  if (docIndex === -1) return false;

  data.documents.splice(docIndex, 1);
  data.versions = data.versions.filter(v => v.document_id !== id);
  data.tags = data.tags.filter(t => t.document_id !== id);

  saveData();
  return true;
}

function getVersion(documentId, versionNumber) {
  loadData();
  return data.versions.find(
    v => v.document_id === documentId && v.version_number === versionNumber
  );
}

function diffVersions(documentId, oldVersionNum, newVersionNum) {
  loadData();
  
  const oldVersion = getVersion(documentId, oldVersionNum);
  const newVersion = getVersion(documentId, newVersionNum);

  if (!oldVersion || !newVersion) {
    return null;
  }

  const result = lineDiff(oldVersion.content, newVersion.content);
  
  return {
    document_id: documentId,
    old_version: oldVersionNum,
    new_version: newVersionNum,
    ...result
  };
}

function addTag(documentId, versionId, tagName) {
  loadData();

  const doc = data.documents.find(d => d.id === documentId);
  if (!doc) return null;

  const version = data.versions.find(v => v.id === versionId && v.document_id === documentId);
  if (!version) return null;

  const existingTag = data.tags.find(
    t => t.document_id === documentId && t.version_id === versionId && t.name === tagName
  );
  if (existingTag) return existingTag;

  const tag = {
    id: data.nextTagId++,
    document_id: documentId,
    version_id: versionId,
    name: tagName,
    created_at: now()
  };

  data.tags.push(tag);
  saveData();

  return tag;
}

function removeTag(tagId) {
  loadData();
  
  const index = data.tags.findIndex(t => t.id === tagId);
  if (index === -1) return false;

  data.tags.splice(index, 1);
  saveData();
  return true;
}

function getTagsByDocument(documentId) {
  loadData();
  return data.tags.filter(t => t.document_id === documentId);
}

function revertToVersion(documentId, versionNumber, commit_message = '') {
  loadData();
  
  const version = getVersion(documentId, versionNumber);
  if (!version) return null;

  return updateDocument(documentId, {
    content: version.content,
    commit_message: commit_message || `回退到版本 v${versionNumber}`
  });
}

loadData();

module.exports = {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  getVersion,
  diffVersions,
  addTag,
  removeTag,
  getTagsByDocument,
  revertToVersion
};
