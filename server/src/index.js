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

const app = express();
const server = http.createServer(app);
const wsService = new WsService(server);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/contract/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'contract.html'));
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
