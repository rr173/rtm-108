const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WsService = require('./wsService');
const seedDemoData = require('./seed');

const {
  getContractById,
  listContracts,
  createContract,
  updateContract,
  deleteContract,
  startSigning,
  signContract,
  getNotificationsByContract,
  markNotificationRead,
  getPendingNotificationsByEmail,
  checkAndGenerateReminders,
  checkAndGenerateDeadlineWarnings,
  checkAndUpdateExpiredContracts
} = require('./contractService');

const {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  getVersion,
  diffVersions,
  addTag,
  removeTag,
  revertToVersion,
  setDocumentPublic
} = require('./documentService');

const {
  createReview,
  getReviewById,
  listReviewsByDocument,
  updateReviewStatus,
  deleteReview,
  addComment,
  getCommentById,
  getCommentsByReview,
  updateComment,
  resolveComment,
  unresolveComment,
  deleteComment,
  checkAllResolved
} = require('./reviewService');

const {
  createPatch,
  getPatchById,
  listPatchesByDocument,
  listPatchesByReview,
  updatePatchStatus,
  deletePatch,
  detectConflicts,
  resolveConflict,
  mergePatches,
  getPatchStats
} = require('./patchService');

const {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateVersion,
  renderTemplateById,
  batchGenerateDocuments
} = require('./templateService');

const { renderTemplate, extractVariables } = require('./templateEngine');

const {
  listLanguages,
  listMirrorsByDocument,
  getMirrorById,
  getMirrorByDocumentAndLanguage,
  createMirror,
  submitParagraphTranslation,
  confirmDeletedParagraph,
  submitMirrorVersion,
  getMirrorVersions,
  getMirrorVersion,
  getTranslationWorkbench,
  deleteMirror,
  detectChangesOnMasterUpdate
} = require('./mirrorService');

const {
  ROLES,
  checkPermission,
  getUserRoleForDocument,
  getPermissionDetailsForDocument,
  addCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  setOwner,
  hasAtLeastRole,
  deleteDocumentPermissions,
  getUserName
} = require('./permissionService');

const {
  OPERATION_TYPES,
  RESULT_TYPES,
  createLog,
  getLogsByDocument,
  getLogsByUser,
  getAllLogs,
  verifyLogIntegrity
} = require('./auditService');

const app = express();
const server = http.createServer(app);
const wsService = new WsService(server);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function getCurrentUser(req) {
  const userId = req.headers['x-user-id'] || null;
  return {
    userId,
    userName: userId ? getUserName(userId) : '匿名用户'
  };
}

function authMiddleware(req, res, next) {
  const { userId, userName } = getCurrentUser(req);
  req.currentUser = { id: userId, name: userName };
  next();
}

app.use(authMiddleware);

function requireDocPermission(requiredRole) {
  return (req, res, next) => {
    const docId = parseInt(req.params.id || req.params.documentId);
    const userId = req.currentUser.id;

    if (isNaN(docId)) {
      return res.status(400).json({ error: '无效的文档ID' });
    }

    const doc = getDocumentById(docId, { reload: false });
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }

    const permissionResult = checkPermission(docId, userId, requiredRole, doc.is_public);

    if (!permissionResult.allowed) {
      return res.status(403).json({
        error: permissionResult.reason || '权限不足',
        permission_required: requiredRole,
        user_role: permissionResult.role
      });
    }

    req._permissionChecked = true;
    req._documentExists = true;
    req._document = doc;
    req._userRole = permissionResult.role;
    next();
  };
}

function logAudit(operation, options = {}) {
  return (req, res, next) => {
    const originalSend = res.send.bind(res);

    res.send = (data) => {
      if (!req._auditLogged) {
        req._auditLogged = true;

        try {
          const userId = req.currentUser.id;
          const docId = options.getDocumentId
            ? options.getDocumentId(req)
            : (parseInt(req.params.id || req.params.documentId) || null);
          const params = options.getParams
            ? options.getParams(req)
            : {
                query: req.query,
                body: Object.keys(req.body || {}).length > 0 ? req.body : undefined
              };

          let result = RESULT_TYPES.SUCCESS;
          let errorMessage = null;

          if (res.statusCode === 403) {
            result = RESULT_TYPES.DENIED;
            if (data && typeof data === 'object' && data.error) {
              errorMessage = data.error;
            }
          } else if (res.statusCode >= 400) {
            result = RESULT_TYPES.FAILED;
            if (data && typeof data === 'object' && data.error) {
              errorMessage = data.error;
            }
          }

          createLog({
            userId,
            operation,
            documentId: docId,
            result,
            params,
            errorMessage
          });
        } catch (e) {
          console.error('写入审计日志失败:', e);
        }
      }

      return originalSend(data);
    };

    next();
  };
}

function listDocumentsFiltered(userId) {
  const allDocs = listDocuments();
  return allDocs.filter(doc => {
    if (doc.is_public) return true;
    if (!userId) return false;
    const role = getUserRoleForDocument(doc.id, userId);
    return role !== null;
  });
}

// ============ 文档相关 API ============

app.get(
  '/api/documents',
  logAudit(OPERATION_TYPES.DOCUMENT_VIEW, {
    getDocumentId: () => null,
    getParams: () => ({ action: 'list' })
  }),
  (req, res) => {
    try {
      const userId = req.currentUser.id;
      const documents = listDocumentsFiltered(userId);
      res.json(documents);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get(
  '/api/documents/:id',
  logAudit(OPERATION_TYPES.DOCUMENT_VIEW),
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const doc = req._document;
      const userId = req.currentUser.id;
      const userRole = req._userRole;
      res.json({
        ...doc,
        current_user_role: userRole,
        current_user_id: userId
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/documents',
  logAudit(OPERATION_TYPES.DOCUMENT_CREATE, {
    getDocumentId: (req) => req._createdDocId,
    getParams: (req) => ({ title: req.body?.title })
  }),
  (req, res) => {
    try {
      const { title, content, description, is_public } = req.body;
      if (!title || content === undefined) {
        return res.status(400).json({ error: '缺少必要参数' });
      }
      const ownerId = req.currentUser.id;
      const doc = createDocument({
        title,
        content,
        description,
        owner_id: ownerId,
        is_public: is_public === true
      });

      if (ownerId) {
        setOwner(doc.id, ownerId);
      }

      req._createdDocId = doc.id;
      res.status(201).json(doc);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/documents/:id',
  logAudit(OPERATION_TYPES.DOCUMENT_EDIT, {
    getParams: (req) => ({ commit_message: req.body?.commit_message })
  }),
  requireDocPermission(ROLES.EDITOR),
  (req, res) => {
    try {
      const { content, commit_message } = req.body;
      if (content === undefined) {
        return res.status(400).json({ error: '缺少内容参数' });
      }
      const docId = parseInt(req.params.id);

      const docBefore = getDocumentById(docId, { reload: false });
      const oldVersionNum = docBefore && docBefore.versions.length > 0
        ? docBefore.versions[docBefore.versions.length - 1].version_number
        : 0;
      const oldContent = docBefore && docBefore.versions.length > 0
        ? docBefore.versions[docBefore.versions.length - 1].content
        : '';

      const doc = updateDocument(docId, { content, commit_message });
      if (!doc) {
        return res.status(404).json({ error: '文档不存在' });
      }

      const docAfter = getDocumentById(docId, { reload: false });
      const newVersionNum = docAfter && docAfter.versions.length > 0
        ? docAfter.versions[docAfter.versions.length - 1].version_number
        : oldVersionNum;
      const newContent = docAfter && docAfter.versions.length > 0
        ? docAfter.versions[docAfter.versions.length - 1].content
        : content;

      if (newVersionNum > oldVersionNum && oldContent !== newContent) {
        try {
          detectChangesOnMasterUpdate(docId, oldVersionNum, newVersionNum);
          wsService.notifyDocumentMirrorsUpdate(docId);
        } catch (mirrorErr) {
          console.error('触发镜像过期检测失败:', mirrorErr);
        }
      }

      res.json(doc);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.delete(
  '/api/documents/:id',
  logAudit(OPERATION_TYPES.DOCUMENT_DELETE),
  requireDocPermission(ROLES.OWNER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      deleteDocumentPermissions(docId);
      const success = deleteDocument(docId);
      if (!success) {
        return res.status(404).json({ error: '文档不存在' });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get(
  '/api/documents/:id/versions/:version',
  logAudit(OPERATION_TYPES.VERSION_VIEW),
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const version = getVersion(parseInt(req.params.id), parseInt(req.params.version));
      if (!version) {
        return res.status(404).json({ error: '版本不存在' });
      }
      res.json(version);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get(
  '/api/documents/:id/diff',
  logAudit(OPERATION_TYPES.VERSION_DIFF, {
    getParams: (req) => ({ old_version: req.query.old_version, new_version: req.query.new_version })
  }),
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const { old_version, new_version } = req.query;
      if (!old_version || !new_version) {
        return res.status(400).json({ error: '缺少版本参数' });
      }
      const result = diffVersions(
        parseInt(req.params.id),
        parseInt(old_version),
        parseInt(new_version)
      );
      if (!result) {
        return res.status(404).json({ error: '版本不存在' });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/documents/:id/revert/:version',
  logAudit(OPERATION_TYPES.DOCUMENT_REVERT, {
    getParams: (req) => ({ revert_to_version: req.params.version })
  }),
  requireDocPermission(ROLES.OWNER),
  (req, res) => {
    try {
      const { commit_message } = req.body;
      const result = revertToVersion(
        parseInt(req.params.id),
        parseInt(req.params.version),
        commit_message
      );
      if (!result) {
        return res.status(404).json({ error: '文档或版本不存在' });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/documents/:id/versions/:versionId/tags',
  logAudit(OPERATION_TYPES.TAG_ADD, {
    getParams: (req) => ({ tag_name: req.body?.name, version_id: req.params.versionId })
  }),
  requireDocPermission(ROLES.EDITOR),
  (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: '缺少标签名称' });
      }
      const tag = addTag(parseInt(req.params.id), parseInt(req.params.versionId), name);
      if (!tag) {
        return res.status(404).json({ error: '文档或版本不存在' });
      }
      res.status(201).json(tag);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.delete('/api/tags/:tagId', (req, res) => {
  try {
    const success = removeTag(parseInt(req.params.tagId));
    if (!success) {
      return res.status(404).json({ error: '标签不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 评审 API ============

app.get(
  '/api/documents/:id/reviews',
  logAudit(OPERATION_TYPES.REVIEW_CREATE, {
    getParams: () => ({ action: 'list_reviews' })
  }),
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const reviews = listReviewsByDocument(parseInt(req.params.id));
      res.json(reviews);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/documents/:id/reviews',
  logAudit(OPERATION_TYPES.REVIEW_CREATE, {
    getParams: (req) => ({ review_title: req.body?.title, old_version: req.body?.old_version, new_version: req.body?.new_version })
  }),
  requireDocPermission(ROLES.EDITOR),
  (req, res) => {
    try {
      const { old_version, new_version, title, created_by } = req.body;
      if (!old_version || !new_version) {
        return res.status(400).json({ error: '缺少版本参数' });
      }
      const review = createReview({
        document_id: parseInt(req.params.id),
        old_version: parseInt(old_version),
        new_version: parseInt(new_version),
        title,
        created_by: created_by || req.currentUser.name
      });
      res.status(201).json(review);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get('/api/reviews/:id', (req, res) => {
  try {
    const review = getReviewById(parseInt(req.params.id));
    if (!review) {
      return res.status(404).json({ error: '评审不存在' });
    }
    res.json(review);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put(
  '/api/reviews/:id/status',
  logAudit(OPERATION_TYPES.REVIEW_STATUS, {
    getDocumentId: (req) => {
      const review = getReviewById(parseInt(req.params.id));
      return review ? review.document_id : null;
    },
    getParams: (req) => ({ status: req.body?.status })
  }),
  (req, res) => {
    try {
      const { status } = req.body;
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: '无效的状态值' });
      }
      const review = updateReviewStatus(parseInt(req.params.id), status);
      if (!review) {
        return res.status(404).json({ error: '评审不存在' });
      }
      wsService.notifyReviewUpdate(review.id, 'review_status_updated');
      res.json(review);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.delete('/api/reviews/:id', (req, res) => {
  try {
    const success = deleteReview(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: '评审不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reviews/:id/comments', (req, res) => {
  try {
    const comments = getCommentsByReview(parseInt(req.params.id));
    res.json(comments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(
  '/api/reviews/:id/comments',
  logAudit(OPERATION_TYPES.COMMENT_ADD, {
    getDocumentId: (req) => {
      const review = getReviewById(parseInt(req.params.id));
      return review ? review.document_id : null;
    },
    getParams: (req) => ({ review_id: req.params.id, has_parent: !!req.body?.parent_id })
  }),
  (req, res) => {
    try {
      const { old_line, new_line, content, author, parent_id } = req.body;
      if (!content) {
        return res.status(400).json({ error: '评论内容不能为空' });
      }
      const comment = addComment({
        review_id: parseInt(req.params.id),
        old_line: old_line !== undefined ? parseInt(old_line) : null,
        new_line: new_line !== undefined ? parseInt(new_line) : null,
        content,
        author: author || req.currentUser.name,
        parent_id: parent_id ? parseInt(parent_id) : null
      });
      if (!comment) {
        return res.status(404).json({ error: '评审或父评论不存在' });
      }
      wsService.notifyReviewComment(parseInt(req.params.id), comment, 'new_comment');
      const review = getReviewById(parseInt(req.params.id));
      if (review) {
        wsService.notifyReviewUpdate(review.id, 'review_updated');
      }
      res.status(201).json(comment);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/comments/:id/resolve',
  logAudit(OPERATION_TYPES.COMMENT_RESOLVE, {
    getDocumentId: (req) => {
      const comment = getCommentById(parseInt(req.params.id));
      if (!comment) return null;
      const review = getReviewById(comment.review_id);
      return review ? review.document_id : null;
    },
    getParams: (req) => ({ comment_id: req.params.id, action: 'resolve' })
  }),
  (req, res) => {
    try {
      const comment = resolveComment(parseInt(req.params.id));
      if (!comment) {
        return res.status(404).json({ error: '评论不存在' });
      }
      wsService.notifyCommentResolved(comment.review_id, comment, 'comment_resolved');
      const review = getReviewById(comment.review_id);
      if (review) {
        wsService.notifyReviewUpdate(review.id, 'review_updated');
      }
      res.json(comment);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put('/api/comments/:id/unresolve', (req, res) => {
  try {
    const comment = unresolveComment(parseInt(req.params.id));
    if (!comment) {
      return res.status(404).json({ error: '评论不存在' });
    }
    wsService.notifyCommentResolved(comment.review_id, comment, 'comment_unresolved');
    const review = getReviewById(comment.review_id);
    if (review) {
      wsService.notifyReviewUpdate(review.id, 'review_updated');
    }
    res.json(comment);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/comments/:id', (req, res) => {
  try {
    const success = deleteComment(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: '评论不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 补丁 API ============

app.get(
  '/api/documents/:id/patches',
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const { status, version } = req.query;
      const patches = listPatchesByDocument(parseInt(req.params.id), {
        status: status || null,
        versionNumber: version !== undefined ? parseInt(version) : null
      });
      res.json(patches);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get(
  '/api/documents/:id/patches/stats',
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const { version } = req.query;
      if (!version) {
        return res.status(400).json({ error: '缺少版本参数' });
      }
      const stats = getPatchStats(parseInt(req.params.id), parseInt(version));
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get('/api/patches/:id', (req, res) => {
  try {
    const patch = getPatchById(parseInt(req.params.id));
    if (!patch) {
      return res.status(404).json({ error: '补丁不存在' });
    }
    res.json(patch);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(
  '/api/documents/:id/patches',
  logAudit(OPERATION_TYPES.PATCH_CREATE, {
    getParams: (req) => ({ lines: `${req.body?.start_line}-${req.body?.end_line}` })
  }),
  requireDocPermission(ROLES.EDITOR),
  (req, res) => {
    try {
      const { start_line, end_line, replacement_text, created_by, description, version_number, review_id } = req.body;
      if (start_line === undefined || end_line === undefined || replacement_text === undefined || !version_number) {
        return res.status(400).json({ error: '缺少必要参数' });
      }
      const result = createPatch({
        document_id: parseInt(req.params.id),
        version_number: parseInt(version_number),
        start_line: parseInt(start_line),
        end_line: parseInt(end_line),
        replacement_text,
        created_by: created_by || req.currentUser.name,
        description: description || '',
        review_id: review_id ? parseInt(review_id) : null
      });
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.status(201).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put('/api/patches/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'accepted', 'rejected', 'merged'].includes(status)) {
      return res.status(400).json({ error: '无效的状态值' });
    }
    const patch = updatePatchStatus(parseInt(req.params.id), status);
    if (!patch) {
      return res.status(404).json({ error: '补丁不存在' });
    }
    res.json(patch);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/patches/:id', (req, res) => {
  try {
    const success = deletePatch(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: '补丁不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get(
  '/api/documents/:id/conflicts',
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const { version } = req.query;
      if (!version) {
        return res.status(400).json({ error: '缺少版本参数' });
      }
      const conflicts = detectConflicts(parseInt(req.params.id), parseInt(version));
      res.json(conflicts);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put('/api/patches/:id/resolve', (req, res) => {
  try {
    const { resolution, resolved_content } = req.body;
    const result = resolveConflict(parseInt(req.params.id), resolution, resolved_content);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(
  '/api/documents/:id/merge',
  logAudit(OPERATION_TYPES.PATCH_MERGE, {
    getParams: (req) => ({ version: req.body?.version })
  }),
  requireDocPermission(ROLES.EDITOR),
  (req, res) => {
    try {
      const { version, commit_message, merged_by } = req.body;
      if (!version) {
        return res.status(400).json({ error: '缺少版本参数' });
      }
      const result = mergePatches(parseInt(req.params.id), parseInt(version), {
        commit_message: commit_message || '',
        merged_by: merged_by || req.currentUser.name
      });
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error, conflicts: result.conflicts });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get('/api/reviews/:id/patches', (req, res) => {
  try {
    const patches = listPatchesByReview(parseInt(req.params.id));
    res.json(patches);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 合同 API ============

app.get('/api/contracts', (req, res) => {
  try {
    const contracts = listContracts();
    res.json(contracts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/contracts/:id', (req, res) => {
  try {
    const contract = getContractById(parseInt(req.params.id));
    if (!contract) {
      return res.status(404).json({ error: '合同不存在' });
    }
    res.json(contract);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/contracts', (req, res) => {
  try {
    const { title, content, signers, deadline, reminderHours } = req.body;
    if (!title || !content || !signers || !Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const contract = createContract({ title, content, signers, deadline, reminderHours });
    res.status(201).json(contract);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/contracts/:id', (req, res) => {
  try {
    const { title, content, signers, deadline, reminderHours } = req.body;
    const contract = updateContract(parseInt(req.params.id), { title, content, signers, deadline, reminderHours });
    if (!contract) {
      return res.status(404).json({ error: '合同不存在' });
    }
    wsService.notifyContractUpdate(contract.id, 'contract_updated');
    res.json(contract);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/contracts/:id', (req, res) => {
  try {
    const success = deleteContract(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: '合同不存在' });
    }
    wsService.notifyContractUpdate(parseInt(req.params.id), 'contract_deleted');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/contracts/:id/start', (req, res) => {
  try {
    const contract = startSigning(parseInt(req.params.id));
    if (!contract) {
      return res.status(404).json({ error: '合同不存在' });
    }
    wsService.notifyContractUpdate(contract.id, 'signing_started');
    res.json(contract);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/contracts/:id/sign/:signerId', (req, res) => {
  try {
    const { signatureType, signatureData } = req.body;
    if (!signatureType || !signatureData) {
      return res.status(400).json({ error: '缺少签名数据' });
    }
    if (!['canvas', 'text'].includes(signatureType)) {
      return res.status(400).json({ error: '无效的签名类型' });
    }

    const result = signContract(
      parseInt(req.params.id),
      parseInt(req.params.signerId),
      { signatureType, signatureData }
    );

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    const eventType = result.completed ? 'contract_completed' : 'sign_done';
    wsService.notifyContractUpdate(result.contract.id, eventType);

    res.json(result.contract);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/contracts/:id/notifications', (req, res) => {
  try {
    const contractId = parseInt(req.params.id);
    const contract = getContractById(contractId);
    if (!contract) {
      return res.status(404).json({ error: '合同不存在' });
    }
    const notifications = getNotificationsByContract(contractId);
    res.json(notifications);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/contracts/:id/notifications/:notifId/read', (req, res) => {
  try {
    const contractId = parseInt(req.params.id);
    const notifId = parseInt(req.params.notifId);
    const contract = getContractById(contractId);
    if (!contract) {
      return res.status(404).json({ error: '合同不存在' });
    }
    const notif = markNotificationRead(contractId, notifId);
    if (!notif) {
      return res.status(404).json({ error: '通知不存在' });
    }
    wsService.notifyContractUpdate(contractId, 'notification_updated');
    res.json(notif);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/notifications/pending', (req, res) => {
  try {
    const { email } = req.query;
    const notifications = getPendingNotificationsByEmail(email);
    res.json(notifications);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 模板 API ============

app.get('/api/templates', (req, res) => {
  try {
    const templates = listTemplates();
    res.json(templates);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/templates/:id', (req, res) => {
  try {
    const tpl = getTemplateById(parseInt(req.params.id));
    if (!tpl) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json(tpl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/templates', (req, res) => {
  try {
    const { title, content, description } = req.body;
    if (!title || content === undefined) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const tpl = createTemplate({ title, content, description });
    res.status(201).json(tpl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/templates/:id', (req, res) => {
  try {
    const { content, commit_message, title, description } = req.body;
    const tpl = updateTemplate(parseInt(req.params.id), {
      content,
      commit_message,
      title,
      description
    });
    if (!tpl) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json(tpl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/templates/:id', (req, res) => {
  try {
    const success = deleteTemplate(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/templates/:id/versions/:version', (req, res) => {
  try {
    const version = getTemplateVersion(parseInt(req.params.id), parseInt(req.params.version));
    if (!version) {
      return res.status(404).json({ error: '版本不存在' });
    }
    res.json(version);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(
  '/api/templates/:id/render',
  logAudit(OPERATION_TYPES.TEMPLATE_RENDER, {
    getParams: (req) => ({ template_id: req.params.id, has_version: !!req.body?.version_number })
  }),
  (req, res) => {
    try {
      const { variables, keep_missing, version_number } = req.body;
      const result = renderTemplateById(parseInt(req.params.id), variables || {}, {
        keepMissing: keep_missing !== false,
        versionNumber: version_number ? parseInt(version_number) : null
      });
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post('/api/templates/render', (req, res) => {
  try {
    const { template, variables, keep_missing } = req.body;
    if (template === undefined) {
      return res.status(400).json({ error: '缺少模板内容' });
    }
    const rendered = renderTemplate(template, variables || {}, {
      keepMissing: keep_missing !== false
    });
    const extractedVars = extractVariables(template);
    res.json({
      content: rendered,
      variables: extractedVars
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/templates/extract-variables', (req, res) => {
  try {
    const { template } = req.body;
    if (template === undefined) {
      return res.status(400).json({ error: '缺少模板内容' });
    }
    const variables = extractVariables(template);
    res.json({ variables });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/templates/:id/batch-generate', (req, res) => {
  try {
    const { variables_list } = req.body;
    if (!variables_list || !Array.isArray(variables_list)) {
      return res.status(400).json({ error: '缺少变量数据数组' });
    }
    const result = batchGenerateDocuments(parseInt(req.params.id), variables_list);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 多语言镜像 API ============

app.get('/api/languages', (req, res) => {
  try {
    res.json(listLanguages());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get(
  '/api/documents/:id/mirrors',
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const mirrors = listMirrorsByDocument(docId);
      res.json(mirrors);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/documents/:id/mirrors',
  logAudit(OPERATION_TYPES.MIRROR_CREATE, {
    getParams: (req) => ({ language_code: req.body?.language_code })
  }),
  requireDocPermission(ROLES.EDITOR),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const { language_code, initial_content } = req.body;
      if (!language_code) {
        return res.status(400).json({ error: '缺少语言代码' });
      }
      const result = createMirror({
        documentId: docId,
        languageCode: language_code,
        initialContent: initial_content,
        createdBy: req.currentUser.name
      });
      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      wsService.notifyDocumentMirrorsUpdate(docId);
      res.status(201).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get('/api/mirrors/:mirrorId', (req, res) => {
  try {
    const mirror = getMirrorById(parseInt(req.params.mirrorId));
    if (!mirror) {
      return res.status(404).json({ error: '镜像不存在' });
    }
    const doc = getDocumentById(mirror.document_id, { reload: false });
    if (doc) {
      const userId = req.currentUser.id;
      const permissionResult = checkPermission(mirror.document_id, userId, ROLES.VIEWER, doc.is_public);
      if (!permissionResult.allowed) {
        return res.status(403).json({ error: permissionResult.reason || '权限不足' });
      }
    }
    res.json(mirror);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get(
  '/api/mirrors/:mirrorId/workbench',
  (req, res) => {
    try {
      const mirrorId = parseInt(req.params.mirrorId);
      const mirror = getMirrorById(mirrorId);
      if (!mirror) {
        return res.status(404).json({ error: '镜像不存在' });
      }
      const doc = getDocumentById(mirror.document_id, { reload: false });
      if (doc) {
        const userId = req.currentUser.id;
        const permissionResult = checkPermission(mirror.document_id, userId, ROLES.VIEWER, doc.is_public);
        if (!permissionResult.allowed) {
          return res.status(403).json({ error: permissionResult.reason || '权限不足' });
        }
      }
      const result = getTranslationWorkbench(mirrorId);
      if (result.error) {
        return res.status(result.status || 500).json({ error: result.error });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/mirrors/:mirrorId/paragraphs/:mappingId',
  logAudit(OPERATION_TYPES.PARAGRAPH_TRANSLATE, {
    getDocumentId: (req) => {
      const mirror = getMirrorById(parseInt(req.params.mirrorId));
      return mirror ? mirror.document_id : null;
    },
    getParams: (req) => ({
      mirror_id: parseInt(req.params.mirrorId),
      mapping_id: parseInt(req.params.mappingId),
      status: 'translated'
    })
  }),
  (req, res) => {
    try {
      const mirrorId = parseInt(req.params.mirrorId);
      const mappingId = parseInt(req.params.mappingId);
      const { translated_content } = req.body;

      const mirror = getMirrorById(mirrorId);
      if (!mirror) {
        return res.status(404).json({ error: '镜像不存在' });
      }
      const doc = getDocumentById(mirror.document_id, { reload: false });
      if (doc) {
        const userId = req.currentUser.id;
        const permissionResult = checkPermission(mirror.document_id, userId, ROLES.EDITOR, doc.is_public);
        if (!permissionResult.allowed) {
          return res.status(403).json({ error: permissionResult.reason || '权限不足' });
        }
      }

      const result = submitParagraphTranslation({
        mirrorId,
        mappingId,
        translatedContent: translated_content,
        translator: req.currentUser.name
      });

      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }

      wsService.notifyMirrorParagraphUpdate(mirrorId, mappingId, 'paragraph_translated');
      wsService.notifyDocumentMirrorsUpdate(mirror.document_id);

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/mirrors/:mirrorId/paragraphs/:mappingId/confirm-delete',
  logAudit(OPERATION_TYPES.PARAGRAPH_TRANSLATE, {
    getDocumentId: (req) => {
      const mirror = getMirrorById(parseInt(req.params.mirrorId));
      return mirror ? mirror.document_id : null;
    },
    getParams: (req) => ({
      mirror_id: parseInt(req.params.mirrorId),
      mapping_id: parseInt(req.params.mappingId),
      confirm: req.body?.confirm,
      status: 'deleted_confirmed'
    })
  }),
  (req, res) => {
    try {
      const mirrorId = parseInt(req.params.mirrorId);
      const mappingId = parseInt(req.params.mappingId);
      const { confirm } = req.body;

      const mirror = getMirrorById(mirrorId);
      if (!mirror) {
        return res.status(404).json({ error: '镜像不存在' });
      }
      const doc = getDocumentById(mirror.document_id, { reload: false });
      if (doc) {
        const userId = req.currentUser.id;
        const permissionResult = checkPermission(mirror.document_id, userId, ROLES.EDITOR, doc.is_public);
        if (!permissionResult.allowed) {
          return res.status(403).json({ error: permissionResult.reason || '权限不足' });
        }
      }

      const result = confirmDeletedParagraph({
        mirrorId,
        mappingId,
        confirm: confirm === true,
        translator: req.currentUser.name
      });

      if (result.error) {
        return res.status(result.status || 400).json({ error: result.error });
      }

      wsService.notifyMirrorParagraphUpdate(mirrorId, mappingId, 'paragraph_deletion_confirmed');
      wsService.notifyDocumentMirrorsUpdate(mirror.document_id);

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/mirrors/:mirrorId/versions',
  logAudit(OPERATION_TYPES.MIRROR_VERSION_CREATE, {
    getDocumentId: (req) => {
      const mirror = getMirrorById(parseInt(req.params.mirrorId));
      return mirror ? mirror.document_id : null;
    },
    getParams: (req) => ({
      mirror_id: parseInt(req.params.mirrorId),
      commit_message: req.body?.commit_message
    })
  }),
  (req, res) => {
    try {
      const mirrorId = parseInt(req.params.mirrorId);
      const { commit_message } = req.body;

      const mirror = getMirrorById(mirrorId);
      if (!mirror) {
        return res.status(404).json({ error: '镜像不存在' });
      }
      const doc = getDocumentById(mirror.document_id, { reload: false });
      if (doc) {
        const userId = req.currentUser.id;
        const permissionResult = checkPermission(mirror.document_id, userId, ROLES.EDITOR, doc.is_public);
        if (!permissionResult.allowed) {
          return res.status(403).json({ error: permissionResult.reason || '权限不足' });
        }
      }

      const result = submitMirrorVersion({
        mirrorId,
        commitMessage: commit_message,
        submittedBy: req.currentUser.name
      });

      if (result.error) {
        return res.status(result.status || 400).json({
          error: result.error,
          pending_count: result.pending_count
        });
      }

      wsService.notifyMirrorVersionUpdate(mirrorId, 'mirror_version_created');
      wsService.notifyDocumentMirrorsUpdate(mirror.document_id);

      res.status(201).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.get('/api/mirrors/:mirrorId/versions', (req, res) => {
  try {
    const mirrorId = parseInt(req.params.mirrorId);
    const mirror = getMirrorById(mirrorId);
    if (!mirror) {
      return res.status(404).json({ error: '镜像不存在' });
    }
    const doc = getDocumentById(mirror.document_id, { reload: false });
    if (doc) {
      const userId = req.currentUser.id;
      const permissionResult = checkPermission(mirror.document_id, userId, ROLES.VIEWER, doc.is_public);
      if (!permissionResult.allowed) {
        return res.status(403).json({ error: permissionResult.reason || '权限不足' });
      }
    }
    res.json(getMirrorVersions(mirrorId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mirrors/:mirrorId/versions/:versionNumber', (req, res) => {
  try {
    const mirrorId = parseInt(req.params.mirrorId);
    const versionNumber = parseInt(req.params.versionNumber);
    const mirror = getMirrorById(mirrorId);
    if (!mirror) {
      return res.status(404).json({ error: '镜像不存在' });
    }
    const doc = getDocumentById(mirror.document_id, { reload: false });
    if (doc) {
      const userId = req.currentUser.id;
      const permissionResult = checkPermission(mirror.document_id, userId, ROLES.VIEWER, doc.is_public);
      if (!permissionResult.allowed) {
        return res.status(403).json({ error: permissionResult.reason || '权限不足' });
      }
    }
    const version = getMirrorVersion(mirrorId, versionNumber);
    if (!version) {
      return res.status(404).json({ error: '版本不存在' });
    }
    res.json(version);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/mirrors/:mirrorId', (req, res) => {
  try {
    const mirrorId = parseInt(req.params.mirrorId);
    const mirror = getMirrorById(mirrorId);
    if (!mirror) {
      return res.status(404).json({ error: '镜像不存在' });
    }
    const doc = getDocumentById(mirror.document_id, { reload: false });
    if (doc) {
      const userId = req.currentUser.id;
      const permissionResult = checkPermission(mirror.document_id, userId, ROLES.OWNER, doc.is_public);
      if (!permissionResult.allowed) {
        return res.status(403).json({ error: permissionResult.reason || '权限不足' });
      }
    }
    const docId = mirror.document_id;
    const success = deleteMirror(mirrorId);
    if (success) {
      wsService.notifyDocumentMirrorsUpdate(docId);
    }
    res.json({ success });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 权限管理 API ============

app.get(
  '/api/documents/:id/permissions',
  logAudit(OPERATION_TYPES.PERMISSION_CHANGE, {
    getParams: () => ({ action: 'list_permissions' })
  }),
  requireDocPermission(ROLES.VIEWER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const permissions = getPermissionDetailsForDocument(docId);
      const isOwner = hasAtLeastRole(req._userRole, ROLES.OWNER);
      res.json({
        permissions,
        current_user_role: req._userRole,
        can_manage: isOwner,
        is_public: req._document.is_public
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.post(
  '/api/documents/:id/permissions',
  logAudit(OPERATION_TYPES.PERMISSION_ADD, {
    getParams: (req) => ({ user_id: req.body?.user_id, role: req.body?.role })
  }),
  requireDocPermission(ROLES.OWNER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const { user_id, role } = req.body;
      if (!user_id || !role) {
        return res.status(400).json({ error: '缺少用户ID或角色' });
      }
      const result = addCollaborator(docId, user_id, role, req.currentUser.id);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      res.status(201).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/documents/:id/permissions/:userId',
  logAudit(OPERATION_TYPES.PERMISSION_CHANGE, {
    getParams: (req) => ({ user_id: req.params.userId, new_role: req.body?.role })
  }),
  requireDocPermission(ROLES.OWNER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const userId = req.params.userId;
      const { role } = req.body;
      if (!role) {
        return res.status(400).json({ error: '缺少角色参数' });
      }
      const result = updateCollaboratorRole(docId, userId, role, req.currentUser.id);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.delete(
  '/api/documents/:id/permissions/:userId',
  logAudit(OPERATION_TYPES.PERMISSION_REMOVE, {
    getParams: (req) => ({ user_id: req.params.userId })
  }),
  requireDocPermission(ROLES.OWNER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const userId = req.params.userId;
      const result = removeCollaborator(docId, userId, req.currentUser.id);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, removed: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

app.put(
  '/api/documents/:id/public',
  logAudit(OPERATION_TYPES.DOCUMENT_PUBLIC_CHANGE, {
    getParams: (req) => ({ is_public: req.body?.is_public })
  }),
  requireDocPermission(ROLES.OWNER),
  (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const { is_public } = req.body;
      const result = setDocumentPublic(docId, is_public === true);
      if (!result) {
        return res.status(404).json({ error: '文档不存在' });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ============ 审计日志 API ============

app.get('/api/audit-logs/document/:documentId', (req, res) => {
  try {
    const docId = parseInt(req.params.documentId);
    const userId = req.currentUser.id;
    const doc = getDocumentById(docId, { reload: false });

    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }

    const permissionResult = checkPermission(docId, userId, ROLES.VIEWER, doc.is_public);
    if (!permissionResult.allowed) {
      return res.status(403).json({ error: permissionResult.reason || '权限不足' });
    }

    const { page, page_size, start_time, end_time } = req.query;
    const options = {
      page: page ? parseInt(page) : 1,
      pageSize: page_size ? parseInt(page_size) : 20
    };
    if (start_time) options.startTime = parseInt(start_time);
    if (end_time) options.endTime = parseInt(end_time);

    const result = getLogsByDocument(docId, options);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/audit-logs/user/:userId', (req, res) => {
  try {
    const currentUserId = req.currentUser.id;
    const targetUserId = req.params.userId;

    if (!currentUserId || currentUserId !== targetUserId) {
      const isAdmin = currentUserId && hasAtLeastRole(
        getUserRoleForDocument(1, currentUserId),
        ROLES.OWNER
      );
      if (!isAdmin) {
        return res.status(403).json({ error: '只能查看自己的操作日志' });
      }
    }

    const { page, page_size, start_time, end_time } = req.query;
    const options = {
      page: page ? parseInt(page) : 1,
      pageSize: page_size ? parseInt(page_size) : 20
    };
    if (start_time) options.startTime = parseInt(start_time);
    if (end_time) options.endTime = parseInt(end_time);

    const result = getLogsByUser(targetUserId, options);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/audit-logs/verify', (req, res) => {
  try {
    const result = verifyLogIntegrity();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/current-user', (req, res) => {
  res.json({
    user_id: req.currentUser.id,
    user_name: req.currentUser.name
  });
});

// ============ 页面路由 ============

app.get('/templates', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'templates.html'));
});

app.get('/template-editor', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'template-editor.html'));
});

app.get('/template-editor/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'template-editor.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/contract/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'contract.html'));
});

app.get('/diff', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'diff.html'));
});

app.get('/diff/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'diff.html'));
});

app.get('/review/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'diff.html'));
});

app.get('/mirrors/:documentId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mirror-management.html'));
});

app.get('/translate/:mirrorId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'translation-workbench.html'));
});

seedDemoData();

setInterval(() => {
  try {
    const expiredChanged = checkAndUpdateExpiredContracts();
    if (expiredChanged) {
      wsService.broadcastAllStatus();
    }

    const reminders = checkAndGenerateReminders();
    const warnings = checkAndGenerateDeadlineWarnings();
    const allNotifications = [...reminders, ...warnings];

    if (allNotifications.length > 0) {
      const contractIds = [...new Set(allNotifications.map(n => n.contract_id))];
      contractIds.forEach(contractId => {
        wsService.notifyContractUpdate(contractId, 'notification_updated');
        const notifsForContract = allNotifications.filter(n => n.contract_id === contractId);
        notifsForContract.forEach(notif => {
          wsService.sendNotification(contractId, notif);
        });
      });
      console.log(`[通知检查] 生成 ${reminders.length} 条催办通知, ${warnings.length} 条到期预警`);
    }
  } catch (e) {
    console.error('通知检查出错:', e);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`合同签署平台已启动: http://localhost:${PORT}`);
  console.log(`WebSocket 路径: ws://localhost:${PORT}/ws`);
  console.log(`催办定时器已启动 (每分钟检查一次)`);
  console.log(`权限系统: 通过 X-User-Id header 传递用户标识`);
  console.log(`审计日志: 所有文档操作已记录，使用 SHA-256 哈希链防篡改`);
});

module.exports = { wsService };
