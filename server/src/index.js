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
  revertToVersion
} = require('./documentService');
const {
  createReview,
  getReviewById,
  listReviewsByDocument,
  updateReviewStatus,
  deleteReview,
  addComment,
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

const app = express();
const server = http.createServer(app);
const wsService = new WsService(server);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/documents', (req, res) => {
  try {
    const documents = listDocuments();
    res.json(documents);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documents/:id', (req, res) => {
  try {
    const doc = getDocumentById(parseInt(req.params.id));
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/documents', (req, res) => {
  try {
    const { title, content, description } = req.body;
    if (!title || content === undefined) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const doc = createDocument({ title, content, description });
    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/documents/:id', (req, res) => {
  try {
    const { content, commit_message } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: '缺少内容参数' });
    }
    const doc = updateDocument(parseInt(req.params.id), { content, commit_message });
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  try {
    const success = deleteDocument(parseInt(req.params.id));
    if (!success) {
      return res.status(404).json({ error: '文档不存在' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documents/:id/versions/:version', (req, res) => {
  try {
    const version = getVersion(parseInt(req.params.id), parseInt(req.params.version));
    if (!version) {
      return res.status(404).json({ error: '版本不存在' });
    }
    res.json(version);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documents/:id/diff', (req, res) => {
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
});

app.get('/api/documents/:id/reviews', (req, res) => {
  try {
    const reviews = listReviewsByDocument(parseInt(req.params.id));
    res.json(reviews);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/documents/:id/reviews', (req, res) => {
  try {
    const { old_version, new_version, title, created_by } = req.body;
    if (!old_version || !new_version) {
      return res.status(400).json({ error: '缺少版本参数' });
    }
    const doc = getDocumentById(parseInt(req.params.id));
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }
    const review = createReview({
      document_id: parseInt(req.params.id),
      old_version: parseInt(old_version),
      new_version: parseInt(new_version),
      title,
      created_by
    });
    res.status(201).json(review);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.put('/api/reviews/:id/status', (req, res) => {
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
});

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

app.post('/api/reviews/:id/comments', (req, res) => {
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
      author: author || '匿名用户',
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
});

app.put('/api/comments/:id/resolve', (req, res) => {
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
});

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

app.post('/api/documents/:id/versions/:versionId/tags', (req, res) => {
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
});

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

app.post('/api/documents/:id/revert/:version', (req, res) => {
  try {
    const { commit_message } = req.body;
    const result = revertToVersion(parseInt(req.params.id), parseInt(req.params.version), commit_message);
    if (!result) {
      return res.status(404).json({ error: '文档或版本不存在' });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.get('/api/documents/:id/patches', (req, res) => {
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
});

app.get('/api/documents/:id/patches/stats', (req, res) => {
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
});

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

app.post('/api/documents/:id/patches', (req, res) => {
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
      created_by: created_by || '匿名用户',
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
});

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

app.get('/api/documents/:id/conflicts', (req, res) => {
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
});

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

app.post('/api/documents/:id/merge', (req, res) => {
  try {
    const { version, commit_message, merged_by } = req.body;
    if (!version) {
      return res.status(400).json({ error: '缺少版本参数' });
    }
    const result = mergePatches(parseInt(req.params.id), parseInt(version), {
      commit_message: commit_message || '',
      merged_by: merged_by || '系统'
    });
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error, conflicts: result.conflicts });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reviews/:id/patches', (req, res) => {
  try {
    const patches = listPatchesByReview(parseInt(req.params.id));
    res.json(patches);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.post('/api/templates/:id/render', (req, res) => {
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
});

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
});

module.exports = { wsService };
