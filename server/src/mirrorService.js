const fs = require('fs');
const path = require('path');
const { lineDiff } = require('./diffEngine');
const {
  getDocumentById,
  getVersion,
  saveData: saveDocData,
  loadData: loadDocData
} = require('./documentService');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'mirrors.json');

let data = {
  mirrors: [],
  mirrorVersions: [],
  paragraphMappings: [],
  nextMirrorId: 1,
  nextMirrorVersionId: 1,
  nextMappingId: 1
};

const CLAIM_CONFIG = {
  DEFAULT_DURATION_MS: 30 * 60 * 1000,
  AUTO_RECOVERY_INTERVAL_MS: 60 * 1000
};

const LANGUAGES = {
  'zh-CN': { name: '简体中文', flag: '🇨🇳' },
  'en-US': { name: 'English', flag: '🇺🇸' },
  'ja-JP': { name: '日本語', flag: '🇯🇵' },
  'ko-KR': { name: '한국어', flag: '🇰🇷' },
  'fr-FR': { name: 'Français', flag: '🇫🇷' },
  'de-DE': { name: 'Deutsch', flag: '🇩🇪' },
  'es-ES': { name: 'Español', flag: '🇪🇸' }
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
        mirrors: loaded.mirrors || [],
        mirrorVersions: loaded.mirrorVersions || [],
        paragraphMappings: loaded.paragraphMappings || [],
        nextMirrorId: loaded.nextMirrorId || 1,
        nextMirrorVersionId: loaded.nextMirrorVersionId || 1,
        nextMappingId: loaded.nextMappingId || 1
      };
    } catch (e) {
      console.warn('镜像数据文件损坏，使用空数据:', e.message);
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

function listLanguages() {
  return Object.entries(LANGUAGES).map(([code, info]) => ({ code, ...info }));
}

function getLanguageInfo(code) {
  return LANGUAGES[code] || null;
}

function listMirrorsByDocument(documentId) {
  loadData();
  return data.mirrors.filter(m => m.document_id === documentId).map(m => enrichMirror(m));
}

function getMirrorById(id) {
  loadData();
  const mirror = data.mirrors.find(m => m.id === id);
  return mirror ? enrichMirror(mirror) : null;
}

function getMirrorByDocumentAndLanguage(documentId, languageCode) {
  loadData();
  const mirror = data.mirrors.find(
    m => m.document_id === documentId && m.language_code === languageCode
  );
  return mirror ? enrichMirror(mirror) : null;
}

function enrichMirror(mirror) {
  const versions = data.mirrorVersions
    .filter(v => v.mirror_id === mirror.id)
    .sort((a, b) => a.version_number - b.version_number);

  const latestMirrorVersion = versions[versions.length - 1];

  const mappings = data.paragraphMappings.filter(pm => pm.mirror_id === mirror.id);

  const pendingCount = mappings.filter(
    pm => pm.status === 'outdated' || pm.status === 'new' || pm.status === 'deleted_need_confirm'
  ).length;

  const totalSynced = mappings.filter(pm => pm.status === 'synchronized').length;

  const doc = getDocumentById(mirror.document_id, { reload: false });
  const latestDocVersion = doc ? doc.versions.length : 0;

  return {
    ...mirror,
    language_name: LANGUAGES[mirror.language_code]?.name || mirror.language_code,
    language_flag: LANGUAGES[mirror.language_code]?.flag || '🌐',
    version_count: versions.length,
    latest_mirror_version: latestMirrorVersion ? {
      version_number: latestMirrorVersion.version_number,
      based_on_master_version: latestMirrorVersion.based_on_master_version,
      created_at: latestMirrorVersion.created_at,
      created_by: latestMirrorVersion.created_by,
      commit_message: latestMirrorVersion.commit_message
    } : null,
    synced_master_version: mirror.synced_master_version,
    latest_master_version: latestDocVersion,
    is_fully_synced: mirror.synced_master_version >= latestDocVersion && pendingCount === 0,
    sync_status: mirror.synced_master_version < latestDocVersion ? 'outdated' :
                 pendingCount > 0 ? 'pending' : 'synced',
    pending_paragraph_count: pendingCount,
    synchronized_paragraph_count: totalSynced,
    total_paragraph_count: mappings.length
  };
}

function createMirror({ documentId, languageCode, initialContent = null, createdBy = null }) {
  loadData();

  if (!LANGUAGES[languageCode]) {
    return { error: '不支持的语言代码', status: 400 };
  }

  const existing = data.mirrors.find(
    m => m.document_id === documentId && m.language_code === languageCode
  );
  if (existing) {
    return { error: '该语言的镜像已存在', status: 400 };
  }

  const doc = getDocumentById(documentId, { reload: false });
  if (!doc) {
    return { error: '主文档不存在', status: 404 };
  }

  const latestVersion = doc.versions[doc.versions.length - 1];
  if (!latestVersion) {
    return { error: '主文档没有版本内容', status: 400 };
  }

  const mirror = {
    id: data.nextMirrorId++,
    document_id: documentId,
    language_code: languageCode,
    synced_master_version: latestVersion.version_number,
    created_at: now(),
    updated_at: now()
  };

  data.mirrors.push(mirror);

  const masterLines = latestVersion.content.split('\n');

  if (initialContent) {
    const initialLines = initialContent.split('\n');
    masterLines.forEach((line, idx) => {
      data.paragraphMappings.push({
        id: data.nextMappingId++,
        mirror_id: mirror.id,
        master_line_index: idx,
        master_version: latestVersion.version_number,
        master_content: line,
        translated_content: initialLines[idx] || '',
        status: initialLines[idx] ? 'synchronized' : 'new',
        translator: initialLines[idx] ? (createdBy || 'system-init') : null,
        translated_at: initialLines[idx] ? now() : null
      });
    });
  } else {
    masterLines.forEach((line, idx) => {
      data.paragraphMappings.push({
        id: data.nextMappingId++,
        mirror_id: mirror.id,
        master_line_index: idx,
        master_version: latestVersion.version_number,
        master_content: line,
        translated_content: '',
        status: 'new',
        translator: null,
        translated_at: null
      });
    });
  }

  const assembledContent = assembleMirrorContent(mirror.id);

  const mirrorVersion = {
    id: data.nextMirrorVersionId++,
    mirror_id: mirror.id,
    version_number: 1,
    based_on_master_version: latestVersion.version_number,
    content: assembledContent,
    commit_message: initialContent ? '初始翻译版本' : '创建镜像，待翻译',
    created_at: now(),
    created_by: createdBy || 'system-init'
  };
  data.mirrorVersions.push(mirrorVersion);

  saveData();
  return enrichMirror(mirror);
}

function assembleMirrorContent(mirrorId) {
  const mappings = data.paragraphMappings
    .filter(pm => pm.mirror_id === mirrorId)
    .sort((a, b) => a.master_line_index - b.master_line_index);

  const deletedIndices = mappings
    .filter(pm => pm.status === 'deleted')
    .map(pm => pm.master_line_index);

  const activeMappings = mappings.filter(pm => pm.status !== 'deleted');

  const lines = [];
  activeMappings.forEach(pm => {
    if (pm.translated_content !== undefined && pm.translated_content !== null) {
      lines.push(pm.translated_content);
    } else {
      lines.push(pm.master_content);
    }
  });

  return lines.join('\n');
}

function getParagraphMappings(mirrorId) {
  loadData();
  return data.paragraphMappings
    .filter(pm => pm.mirror_id === mirrorId)
    .sort((a, b) => a.master_line_index - b.master_line_index);
}

function detectChangesOnMasterUpdate(documentId, oldMasterVersion, newMasterVersion) {
  loadData();

  const mirrors = data.mirrors.filter(m => m.document_id === documentId);
  if (mirrors.length === 0) return;

  const oldVersion = getVersion(documentId, oldMasterVersion);
  const newVersion = getVersion(documentId, newMasterVersion);

  if (!oldVersion || !newVersion) return;

  const diffResult = lineDiff(oldVersion.content, newVersion.content);
  const newMasterLines = newVersion.content.split('\n');

  mirrors.forEach(mirror => {
    const pendingMappings = data.paragraphMappings.filter(
      pm => pm.mirror_id === mirror.id &&
        (pm.status === 'outdated' || pm.status === 'new' || pm.status === 'deleted_need_confirm')
    );
    if (pendingMappings.length > 0 && mirror.synced_master_version < oldMasterVersion) {
      return;
    }

    const oldMappings = data.paragraphMappings
      .filter(pm => pm.mirror_id === mirror.id)
      .sort((a, b) => a.master_line_index - b.master_line_index);

    const oldIndexToMapping = new Map();
    oldMappings.forEach(m => oldIndexToMapping.set(m.master_line_index, m));

    const newIndexTrackers = new Map();

    diffResult.diff.forEach(change => {
      if (change.type === 'unchanged') {
        const mapping = oldIndexToMapping.get(change.oldIndex);
        if (mapping) {
          newIndexTrackers.set(change.newIndex, {
            action: 'keep',
            mapping,
            new_master_content: newMasterLines[change.newIndex]
          });
        }
      } else if (change.type === 'modified') {
        const mapping = oldIndexToMapping.get(change.oldIndex);
        if (mapping) {
          newIndexTrackers.set(change.newIndex, {
            action: 'outdate',
            mapping,
            new_master_content: newMasterLines[change.newIndex],
            old_master_content: change.oldValue,
            new_master_diff: change
          });
        }
      } else if (change.type === 'added') {
        newIndexTrackers.set(change.newIndex, {
          action: 'new',
          new_master_content: newMasterLines[change.newIndex]
        });
      } else if (change.type === 'deleted') {
        const mapping = oldIndexToMapping.get(change.oldIndex);
        if (mapping) {
          mapping.status = 'deleted_need_confirm';
          mapping.updated_at = now();
        }
      }
    });

    const newSortedIndices = [...newIndexTrackers.keys()].sort((a, b) => a - b);

    const deletedConfirmMappings = oldMappings.filter(
      m => m.status === 'deleted_need_confirm' && !newIndexTrackers.has(m.master_line_index)
    );

    const finalMappings = [...deletedConfirmMappings];

    newSortedIndices.forEach(newIdx => {
      const tracker = newIndexTrackers.get(newIdx);

      if (tracker.action === 'new') {
        finalMappings.push({
          id: data.nextMappingId++,
          mirror_id: mirror.id,
          master_line_index: newIdx,
          master_version: newMasterVersion,
          master_content: tracker.new_master_content,
          translated_content: '',
          status: 'new',
          translator: null,
          translated_at: null,
          created_at: now(),
          updated_at: now()
        });
      } else if (tracker.action === 'keep') {
        const keptMapping = tracker.mapping;
        keptMapping.master_line_index = newIdx;
        keptMapping.master_version = newMasterVersion;
        keptMapping.master_content = tracker.new_master_content;
        if (keptMapping.status === 'deleted_need_confirm') {
          keptMapping.status = 'synchronized';
        }
        keptMapping.updated_at = now();
        finalMappings.push(keptMapping);
      } else if (tracker.action === 'outdate') {
        const outMapping = tracker.mapping;
        outMapping.master_line_index = newIdx;
        outMapping.master_version = newMasterVersion;
        outMapping.master_content = tracker.new_master_content;
        outMapping.status = 'outdated';
        outMapping.previous_translation = outMapping.translated_content;
        outMapping.previous_master_content = tracker.old_master_content;
        outMapping.updated_at = now();
        finalMappings.push(outMapping);
      }
    });

    finalMappings.sort((a, b) => a.master_line_index - b.master_line_index);

    data.paragraphMappings = data.paragraphMappings.filter(pm => pm.mirror_id !== mirror.id);
    data.paragraphMappings.push(...finalMappings);

    mirror.synced_master_version = oldMasterVersion;
    mirror.updated_at = now();
  });

  saveData();
}

function submitParagraphTranslation({ mirrorId, mappingId, translatedContent, translator, userId = null }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
  if (!mapping) {
    return { error: '段落映射不存在', status: 404 };
  }

  if (mapping.status === 'deleted' || mapping.status === 'synchronized') {
    return { error: '该段落当前不需要翻译', status: 400 };
  }

  checkAndRecoverExpiredClaimsForMirror(mirrorId);

  if (mapping.claimed_by && userId && mapping.claimed_by !== userId) {
    return {
      error: '该段落已被其他人认领，请先认领再提交',
      status: 409,
      claim: getClaimStatus(mapping)
    };
  }

  if (!mapping.claimed_by && userId) {
    return {
      error: '请先认领该段落再提交译文',
      status: 400
    };
  }

  mapping.translated_content = translatedContent;
  mapping.status = 'synchronized';
  mapping.translator = translator || 'anonymous';
  mapping.translated_at = now();
  mapping.claimed_by = null;
  mapping.claimed_by_name = null;
  mapping.claimed_at = null;
  mapping.claim_expires_at = null;
  mapping.updated_at = now();

  mirror.updated_at = now();

  saveData();
  return { mapping, mirror: enrichMirror(mirror) };
}

function confirmDeletedParagraph({ mirrorId, mappingId, confirm, translator, userId = null }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
  if (!mapping) {
    return { error: '段落映射不存在', status: 404 };
  }

  if (mapping.status !== 'deleted_need_confirm') {
    return { error: '该段落当前不处于删除确认状态', status: 400 };
  }

  checkAndRecoverExpiredClaimsForMirror(mirrorId);

  if (mapping.claimed_by && userId && mapping.claimed_by !== userId) {
    return {
      error: '该段落已被其他人认领',
      status: 409,
      claim: getClaimStatus(mapping)
    };
  }

  if (!mapping.claimed_by && userId) {
    return {
      error: '请先认领该段落再处理',
      status: 400
    };
  }

  if (confirm) {
    mapping.status = 'deleted';
    mapping.translator = translator || 'anonymous';
    mapping.translated_at = now();
  } else {
    mapping.status = 'new';
  }
  mapping.claimed_by = null;
  mapping.claimed_by_name = null;
  mapping.claimed_at = null;
  mapping.claim_expires_at = null;
  mapping.updated_at = now();
  mirror.updated_at = now();

  saveData();
  return { mapping, mirror: enrichMirror(mirror) };
}

function submitMirrorVersion({ mirrorId, commitMessage, submittedBy }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const pending = data.paragraphMappings.filter(
    pm => pm.mirror_id === mirrorId &&
      (pm.status === 'outdated' || pm.status === 'new' || pm.status === 'deleted_need_confirm')
  );

  if (pending.length > 0) {
    return {
      error: `还有 ${pending.length} 个段落待同步，全部处理完才能发布新版本`,
      status: 400,
      pending_count: pending.length
    };
  }

  const doc = getDocumentById(mirror.document_id, { reload: false });
  const latestMasterVersion = doc ? doc.versions.length : 0;

  const versions = data.mirrorVersions
    .filter(v => v.mirror_id === mirrorId)
    .sort((a, b) => a.version_number - b.version_number);

  const newVersionNumber = versions.length + 1;

  const content = assembleMirrorContent(mirrorId);

  const mirrorVersion = {
    id: data.nextMirrorVersionId++,
    mirror_id: mirrorId,
    version_number: newVersionNumber,
    based_on_master_version: latestMasterVersion,
    content,
    commit_message: commitMessage || `同步到主文档 v${latestMasterVersion}`,
    created_at: now(),
    created_by: submittedBy || 'anonymous'
  };

  data.mirrorVersions.push(mirrorVersion);

  mirror.synced_master_version = latestMasterVersion;
  mirror.updated_at = now();

  saveData();
  return {
    version: mirrorVersion,
    mirror: enrichMirror(mirror)
  };
}

function getMirrorVersions(mirrorId) {
  loadData();
  return data.mirrorVersions
    .filter(v => v.mirror_id === mirrorId)
    .sort((a, b) => a.version_number - b.version_number)
    .map(v => {
      const lang = LANGUAGES[data.mirrors.find(m => m.id === v.mirror_id)?.language_code];
      return {
        ...v,
        language_name: lang?.name,
        language_flag: lang?.flag
      };
    });
}

function getMirrorVersion(mirrorId, versionNumber) {
  loadData();
  return data.mirrorVersions.find(
    v => v.mirror_id === mirrorId && v.version_number === versionNumber
  );
}

function getTranslationWorkbench(mirrorId) {
  loadData();
  checkAndRecoverExpiredClaimsForMirror(mirrorId);

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const doc = getDocumentById(mirror.document_id, { reload: false });
  if (!doc) {
    return { error: '主文档不存在', status: 404 };
  }

  const latestMasterVersion = doc.versions[doc.versions.length - 1];

  const mappings = data.paragraphMappings
    .filter(pm => pm.mirror_id === mirrorId)
    .sort((a, b) => a.master_line_index - b.master_line_index);

  const masterLines = latestMasterVersion.content.split('\n');

  const paragraphs = masterLines.map((line, idx) => {
    const mapping = mappings.find(m => m.master_line_index === idx);
    if (!mapping) {
      return {
        master_line_index: idx,
        master_content: line,
        translated_content: '',
        status: 'missing',
        mapping_id: null,
        claim: { is_claimed: false }
      };
    }
    return {
      master_line_index: idx,
      master_content: line,
      translated_content: mapping.translated_content,
      previous_translation: mapping.previous_translation,
      previous_master_content: mapping.previous_master_content,
      status: mapping.status,
      mapping_id: mapping.id,
      translator: mapping.translator,
      translated_at: mapping.translated_at,
      master_version: mapping.master_version,
      claim: getClaimStatus(mapping)
    };
  });

  const stats = {
    total: paragraphs.length,
    synchronized: paragraphs.filter(p => p.status === 'synchronized').length,
    outdated: paragraphs.filter(p => p.status === 'outdated').length,
    new: paragraphs.filter(p => p.status === 'new' || p.status === 'missing').length,
    deleted_need_confirm: paragraphs.filter(p => p.status === 'deleted_need_confirm').length,
    deleted: paragraphs.filter(p => p.status === 'deleted').length
  };
  stats.pending = stats.outdated + stats.new + stats.deleted_need_confirm;

  const claimStats = getMirrorClaimStats(mirrorId);

  const enrichedMirror = enrichMirror(mirror);

  return {
    mirror: enrichedMirror,
    master_document: {
      id: doc.id,
      title: doc.title,
      latest_version: latestMasterVersion.version_number,
      latest_version_at: latestMasterVersion.created_at
    },
    paragraphs,
    stats,
    claim_stats: claimStats
  };
}

function deleteMirror(mirrorId) {
  loadData();

  const mirrorIndex = data.mirrors.findIndex(m => m.id === mirrorId);
  if (mirrorIndex === -1) return false;

  data.mirrors.splice(mirrorIndex, 1);
  data.mirrorVersions = data.mirrorVersions.filter(v => v.mirror_id !== mirrorId);
  data.paragraphMappings = data.paragraphMappings.filter(pm => pm.mirror_id !== mirrorId);

  saveData();
  return true;
}

function getClaimStatus(mapping) {
  if (!mapping.claimed_by) {
    return { is_claimed: false };
  }
  const nowTs = now();
  const is_expired = mapping.claim_expires_at && mapping.claim_expires_at < nowTs;
  const remaining_ms = mapping.claim_expires_at ? Math.max(0, mapping.claim_expires_at - nowTs) : 0;
  return {
    is_claimed: true,
    claimed_by: mapping.claimed_by,
    claimed_by_name: mapping.claimed_by_name || mapping.claimed_by,
    claimed_at: mapping.claimed_at,
    claim_expires_at: mapping.claim_expires_at,
    is_expired,
    remaining_ms
  };
}

function claimParagraph({ mirrorId, mappingId, userId, userName, durationMs = null }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
  if (!mapping) {
    return { error: '段落映射不存在', status: 404 };
  }

  if (mapping.status === 'deleted' || mapping.status === 'synchronized') {
    return { error: '该段落当前不需要翻译', status: 400 };
  }

  checkAndRecoverExpiredClaimsForMirror(mirrorId);

  if (mapping.claimed_by && mapping.claimed_by !== userId) {
    return {
      error: '该段落已被其他人认领',
      status: 409,
      claim: getClaimStatus(mapping)
    };
  }

  const duration = durationMs || CLAIM_CONFIG.DEFAULT_DURATION_MS;
  mapping.claimed_by = userId;
  mapping.claimed_by_name = userName || userId;
  mapping.claimed_at = now();
  mapping.claim_expires_at = now() + duration;
  mapping.updated_at = now();

  mirror.updated_at = now();
  saveData();

  return {
    mapping: { ...mapping, claim: getClaimStatus(mapping) },
    mirror: enrichMirror(mirror)
  };
}

function releaseParagraphClaim({ mirrorId, mappingId, userId }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
  if (!mapping) {
    return { error: '段落映射不存在', status: 404 };
  }

  if (!mapping.claimed_by) {
    return { error: '该段落未被认领', status: 400 };
  }

  if (mapping.claimed_by !== userId) {
    return { error: '只能释放自己认领的段落', status: 403 };
  }

  mapping.claimed_by = null;
  mapping.claimed_by_name = null;
  mapping.claimed_at = null;
  mapping.claim_expires_at = null;
  mapping.updated_at = now();

  mirror.updated_at = now();
  saveData();

  return {
    mapping: { ...mapping, claim: getClaimStatus(mapping) },
    mirror: enrichMirror(mirror)
  };
}

function forceAssignParagraph({ mirrorId, mappingId, userId, userName, durationMs = null }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
  if (!mapping) {
    return { error: '段落映射不存在', status: 404 };
  }

  if (mapping.status === 'deleted' || mapping.status === 'synchronized') {
    return { error: '该段落当前不需要翻译', status: 400 };
  }

  const duration = durationMs || CLAIM_CONFIG.DEFAULT_DURATION_MS;
  const previousClaimant = mapping.claimed_by;
  mapping.claimed_by = userId;
  mapping.claimed_by_name = userName || userId;
  mapping.claimed_at = now();
  mapping.claim_expires_at = now() + duration;
  mapping.updated_at = now();

  mirror.updated_at = now();
  saveData();

  return {
    mapping: { ...mapping, claim: getClaimStatus(mapping) },
    mirror: enrichMirror(mirror),
    previous_claimant: previousClaimant
  };
}

function batchAssignParagraphs({ mirrorId, mappingIds, userId, userName, durationMs = null }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const results = [];
  const failed = [];

  mappingIds.forEach(mappingId => {
    const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
    if (!mapping) {
      failed.push({ mappingId, error: '段落不存在' });
      return;
    }
    if (mapping.status === 'deleted' || mapping.status === 'synchronized') {
      failed.push({ mappingId, error: '该段落不需要翻译' });
      return;
    }
    const duration = durationMs || CLAIM_CONFIG.DEFAULT_DURATION_MS;
    mapping.claimed_by = userId;
    mapping.claimed_by_name = userName || userId;
    mapping.claimed_at = now();
    mapping.claim_expires_at = now() + duration;
    mapping.updated_at = now();
    results.push(mappingId);
  });

  mirror.updated_at = now();
  saveData();

  return {
    assigned_count: results.length,
    assigned_ids: results,
    failed,
    mirror: enrichMirror(mirror)
  };
}

function checkAndRecoverExpiredClaimsForMirror(mirrorId) {
  let recovered = 0;
  const nowTs = now();
  data.paragraphMappings.forEach(pm => {
    if (pm.mirror_id === mirrorId && pm.claimed_by && pm.claim_expires_at && pm.claim_expires_at < nowTs) {
      pm.claimed_by = null;
      pm.claimed_by_name = null;
      pm.claimed_at = null;
      pm.claim_expires_at = null;
      pm.updated_at = nowTs;
      recovered++;
    }
  });
  if (recovered > 0) {
    saveData();
  }
  return recovered;
}

function checkAndRecoverAllExpiredClaims() {
  let totalRecovered = 0;
  const nowTs = now();
  const affectedMirrorIds = new Set();

  data.paragraphMappings.forEach(pm => {
    if (pm.claimed_by && pm.claim_expires_at && pm.claim_expires_at < nowTs) {
      pm.claimed_by = null;
      pm.claimed_by_name = null;
      pm.claimed_at = null;
      pm.claim_expires_at = null;
      pm.updated_at = nowTs;
      affectedMirrorIds.add(pm.mirror_id);
      totalRecovered++;
    }
  });

  if (totalRecovered > 0) {
    affectedMirrorIds.forEach(mirrorId => {
      const mirror = data.mirrors.find(m => m.id === mirrorId);
      if (mirror) {
        mirror.updated_at = nowTs;
      }
    });
    saveData();
  }

  return {
    recovered_count: totalRecovered,
    affected_mirror_ids: [...affectedMirrorIds]
  };
}

function getMirrorClaimStats(mirrorId) {
  loadData();
  checkAndRecoverExpiredClaimsForMirror(mirrorId);

  const mappings = data.paragraphMappings.filter(pm => pm.mirror_id === mirrorId);
  const pendingMappings = mappings.filter(
    pm => pm.status === 'outdated' || pm.status === 'new' || pm.status === 'deleted_need_confirm'
  );

  const unclaimed = pendingMappings.filter(pm => !pm.claimed_by);
  const claimedByMe = {};
  const claimedByOthers = {};

  pendingMappings.forEach(pm => {
    if (pm.claimed_by) {
      const isExpired = pm.claim_expires_at && pm.claim_expires_at < now();
      const key = pm.claimed_by;
      if (!claimedByOthers[key]) {
        claimedByOthers[key] = {
          user_id: key,
          user_name: pm.claimed_by_name || key,
          count: 0,
          expired_count: 0,
          total_remaining_ms: 0
        };
      }
      claimedByOthers[key].count++;
      if (isExpired) {
        claimedByOthers[key].expired_count++;
      } else if (pm.claim_expires_at) {
        claimedByOthers[key].total_remaining_ms += (pm.claim_expires_at - now());
      }
    }
  });

  return {
    total_pending: pendingMappings.length,
    unclaimed_count: unclaimed.length,
    claimed_count: pendingMappings.length - unclaimed.length,
    by_user: Object.values(claimedByOthers).map(u => ({
      ...u,
      avg_remaining_ms: u.count > 0 ? Math.floor(u.total_remaining_ms / u.count) : 0
    }))
  };
}

function getDocumentClaimStats(documentId) {
  loadData();
  const mirrors = data.mirrors.filter(m => m.document_id === documentId);
  const result = {};

  mirrors.forEach(mirror => {
    result[mirror.language_code] = {
      mirror_id: mirror.id,
      language_code: mirror.language_code,
      language_name: LANGUAGES[mirror.language_code]?.name || mirror.language_code,
      language_flag: LANGUAGES[mirror.language_code]?.flag || '🌐',
      ...getMirrorClaimStats(mirror.id)
    };
  });

  return result;
}

function extendClaim({ mirrorId, mappingId, userId, extendMs = null }) {
  loadData();

  const mirror = data.mirrors.find(m => m.id === mirrorId);
  if (!mirror) {
    return { error: '镜像不存在', status: 404 };
  }

  const mapping = data.paragraphMappings.find(pm => pm.id === mappingId && pm.mirror_id === mirrorId);
  if (!mapping) {
    return { error: '段落映射不存在', status: 404 };
  }

  if (!mapping.claimed_by) {
    return { error: '该段落未被认领', status: 400 };
  }

  if (mapping.claimed_by !== userId) {
    return { error: '只能续期自己认领的段落', status: 403 };
  }

  const extendDuration = extendMs || CLAIM_CONFIG.DEFAULT_DURATION_MS;
  mapping.claim_expires_at = now() + extendDuration;
  mapping.updated_at = now();

  mirror.updated_at = now();
  saveData();

  return {
    mapping: { ...mapping, claim: getClaimStatus(mapping) },
    mirror: enrichMirror(mirror)
  };
}

loadData();

module.exports = {
  listLanguages,
  getLanguageInfo,
  listMirrorsByDocument,
  getMirrorById,
  getMirrorByDocumentAndLanguage,
  createMirror,
  getParagraphMappings,
  detectChangesOnMasterUpdate,
  submitParagraphTranslation,
  confirmDeletedParagraph,
  submitMirrorVersion,
  getMirrorVersions,
  getMirrorVersion,
  getTranslationWorkbench,
  deleteMirror,
  loadData,
  saveData,
  assembleMirrorContent,
  claimParagraph,
  releaseParagraphClaim,
  forceAssignParagraph,
  batchAssignParagraphs,
  checkAndRecoverExpiredClaimsForMirror,
  checkAndRecoverAllExpiredClaims,
  getMirrorClaimStats,
  getDocumentClaimStats,
  extendClaim,
  getClaimStatus,
  CLAIM_CONFIG
};
