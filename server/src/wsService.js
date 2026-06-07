const WebSocket = require('ws');
const { getContractById, checkAndUpdateExpiredContracts } = require('./contractService');

class WsService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.subscriptions = new Map();
    this.clientContracts = new Map();

    this.wss.on('connection', (ws) => {
      ws.id = Math.random().toString(36).substr(2, 9);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
      });
    });

    setInterval(() => {
      const changed = checkAndUpdateExpiredContracts();
      if (changed) {
        this.broadcastAllStatus();
      }
    }, 10000);
  }

  handleMessage(ws, data) {
    switch (data.type) {
      case 'subscribe':
        this.subscribe(ws, data.contractId);
        break;
      case 'unsubscribe':
        this.unsubscribe(ws, data.contractId);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }

  subscribe(ws, contractId) {
    if (!this.subscriptions.has(contractId)) {
      this.subscriptions.set(contractId, new Set());
    }
    this.subscriptions.get(contractId).add(ws);

    if (!this.clientContracts.has(ws)) {
      this.clientContracts.set(ws, new Set());
    }
    this.clientContracts.get(ws).add(contractId);

    const contract = getContractById(contractId);
    if (contract) {
      ws.send(JSON.stringify({
        type: 'contract_status',
        contract
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: '合同不存在'
      }));
    }
  }

  unsubscribe(ws, contractId) {
    if (this.subscriptions.has(contractId)) {
      this.subscriptions.get(contractId).delete(ws);
    }
    if (this.clientContracts.has(ws)) {
      this.clientContracts.get(ws).delete(contractId);
    }
  }

  cleanupClient(ws) {
    const contracts = this.clientContracts.get(ws);
    if (contracts) {
      contracts.forEach(contractId => {
        if (this.subscriptions.has(contractId)) {
          this.subscriptions.get(contractId).delete(ws);
        }
      });
      this.clientContracts.delete(ws);
    }
  }

  notifyContractUpdate(contractId, eventType = 'contract_updated') {
    const contract = getContractById(contractId);
    if (!contract) return;

    const message = JSON.stringify({
      type: eventType,
      contract
    });

    if (this.subscriptions.has(contractId)) {
      this.subscriptions.get(contractId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  broadcastAllStatus() {
    this.subscriptions.forEach((clients, contractId) => {
      const contract = getContractById(contractId);
      if (contract) {
        const message = JSON.stringify({
          type: 'contract_status',
          contract
        });
        clients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }
    });
  }
}

module.exports = WsService;
