const { createContract, startSigning, signContract, listContracts } = require('./contractService');
const { createDocument, updateDocument, addTag, listDocuments } = require('./documentService');
const { createReview, addComment, resolveComment, listReviewsByDocument } = require('./reviewService');

function seedDemoData() {
  const existingContracts = listContracts();
  if (existingContracts.length === 0) {
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
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
      reminderHours: 0.01
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
  } else {
    console.log('已存在合同数据，跳过初始化');
  }

  seedDocumentData();

  console.log('演示数据初始化完成');
}

function seedDocumentData() {
  const existingDocs = listDocuments();
  if (existingDocs.length > 0) {
    console.log('已存在文档数据，跳过初始化');
    return;
  }

  console.log('初始化演示文档数据...');

  const v1Content = `项目开发计划

一、项目概述
本项目旨在开发一个在线协作平台，支持多人实时编辑和文档管理。

二、主要功能
1. 用户注册与登录
2. 文档创建与编辑
3. 实时协作功能

三、开发周期
预计3个月完成第一版。

四、团队分工
- 前端开发：2人
- 后端开发：2人
- 测试：1人`;

  const doc = createDocument({
    title: '项目开发计划书',
    content: v1Content,
    description: '产品开发项目的整体规划文档'
  });

  console.log('演示文档已创建，ID:', doc.id, '当前版本: v1');

  const v2Content = `项目开发计划

一、项目概述
本项目旨在开发一个在线协作平台，支持多人实时编辑和文档管理。
平台采用微服务架构，具备高可用性和可扩展性。

二、主要功能
1. 用户注册与登录
2. 文档创建与编辑
3. 实时协作功能
4. 版本历史管理
5. 评论与批注功能

三、开发周期
预计3个月完成第一版。
详细里程碑：
- 第1个月：需求分析与架构设计
- 第2个月：核心功能开发
- 第3个月：测试与上线

四、团队分工
- 前端开发：2人
- 后端开发：2人
- 测试：1人
- 产品经理：1人

五、技术栈
前端：React + TypeScript
后端：Node.js + Express
数据库：MongoDB
实时通信：WebSocket`;

  const doc2 = updateDocument(doc.id, {
    content: v2Content,
    commit_message: '完善功能列表，增加技术栈和里程碑'
  });

  console.log('已更新到 v2，新增内容：技术栈、里程碑、产品经理角色');

  const firstVersion = doc2.versions[0];
  addTag(doc.id, firstVersion.id, '初稿');

  const secondVersion = doc2.versions[1];
  addTag(doc.id, secondVersion.id, '评审稿');

  console.log('已添加标签：v1=初稿，v2=评审稿');

  const v3Content = `项目开发计划

一、项目概述
本项目旨在开发一个在线协作平台，支持多人实时编辑和文档管理。
平台采用微服务架构，具备高可用性和可扩展性。
目标用户：企业团队、教育机构、个人创作者。

二、主要功能
1. 用户注册与登录
2. 文档创建与编辑
3. 实时协作功能
4. 版本历史管理
5. 评论与批注功能
6. 文档导出（PDF、Word）
7. 团队权限管理

三、开发周期
预计4个月完成第一版。
详细里程碑：
- 第1个月：需求分析与架构设计
- 第2个月：核心功能开发
- 第3个月：扩展功能与优化
- 第4个月：测试与上线

四、团队分工
- 前端开发：3人
- 后端开发：2人
- 测试：1人
- 产品经理：1人
- UI设计师：1人

五、技术栈
前端：React + TypeScript + Redux
后端：Node.js + Express + MongoDB
数据库：MongoDB + Redis缓存
实时通信：WebSocket
部署：Docker + Kubernetes

六、风险评估
1. 技术风险：实时协作算法复杂度较高
2. 进度风险：功能扩展可能导致延期
3. 质量风险：多人协作场景测试难度大

应对措施：
- 提前预研关键技术
- 采用敏捷开发，分阶段交付
- 增加自动化测试覆盖率`;

  const doc3 = updateDocument(doc.id, {
    content: v3Content,
    commit_message: '增加用户定位、导出功能、风险评估，调整周期和团队'
  });

  const latestVersion = doc3.versions[doc3.versions.length - 1];
  addTag(doc.id, latestVersion.id, '发布版');

  console.log('已更新到 v3，新增内容：用户定位、导出功能、团队扩展、风险评估');
  console.log('已添加标签：v3=发布版');
  console.log('演示文档初始化完成，共 3 个版本');

  seedReviewData(doc.id);
}

function seedReviewData(docId) {
  const existingReviews = listReviewsByDocument(docId);
  if (existingReviews.length > 0) {
    console.log('已存在评审数据，跳过初始化');
    return;
  }

  console.log('初始化演示评审数据...');

  const review = createReview({
    document_id: docId,
    old_version: 1,
    new_version: 3,
    title: 'v1 vs v3 版本评审',
    created_by: '张经理'
  });

  console.log('演示评审已创建，ID:', review.id);

  const comment1 = addComment({
    review_id: review.id,
    new_line: 4,
    content: '这里新增的"平台采用微服务架构"描述得很好，明确了技术方向。建议补充一下微服务的具体拆分策略。',
    author: '李工程师'
  });

  console.log('已添加第一条评论（第4行）');

  const reply1 = addComment({
    review_id: review.id,
    content: '同意，后续我们会在技术方案文档中详细说明微服务的拆分原则和服务边界。',
    author: '王架构师',
    parent_id: comment1.id
  });

  console.log('已添加回复评论');

  const comment2 = addComment({
    review_id: review.id,
    new_line: 21,
    content: '开发周期从3个月延长到4个月，能说明一下主要是哪部分工作增加了吗？是风险评估部分导致的延期吗？',
    author: '陈产品'
  });

  resolveComment(comment2.id);

  console.log('已添加第二条评论（第21行）并标记为已解决');

  console.log('演示评审数据初始化完成');
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
