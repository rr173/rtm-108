const fs = require('fs');
const path = require('path');
const { getVersion, getDocumentById, updateDocument, saveData: saveDocumentData, loadData: loadDocumentData } = require('./documentService');
const { updateReview } = require('./reviewService');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'patches.json');

let data = {
  patches: [],
  nextPatchId: 1
};

const PATCH_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  MERGED: 'merged'
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
        patches: loaded.patches || [],
        nextPatchId: loaded.nextPatchId || 1
      };
    } catch (e) {
      console.warn('补丁数据文件损坏，使用空数据:', e.message);
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

function createPatch({ document_id, version_number, start_line, end_line, replacement_text, created_by, description = '', review_id = null }) {
  loadData();

  const version = getVersion(document_id, version_number);
  if (!version) {
    return { error: '版本不存在', status: 404 };
  }

  const lines = version.content.split('\n');
  if (start_line < 1 || end_line > lines.length || start_line > end_line) {
    return { error: '行范围无效', status: 400 };
  }

  const patch = {
    id: data.nextPatchId++,
    document_id,
    version_number,
    start_line,
    end_line,
    replacement_text,
    original_text: lines.slice(start_line - 1, end_line).join('\n'),
    status: PATCH_STATUS.PENDING,
    created_by,
    description,
    review_id,
    created_at: now(),
    updated_at: now()
  };

  data.patches.push(patch);
  saveData();

  return getPatchById(patch.id);
}

function getPatchById(id) {
  loadData();
  const patch = data.patches.find(p => p.id === id);
  return patch || null;
}

function listPatchesByDocument(documentId, { status = null, versionNumber = null } = {}) {
  loadData();
  let patches = data.patches.filter(p => p.document_id === documentId);

  if (status) {
    patches = patches.filter(p => p.status === status);
  }
  if (versionNumber !== null) {
    patches = patches.filter(p => p.version_number === versionNumber);
  }

  return patches.sort((a, b) => b.created_at - a.created_at);
}

function listPatchesByReview(reviewId) {
  loadData();
  return data.patches
    .filter(p => p.review_id === reviewId)
    .sort((a, b) => b.created_at - a.created_at);
}

function updatePatchStatus(id, status) {
  loadData();
  const patch = data.patches.find(p => p.id === id);
  if (!patch) return null;

  if (!Object.values(PATCH_STATUS).includes(status)) {
    return null;
  }

  patch.status = status;
  patch.updated_at = now();
  saveData();

  return getPatchById(id);
}

function deletePatch(id) {
  loadData();
  const index = data.patches.findIndex(p => p.id === id);
  if (index === -1) return false;

  data.patches.splice(index, 1);
  saveData();
  return true;
}

function detectConflicts(documentId, versionNumber) {
  loadData();
  const pendingPatches = data.patches.filter(
    p => p.document_id === documentId &&
         p.version_number === versionNumber &&
         p.status === PATCH_STATUS.PENDING
  );

  const conflicts = [];

  for (let i = 0; i < pendingPatches.length; i++) {
    for (let j = i + 1; j < pendingPatches.length; j++) {
      const p1 = pendingPatches[i];
      const p2 = pendingPatches[j];

      const overlapStart = Math.max(p1.start_line, p2.start_line);
      const overlapEnd = Math.min(p1.end_line, p2.end_line);

      if (overlapStart <= overlapEnd) {
        conflicts.push({
          patch1_id: p1.id,
          patch2_id: p2.id,
          patch1: {
            id: p1.id,
            start_line: p1.start_line,
            end_line: p1.end_line,
            created_by: p1.created_by,
            description: p1.description
          },
          patch2: {
            id: p2.id,
            start_line: p2.start_line,
            end_line: p2.end_line,
            created_by: p2.created_by,
            description: p2.description
          },
          overlap_start: overlapStart,
          overlap_end: overlapEnd
        });
      }
    }
  }

  return conflicts;
}

function hasConflicts(documentId, versionNumber) {
  const conflicts = detectConflicts(documentId, versionNumber);
  return conflicts.length > 0;
}

function resolveConflict(patchId, resolution, resolvedContent = null) {
  loadData();
  const patch = data.patches.find(p => p.id === patchId);
  if (!patch) return { error: '补丁不存在', status: 404 };

  if (resolution === 'accept') {
    patch.status = PATCH_STATUS.ACCEPTED;
  } else if (resolution === 'reject') {
    patch.status = PATCH_STATUS.REJECTED;
  } else if (resolution === 'manual' && resolvedContent !== null) {
    patch.replacement_text = resolvedContent;
    patch.status = PATCH_STATUS.ACCEPTED;
    patch.manually_resolved = true;
  } else {
    return { error: '无效的解决方式', status: 400 };
  }

  patch.updated_at = now();
  saveData();

  return getPatchById(patchId);
}

function applyPatchesToContent(content, patches) {
  const lines = content.split('\n');
  const sortedPatches = [...patches].sort((a, b) => b.start_line - a.start_line);

  let resultLines = [...lines];

  for (const patch of sortedPatches) {
    const replacementLines = patch.replacement_text.split('\n');
    const startIdx = patch.start_line - 1;
    const endIdx = patch.end_line - 1;

    resultLines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines);
  }

  return resultLines.join('\n');
}

function mergePatches(documentId, versionNumber, { commit_message = '', merged_by = '系统' } = {}) {
  loadData();

  const version = getVersion(documentId, versionNumber);
  if (!version) {
    return { error: '版本不存在', status: 404 };
  }

  const conflicts = detectConflicts(documentId, versionNumber);
  if (conflicts.length > 0) {
    return { error: '存在未解决的冲突，请先解决所有冲突后再合并', status: 409, conflicts };
  }

  const acceptedPatches = data.patches.filter(
    p => p.document_id === documentId &&
         p.version_number === versionNumber &&
         p.status === PATCH_STATUS.ACCEPTED
  );

  const pendingPatches = data.patches.filter(
    p => p.document_id === documentId &&
         p.version_number === versionNumber &&
         p.status === PATCH_STATUS.PENDING
  );

  const patchesToMerge = [...acceptedPatches, ...pendingPatches];

  if (patchesToMerge.length === 0) {
    return { error: '没有可合并的补丁', status: 400 };
  }

  try {
    const newContent = applyPatchesToContent(version.content, patchesToMerge);

    const doc = updateDocument(documentId, {
      content: newContent,
      commit_message: commit_message || `合并 ${patchesToMerge.length} 个补丁`,
      skip_save: true
    });

    if (!doc) {
      return { error: '创建新版本失败', status: 500 };
    }

    const newVersionNumber = doc.versions[doc.versions.length - 1].version_number;
    const mergedPatchIds = patchesToMerge.map(p => p.id);
    data.patches.forEach(p => {
      if (mergedPatchIds.includes(p.id)) {
        p.status = PATCH_STATUS.MERGED;
        p.merged_at = now();
        p.merged_by = merged_by;
        p.merged_into_version = newVersionNumber;
        p.updated_at = now();
      }
    });

    const reviewIds = [...new Set(patchesToMerge.map(p => p.review_id).filter(Boolean))];

    saveDocumentData();
    saveData();

    reviewIds.forEach(reviewId => {
      updateReview(reviewId, {
        merged_version: newVersionNumber,
        merged_by: merged_by
      });
    });

    return {
      success: true,
      new_version: doc.versions[doc.versions.length - 1],
      merged_patch_count: patchesToMerge.length,
      merged_patch_ids: mergedPatchIds,
      linked_review_ids: reviewIds
    };
  } catch (e) {
    loadDocumentData();
    loadData();
    return { error: '合并过程中发生错误: ' + e.message, status: 500 };
  }
}

function getPatchStats(documentId, versionNumber) {
  loadData();
  const patches = data.patches.filter(
    p => p.document_id === documentId && p.version_number === versionNumber
  );

  return {
    total: patches.length,
    pending: patches.filter(p => p.status === PATCH_STATUS.PENDING).length,
    accepted: patches.filter(p => p.status === PATCH_STATUS.ACCEPTED).length,
    rejected: patches.filter(p => p.status === PATCH_STATUS.REJECTED).length,
    merged: patches.filter(p => p.status === PATCH_STATUS.MERGED).length,
    has_conflicts: hasConflicts(documentId, versionNumber),
    conflict_count: detectConflicts(documentId, versionNumber).length
  };
}

loadData();

module.exports = {
  PATCH_STATUS,
  createPatch,
  getPatchById,
  listPatchesByDocument,
  listPatchesByReview,
  updatePatchStatus,
  deletePatch,
  detectConflicts,
  hasConflicts,
  resolveConflict,
  mergePatches,
  applyPatchesToContent,
  getPatchStats
};
