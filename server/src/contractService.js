const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'contracts.json');

let data = {
  contracts: [],
  signers: [],
  nextContractId: 1,
  nextSignerId: 1
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
      data = JSON.parse(raw);
    } catch (e) {
      console.warn('数据文件损坏，使用空数据:', e.message);
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

function checkAndUpdateExpiredContracts() {
  let changed = false;
  data.contracts.forEach(c => {
    if (c.status === 'signing' && c.deadline && c.deadline < now()) {
      c.status = 'expired';
      c.updated_at = now();
      changed = true;
    }
  });
  if (changed) saveData();
  return changed;
}

function getCurrentSignerIndex(contractId) {
  const signers = data.signers
    .filter(s => s.contract_id === contractId)
    .sort((a, b) => a.order_index - b.order_index);

  for (let i = 0; i < signers.length; i++) {
    if (!signers[i].signed_at) {
      return i;
    }
  }
  return signers.length;
}

function getContractById(id) {
  checkAndUpdateExpiredContracts();

  const contract = data.contracts.find(c => c.id === id);
  if (!contract) return null;

  const signers = data.signers
    .filter(s => s.contract_id === id)
    .sort((a, b) => a.order_index - b.order_index);

  const currentIndex = getCurrentSignerIndex(id);

  return {
    ...contract,
    signers,
    currentSignerIndex: currentIndex < signers.length ? currentIndex : null,
    totalSigners: signers.length
  };
}

function listContracts() {
  checkAndUpdateExpiredContracts();

  return data.contracts
    .sort((a, b) => b.created_at - a.created_at)
    .map(c => {
      const signers = data.signers.filter(s => s.contract_id === c.id);
      const signedCount = signers.filter(s => s.signed_at).length;
      const currentIndex = signers
        .sort((a, b) => a.order_index - b.order_index)
        .findIndex(s => !s.signed_at);
      return {
        ...c,
        totalSigners: signers.length,
        signedCount,
        currentSignerIndex: currentIndex >= 0 ? currentIndex : null
      };
    });
}

function createContract({ title, content, signers, deadline }) {
  const contractId = data.nextContractId++;
  const contract = {
    id: contractId,
    title,
    content,
    status: 'draft',
    deadline: deadline || null,
    created_at: now(),
    updated_at: now()
  };
  data.contracts.push(contract);

  signers.forEach((s, i) => {
    const signerId = data.nextSignerId++;
    data.signers.push({
      id: signerId,
      contract_id: contractId,
      name: s.name,
      email: s.email,
      order_index: s.order_index ?? i,
      signature_type: null,
      signature_data: null,
      signed_at: null,
      sign_area_x: s.signArea?.x ?? 60,
      sign_area_y: s.signArea?.y ?? 100 + i * 100,
      sign_area_width: s.signArea?.width ?? 200,
      sign_area_height: s.signArea?.height ?? 80
    });
  });

  saveData();
  return getContractById(contractId);
}

function updateContract(id, { title, content, signers, deadline }) {
  const contract = data.contracts.find(c => c.id === id);
  if (!contract) return null;
  if (contract.status !== 'draft') {
    throw new Error('只能修改草稿状态的合同');
  }

  contract.title = title;
  contract.content = content;
  contract.deadline = deadline || null;
  contract.updated_at = now();

  data.signers = data.signers.filter(s => s.contract_id !== id);

  signers.forEach((s, i) => {
    const signerId = data.nextSignerId++;
    data.signers.push({
      id: signerId,
      contract_id: id,
      name: s.name,
      email: s.email,
      order_index: s.order_index ?? i,
      signature_type: null,
      signature_data: null,
      signed_at: null,
      sign_area_x: s.signArea?.x ?? 60,
      sign_area_y: s.signArea?.y ?? 100 + i * 100,
      sign_area_width: s.signArea?.width ?? 200,
      sign_area_height: s.signArea?.height ?? 80
    });
  });

  saveData();
  return getContractById(id);
}

function deleteContract(id) {
  const idx = data.contracts.findIndex(c => c.id === id);
  if (idx === -1) return false;

  data.contracts.splice(idx, 1);
  data.signers = data.signers.filter(s => s.contract_id !== id);
  saveData();
  return true;
}

function startSigning(id) {
  const contract = data.contracts.find(c => c.id === id);
  if (!contract) return null;
  if (contract.status !== 'draft') {
    throw new Error('只有草稿状态的合同才能开始签署');
  }

  const signers = data.signers.filter(s => s.contract_id === id);
  if (signers.length === 0) {
    throw new Error('至少需要一位签署人');
  }

  contract.status = 'signing';
  contract.updated_at = now();
  saveData();

  return getContractById(id);
}

function signContract(contractId, signerId, { signatureType, signatureData }) {
  checkAndUpdateExpiredContracts();

  const contract = data.contracts.find(c => c.id === contractId);
  if (!contract) return { error: '合同不存在', status: 404 };
  if (contract.status !== 'signing') {
    return { error: '合同不在签署中状态', status: 400 };
  }

  const signers = data.signers
    .filter(s => s.contract_id === contractId)
    .sort((a, b) => a.order_index - b.order_index);

  const currentIndex = signers.findIndex(s => !s.signed_at);
  const signerIndex = signers.findIndex(s => s.id === signerId);

  if (signerIndex === -1) {
    return { error: '签署人不存在', status: 404 };
  }

  if (signerIndex !== currentIndex) {
    return { error: '还没轮到您签署', status: 400 };
  }

  if (signers[signerIndex].signed_at) {
    return { error: '您已签署过此合同', status: 400 };
  }

  const signer = data.signers.find(s => s.id === signerId);
  signer.signature_type = signatureType;
  signer.signature_data = signatureData;
  signer.signed_at = now();

  contract.updated_at = now();

  const allSigned = data.signers
    .filter(s => s.contract_id === contractId)
    .every(s => s.signed_at);

  if (allSigned) {
    contract.status = 'completed';
  }

  saveData();

  const updated = getContractById(contractId);
  return { contract: updated, completed: allSigned };
}

loadData();

module.exports = {
  getContractById,
  listContracts,
  createContract,
  updateContract,
  deleteContract,
  startSigning,
  signContract,
  checkAndUpdateExpiredContracts
};
