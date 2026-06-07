const { createContract, startSigning, signContract, listContracts } = require('./contractService');

function seedDemoData() {
  const existing = listContracts();
  if (existing.length > 0) {
    console.log('已存在合同数据，跳过初始化演示数据');
    return;
  }

  console.log('初始化演示合同数据...');

  const demoContract = createContract({
    title: '产品开发合作协议',
    content: `产品开发合作协议

甲方：创新科技有限公司
乙方：数字未来工作室
丙方：云服务提供商股份有限公司

鉴于三方有意在产品开发领域开展深度合作，经友好协商，达成如下协议：

第一条 合作内容
1.1 三方共同开发新一代智能管理平台，包括前端系统、后端服务和云基础设施。
1.2 甲方负责产品设计和市场推广，乙方负责软件开发和技术实现，丙方负责云服务支持和运维保障。

第二条 合作期限
2.1 本协议有效期自签署之日起两年。
2.2 期满前三个月，三方可协商续约事宜。

第三条 权利与义务
3.1 甲方拥有产品的最终决策权和市场主导权。
3.2 乙方保证代码质量和开发进度。
3.3 丙方提供稳定可靠的云服务支持。

第四条 收益分配
4.1 产品盈利部分按甲方50%、乙方35%、丙方15%的比例分配。
4.2 每季度末进行一次结算。

第五条 保密条款
5.1 三方对合作过程中知悉的商业秘密和技术资料负有保密义务。
5.2 保密期限自本协议签署之日起五年。

第六条 违约责任
6.1 任何一方违反本协议约定，应承担相应的违约责任。
6.2 因不可抗力导致无法履行的，不承担违约责任。

第七条 争议解决
7.1 因本协议发生争议，三方应友好协商解决。
7.2 协商不成的，提交合同签订地有管辖权的人民法院诉讼解决。

第八条 其他
8.1 本协议自三方法定代表人或授权代表签字并加盖公章之日起生效。
8.2 本协议一式三份，三方各执一份，具有同等法律效力。`,
    signers: [
      { name: '张明（甲方）', email: 'zhangming@example.com', order_index: 0, signArea: { x: 60, y: 520, width: 180, height: 70 } },
      { name: '李华（乙方）', email: 'lihua@example.com', order_index: 1, signArea: { x: 310, y: 520, width: 180, height: 70 } },
      { name: '王芳（丙方）', email: 'wangfang@example.com', order_index: 2, signArea: { x: 560, y: 520, width: 180, height: 70 } }
    ],
    deadline: Date.now() + 7 * 24 * 60 * 60 * 1000
  });

  console.log('演示合同已创建，ID:', demoContract.id);

  const started = startSigning(demoContract.id);
  console.log('合同已进入签署状态');

  const firstSigner = started.signers[0];
  const result = signContract(started.id, firstSigner.id, {
    signatureType: 'canvas',
    signatureData: generateFakeSignature()
  });

  console.log('第一位签署人（张明）已完成签署');
  console.log('当前等待第二位签署人（李华）签署');
  console.log('演示数据初始化完成');
}

function generateFakeSignature() {
  const canvasData = `data:image/svg+xml;base64,${Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="70" viewBox="0 0 180 70">
  <path d="M10,45 Q25,15 50,35 T90,30 Q110,20 135,40 Q150,50 170,30" 
        fill="none" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/>
  <text x="15" y="60" font-family="cursive" font-size="14" fill="#1a1a2e">Zhang Ming</text>
</svg>
`).toString('base64')}`;
  return canvasData;
}

module.exports = seedDemoData;
