const fs = require('fs');
const path = require('path');
const { lineDiff, threeWayMerge } = require('./diffEngine');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'documents.json');

let data = {
  documents: [],
  versions: [],
  tags: [],
  branches: [],
  branchVersions: [],
  mergeRecords: [],
  nextDocId: 1,
  nextVersionId: 1,
  nextTagId: 1,
  nextBranchId: 1,
  nextBranchVersionId: 1,
  nextMergeRecordId: 1
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
        branches: loaded.branches || [],
        branchVersions: loaded.branchVersions || [],
        mergeRecords: loaded.mergeRecords || [],
        nextDocId: loaded.nextDocId || 1,
        nextVersionId: loaded.nextVersionId || 1,
        nextTagId: loaded.nextTagId || 1,
        nextBranchId: loaded.nextBranchId || 1,
        nextBranchVersionId: loaded.nextBranchVersionId || 1,
        nextMergeRecordId: loaded.nextMergeRecordId || 1
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
    if (doc.is_public === undefined) {
      doc.is_public = false;
    }
    if (doc.owner_id === undefined) {
      doc.owner_id = null;
    }
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

function getDocumentById(id, { reload = true } = {}) {
  if (reload) {
    loadData();
  }
  const doc = data.documents.find(d => d.id === id);
  if (!doc) return null;

  if (doc.is_public === undefined) {
    doc.is_public = false;
  }
  if (doc.owner_id === undefined) {
    doc.owner_id = null;
  }

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

function createDocument({ title, content, description = '', owner_id = null, is_public = false }) {
  loadData();
  
  const doc = {
    id: data.nextDocId++,
    title,
    description,
    owner_id,
    is_public: is_public === true,
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

function updateDocument(id, { content, commit_message = '', skip_save = false }) {
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
  
  if (!skip_save) {
    saveData();
  }

  return getDocumentById(id, { reload: !skip_save });
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
  
  const doc = data.documents.find(d => d.id === documentId);
  if (!doc) return null;

  const sourceVersion = getVersion(documentId, versionNumber);
  if (!sourceVersion) return null;

  const versions = data.versions.filter(v => v.document_id === documentId);
  const latestVersion = versions[versions.length - 1];

  const newVersion = {
    id: data.nextVersionId++,
    document_id: documentId,
    version_number: latestVersion ? latestVersion.version_number + 1 : 1,
    content: sourceVersion.content,
    commit_message: commit_message || `回退到版本 v${versionNumber}`,
    created_at: now()
  };

  data.versions.push(newVersion);
  saveData();

  return getDocumentById(documentId);
}

function setDocumentPublic(documentId, isPublic) {
  loadData();
  
  const doc = data.documents.find(d => d.id === documentId);
  if (!doc) return null;

  doc.is_public = isPublic === true;
  doc.updated_at = now();
  saveData();

  return getDocumentById(documentId);
}

function listBranches(documentId) {
  loadData();
  const branches = data.branches.filter(b => b.document_id === documentId);
  
  return branches.map(branch => {
    const branchVersions = data.branchVersions.filter(v => v.branch_id === branch.id);
    const latestVersion = branchVersions[branchVersions.length - 1];
    return {
      ...branch,
      version_count: branchVersions.length,
      latest_version: latestVersion ? latestVersion.version_number : 0
    };
  }).sort((a, b) => b.created_at - a.created_at);
}

function getBranchById(branchId) {
  loadData();
  const branch = data.branches.find(b => b.id === branchId);
  if (!branch) return null;

  const branchVersions = data.branchVersions
    .filter(v => v.branch_id === branchId)
    .sort((a, b) => a.version_number - b.version_number);

  return {
    ...branch,
    versions: branchVersions
  };
}

function createBranch({ document_id, base_version, name, description = '', created_by = '' }) {
  loadData();

  const doc = data.documents.find(d => d.id === document_id);
  if (!doc) {
    return { error: '文档不存在', status: 404 };
  }

  const baseVersion = data.versions.find(
    v => v.document_id === document_id && v.version_number === base_version
  );
  if (!baseVersion) {
    return { error: '基准版本不存在', status: 404 };
  }

  const existingBranch = data.branches.find(
    b => b.document_id === document_id && b.name === name && b.status === 'active'
  );
  if (existingBranch) {
    return { error: '同名活跃分支已存在', status: 400 };
  }

  const branch = {
    id: data.nextBranchId++,
    document_id,
    name,
    description,
    base_version,
    status: 'active',
    created_by,
    created_at: now(),
    merged_at: null,
    merged_into_version: null
  };

  data.branches.push(branch);

  const firstBranchVersion = {
    id: data.nextBranchVersionId++,
    branch_id: branch.id,
    document_id,
    version_number: 1,
    content: baseVersion.content,
    commit_message: `分支起点：主线 v${base_version}`,
    base_version: base_version,
    created_at: now()
  };

  data.branchVersions.push(firstBranchVersion);
  saveData();

  return getBranchById(branch.id);
}

function getBranchVersion(branchId, versionNumber) {
  loadData();
  return data.branchVersions.find(
    v => v.branch_id === branchId && v.version_number === versionNumber
  );
}

function updateBranchContent(branchId, { content, commit_message = '' }) {
  loadData();

  const branch = data.branches.find(b => b.id === branchId);
  if (!branch) {
    return { error: '分支不存在', status: 404 };
  }

  if (branch.status !== 'active') {
    return { error: `分支已${branch.status === 'merged' ? '合并' : '废弃'}，不能编辑`, status: 400 };
  }

  const branchVersions = data.branchVersions.filter(v => v.branch_id === branchId);
  const latestVersion = branchVersions[branchVersions.length - 1];

  if (latestVersion && latestVersion.content === content) {
    return getBranchById(branchId);
  }

  const newVersion = {
    id: data.nextBranchVersionId++,
    branch_id: branchId,
    document_id: branch.document_id,
    version_number: latestVersion ? latestVersion.version_number + 1 : 1,
    content,
    commit_message: commit_message || `分支版本 v${latestVersion ? latestVersion.version_number + 1 : 1}`,
    created_at: now()
  };

  data.branchVersions.push(newVersion);
  saveData();

  return getBranchById(branchId);
}

function updateBranchStatus(branchId, status) {
  loadData();

  const branch = data.branches.find(b => b.id === branchId);
  if (!branch) {
    return { error: '分支不存在', status: 404 };
  }

  if (!['active', 'merged', 'abandoned'].includes(status)) {
    return { error: '无效的状态值', status: 400 };
  }

  branch.status = status;
  if (status === 'merged') {
    branch.merged_at = now();
  }

  saveData();

  return getBranchById(branchId);
}

function previewMerge(branchId) {
  loadData();

  const branch = data.branches.find(b => b.id === branchId);
  if (!branch) {
    return { error: '分支不存在', status: 404 };
  }

  if (branch.status !== 'active') {
    return { error: '只有活跃分支才能合并', status: 400 };
  }

  const doc = data.documents.find(d => d.id === branch.document_id);
  if (!doc) {
    return { error: '文档不存在', status: 404 };
  }

  const mainVersions = data.versions.filter(v => v.document_id === branch.document_id);
  const latestMainVersion = mainVersions[mainVersions.length - 1];
  if (!latestMainVersion) {
    return { error: '主线没有版本', status: 400 };
  }

  const baseVersion = data.versions.find(
    v => v.document_id === branch.document_id && v.version_number === branch.base_version
  );
  if (!baseVersion) {
    return { error: '基准版本不存在', status: 404 };
  }

  const branchVersions = data.branchVersions.filter(v => v.branch_id === branchId);
  const latestBranchVersion = branchVersions[branchVersions.length - 1];
  if (!latestBranchVersion) {
    return { error: '分支没有版本', status: 400 };
  }

  const mergeResult = threeWayMerge(
    baseVersion.content,
    latestMainVersion.content,
    latestBranchVersion.content
  );

  return {
    branch_id: branchId,
    branch_name: branch.name,
    base_version: branch.base_version,
    main_latest_version: latestMainVersion.version_number,
    branch_latest_version: latestBranchVersion.version_number,
    has_conflicts: mergeResult.hasConflicts,
    conflict_count: mergeResult.conflictCount,
    conflicts: mergeResult.conflicts,
    merged_text: mergeResult.hasConflicts ? null : mergeResult.mergedText,
    merge_details: mergeResult.mergeDetails
  };
}

function executeMerge(branchId, { conflict_resolutions = [], commit_message = '', merged_by = '' } = {}) {
  loadData();

  const branch = data.branches.find(b => b.id === branchId);
  if (!branch) {
    return { error: '分支不存在', status: 404 };
  }

  if (branch.status !== 'active') {
    return { error: '只有活跃分支才能合并', status: 400 };
  }

  const doc = data.documents.find(d => d.id === branch.document_id);
  if (!doc) {
    return { error: '文档不存在', status: 404 };
  }

  const mainVersions = data.versions.filter(v => v.document_id === branch.document_id);
  const latestMainVersion = mainVersions[mainVersions.length - 1];

  const baseVersion = data.versions.find(
    v => v.document_id === branch.document_id && v.version_number === branch.base_version
  );

  const branchVersions = data.branchVersions.filter(v => v.branch_id === branchId);
  const latestBranchVersion = branchVersions[branchVersions.length - 1];

  const preview = previewMerge(branchId);
  if (preview.error) {
    return preview;
  }

  let mergedText;

  if (preview.has_conflicts) {
    if (!conflict_resolutions || conflict_resolutions.length !== preview.conflict_count) {
      return {
        error: '存在冲突，需要提供解决方案',
        status: 409,
        conflicts: preview.conflicts
      };
    }

    const details = preview.merge_details;
    const resolvedLines = [];
    let conflictIndex = 0;

    details.forEach(item => {
      if (item.type === 'conflict') {
        const resolution = conflict_resolutions[conflictIndex];
        if (resolution === 'mine' || resolution === 'main') {
          resolvedLines.push(item.mineContent);
        } else if (resolution === 'theirs' || resolution === 'branch') {
          resolvedLines.push(item.theirsContent);
        } else if (typeof resolution === 'string') {
          resolvedLines.push(resolution);
        } else {
          resolvedLines.push(item.mineContent);
        }
        conflictIndex++;
      } else if (item.type === 'unchanged' || 
                 item.type === 'added-from-mine' || 
                 item.type === 'added-from-theirs' || 
                 item.type === 'added-both') {
        resolvedLines.push(item.content);
      } else if (item.type === 'modified-from-mine' || 
                 item.type === 'modified-from-theirs' || 
                 item.type === 'modified-both') {
        resolvedLines.push(item.newContent);
      }
    });

    mergedText = resolvedLines.join('\n');
  } else {
    mergedText = preview.merged_text;
  }

  const newVersion = {
    id: data.nextVersionId++,
    document_id: branch.document_id,
    version_number: latestMainVersion ? latestMainVersion.version_number + 1 : 1,
    content: mergedText,
    commit_message: commit_message || `合并分支 \"${branch.name}\" 到主线`,
    created_at: now(),
    merged_from_branch: branchId,
    merged_by
  };

  data.versions.push(newVersion);

  branch.status = 'merged';
  branch.merged_at = now();
  branch.merged_into_version = newVersion.version_number;

  const mergeRecord = {
    id: data.nextMergeRecordId++,
    document_id: branch.document_id,
    branch_id: branchId,
    branch_name: branch.name,
    base_version: branch.base_version,
    main_version_before: latestMainVersion ? latestMainVersion.version_number : 0,
    main_version_after: newVersion.version_number,
    branch_version: latestBranchVersion.version_number,
    conflict_count: preview.conflict_count,
    merged_by,
    created_at: now()
  };

  data.mergeRecords.push(mergeRecord);
  saveData();

  return {
    success: true,
    new_version: newVersion,
    merge_record: mergeRecord,
    branch: getBranchById(branchId)
  };
}

function getMergeRecordsByDocument(documentId) {
  loadData();
  return data.mergeRecords
    .filter(r => r.document_id === documentId)
    .sort((a, b) => b.created_at - a.created_at);
}

function deleteBranch(branchId) {
  loadData();

  const branch = data.branches.find(b => b.id === branchId);
  if (!branch) {
    return { error: '分支不存在', status: 404 };
  }

  if (branch.status === 'merged') {
    return { error: '已合并的分支不能删除', status: 400 };
  }

  const branchIndex = data.branches.findIndex(b => b.id === branchId);
  data.branches.splice(branchIndex, 1);

  data.branchVersions = data.branchVersions.filter(v => v.branch_id !== branchId);

  saveData();
  return { success: true };
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
  revertToVersion,
  setDocumentPublic,
  listBranches,
  getBranchById,
  createBranch,
  getBranchVersion,
  updateBranchContent,
  updateBranchStatus,
  previewMerge,
  executeMerge,
  getMergeRecordsByDocument,
  deleteBranch,
  saveData: saveData,
  loadData: loadData
};
