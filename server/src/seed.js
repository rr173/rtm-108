const { createContract, startSigning, signContract, listContracts } = require('./contractService');
const { createDocument, updateDocument, addTag, listDocuments, getDocumentById } = require('./documentService');
const { createReview, addComment, resolveComment, listReviewsByDocument } = require('./reviewService');
const { createPatch, listPatchesByDocument } = require('./patchService');
const { createTemplate, listTemplates } = require('./templateService');
const { setOwner, addCollaborator } = require('./permissionService');
const { createLog, OPERATION_TYPES, RESULT_TYPES } = require('./auditService');
const {
  createMirror,
  listMirrorsByDocument,
  getMirrorById,
  submitParagraphTranslation,
  submitMirrorVersion,
  getParagraphMappings,
  detectChangesOnMasterUpdate
} = require('./mirrorService');

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
  seedTemplateData();

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

  console.log('初始化权限配置...');
  setOwner(doc.id, 'user-admin');
  addCollaborator(doc.id, 'user-editor', 'editor', 'system-init');
  addCollaborator(doc.id, 'user-viewer', 'viewer', 'system-init');
  console.log('权限配置完成：所有者=user-admin，编辑者=user-editor，只读用户=user-viewer');

  console.log('初始化审计日志...');
  const now = Date.now();
  const baseTime = now - 7 * 24 * 60 * 60 * 1000;

  createLog({
    userId: 'user-admin',
    operation: OPERATION_TYPES.DOCUMENT_CREATE,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { title: doc.title, version: 1 }
  });
  createLog({
    userId: 'user-admin',
    operation: OPERATION_TYPES.DOCUMENT_EDIT,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { from_version: 1, to_version: 2, commit_message: '完善功能列表，增加技术栈和里程碑' }
  });
  createLog({
    userId: 'user-admin',
    operation: OPERATION_TYPES.DOCUMENT_EDIT,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { from_version: 2, to_version: 3, commit_message: '增加用户定位、导出功能、风险评估，调整周期和团队' }
  });
  createLog({
    userId: 'user-admin',
    operation: OPERATION_TYPES.TAG_ADD,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { tag: '初稿', version: 1 }
  });
  createLog({
    userId: 'user-admin',
    operation: OPERATION_TYPES.TAG_ADD,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { tag: '评审稿', version: 2 }
  });
  createLog({
    userId: 'user-editor',
    operation: OPERATION_TYPES.DOCUMENT_VIEW,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { action: 'view_document' }
  });
  createLog({
    userId: 'user-viewer',
    operation: OPERATION_TYPES.DOCUMENT_VIEW,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { action: 'view_document' }
  });
  createLog({
    userId: 'user-viewer',
    operation: OPERATION_TYPES.DOCUMENT_EDIT,
    documentId: doc.id,
    result: RESULT_TYPES.DENIED,
    params: { action: 'attempt_edit' },
    errorMessage: '需要 editor 以上权限'
  });
  createLog({
    userId: 'user-viewer',
    operation: OPERATION_TYPES.DOCUMENT_REVERT,
    documentId: doc.id,
    result: RESULT_TYPES.DENIED,
    params: { revert_to: 1 },
    errorMessage: '需要 owner 以上权限'
  });
  createLog({
    userId: 'user-editor',
    operation: OPERATION_TYPES.VERSION_DIFF,
    documentId: doc.id,
    result: RESULT_TYPES.SUCCESS,
    params: { old_version: 1, new_version: 3 }
  });

  console.log('审计日志初始化完成，共写入 10 条历史操作记录');

  seedReviewData(doc.id);

  setTimeout(() => seedMirrorData(doc.id), 300);
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

  seedPatchData(docId, review.id);
}

function seedPatchData(docId, reviewId) {
  const existingPatches = listPatchesByDocument(docId);
  if (existingPatches.length > 0) {
    console.log('已存在补丁数据，跳过初始化');
    return;
  }

  console.log('初始化演示补丁数据...');

  const patch1 = createPatch({
    document_id: docId,
    version_number: 3,
    start_line: 5,
    end_line: 6,
    replacement_text: '本项目旨在开发一个企业级在线协作平台，支持多人实时编辑、文档管理和团队协作。\n平台采用微服务架构，具备高可用性和可扩展性，支持万人级并发访问。',
    created_by: '张产品',
    description: '优化项目概述，增加企业级定位和并发能力描述',
    review_id: reviewId
  });

  console.log('补丁1已创建（张产品，第5-6行）');

  const patch2 = createPatch({
    document_id: docId,
    version_number: 3,
    start_line: 6,
    end_line: 7,
    replacement_text: '平台采用云原生微服务架构，具备高可用性、高可扩展性和高安全性。\n目标用户：企业团队、教育机构、个人创作者和开源社区。',
    created_by: '李架构师',
    description: '强化技术架构描述，补充云原生和安全性，增加开源社区用户',
    review_id: reviewId
  });

  console.log('补丁2已创建（李架构师，第6-7行） - 与补丁1存在冲突');

  const patch3 = createPatch({
    document_id: docId,
    version_number: 3,
    start_line: 18,
    end_line: 19,
    replacement_text: '1. 用户注册与登录（支持SSO单点登录）\n2. 文档创建与编辑（支持富文本和Markdown）',
    created_by: '王开发',
    description: '丰富功能列表，增加SSO和Markdown支持',
    review_id: reviewId
  });

  console.log('补丁3已创建（王开发，第18-19行） - 无冲突');

  console.log('演示补丁数据初始化完成，共 3 个补丁（2个冲突 + 1个无冲突）');
}

function seedTemplateData() {
  const existingTemplates = listTemplates();
  if (existingTemplates.length > 0) {
    console.log('已存在模板数据，跳过初始化');
    return;
  }

  console.log('初始化演示模板数据...');

  const contractTemplate = createTemplate({
    title: '商务合同模板',
    description: '包含签署人变量和条款条件块的合同模板',
    content: `商务合同

合同编号：{{合同编号}}
签订日期：{{签订日期}}

甲方：{{甲方名称}}
地址：{{甲方地址}}

乙方：{{乙方名称}}
地址：{{乙方地址}}

鉴于甲乙双方本着平等互利的原则，经友好协商，达成如下协议：

第一条 合作内容
{{#if 合作内容}}
{{合作内容}}
{{/if}}
{{#if 无合作内容}}
双方同意在以下领域开展合作：技术研发、市场推广等。
{{/if}}

第二条 合同金额
本合同总金额为人民币 {{合同金额}} 元。
{{#if 含税}}
以上金额已包含相关税费。
{{/if}}
{{#if 不含税}}
以上金额不含税费，税费由付款方另行承担。
{{/if}}

第三条 付款方式
{{#if 分期付款}}
1. 合同签订后支付30%预付款
2. 项目中期支付40%进度款
3. 项目验收完成后支付30%尾款
{{/if}}
{{#if 一次性付款}}
合同签订后一次性全额付款。
{{/if}}

第四条 违约责任
任何一方违反本合同约定，应承担相应的违约责任。

第五条 争议解决
因本合同引起的争议，双方应友好协商解决。

签署：

甲方签署人：{{甲方签署人}}
日期：{{甲方签署日期}}

乙方签署人：{{乙方签署人}}
日期：{{乙方签署日期}}
`
  });

  console.log('演示合同模板已创建，ID:', contractTemplate.id);

  const notifyTemplate = createTemplate({
    title: '批量通知模板',
    description: '包含收件人列表循环块的通知模板',
    content: `通知

发件人：{{发件人}}
主题：{{通知主题}}

亲爱的收件人：

{{#if 重要通知}}
【重要】请务必仔细阅读以下内容：
{{/if}}

{{通知正文}}

{{#each 收件人列表}}
---
致：{{姓名}}
邮箱：{{邮箱}}
{{#if 部门}}
部门：{{部门}}
{{/if}}
{{/each}}

{{#if 需要回复}}
请各位收到请回复确认。
{{/if}}

{{#if 附件列表}}
附件：
{{#each 附件列表}}
- {{文件名}}
{{/each}}
{{/if}}

此致
敬礼！

{{发件人公司}}
{{发送日期}}
`
  });

  console.log('演示通知模板已创建，ID:', notifyTemplate.id);
  console.log('演示模板数据初始化完成');
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

function seedMirrorData(docId) {
  const existingMirrors = listMirrorsByDocument(docId);
  if (existingMirrors && existingMirrors.length > 0) {
    console.log('已存在镜像数据，跳过初始化');
    return;
  }

  console.log('\n========== 初始化多语言镜像演示数据 ==========');

  const EN_TRANSLATIONS = {
    'プロジェクト開発計画': 'Project Development Plan',
    '一、プロジェクト概要': '1. Project Overview',
    '本プロジェクトは、複数人によるリアルタイム編集と文書管理をサポートするオンラインコラボレーションプラットフォームの開発を目的としています。': 'This project aims to develop an online collaboration platform that supports real-time multi-user editing and document management.',
    'プラットフォームはマイクロサービスアーキテクチャを採用し、高可用性と拡張性を備えています。': 'The platform adopts a microservices architecture with high availability and scalability.',
    '対象ユーザー：企業チーム、教育機関、個人クリエイター。': 'Target users: Enterprise teams, educational institutions, and individual creators.',
    '二、主な機能': '2. Main Features',
    '1. ユーザー登録とログイン': '1. User registration and login',
    '2. 文書の作成と編集': '2. Document creation and editing',
    '3. リアルタイムコラボレーション機能': '3. Real-time collaboration features',
    '4. バージョン履歴管理': '4. Version history management',
    '5. コメントと注釈機能': '5. Comments and annotation features',
    '6. 文書エクスポート（PDF、Word）': '6. Document export (PDF, Word)',
    '7. チーム権限管理': '7. Team permission management',
    '三、開発期間': '3. Development Timeline',
    '第一版完成までに4か月を予定。': 'Estimated 4 months to complete the first version.',
    '詳細マイルストーン：': 'Detailed milestones:',
    '- 1か月目：要件分析とアーキテクチャ設計': '- Month 1: Requirements analysis and architecture design',
    '- 2か月目：コア機能開発': '- Month 2: Core feature development',
    '- 3か月目：拡張機能と最適化': '- Month 3: Extended features and optimization',
    '- 4か月目：テストと本番リリース': '- Month 4: Testing and launch',
    '四、チーム体制': '4. Team Composition',
    '- フロントエンド開発：3名': '- Frontend development: 3 people',
    '- バックエンド開発：2名': '- Backend development: 2 people',
    '- テスト：1名': '- Testing: 1 person',
    '- プロダクトマネージャー：1名': '- Product manager: 1 person',
    '- UIデザイナー：1名': '- UI designer: 1 person',
    '五、技術スタック': '5. Technology Stack',
    'フロントエンド：React + TypeScript + Redux': 'Frontend: React + TypeScript + Redux',
    'バックエンド：Node.js + Express + MongoDB': 'Backend: Node.js + Express + MongoDB',
    'データベース：MongoDB + Redisキャッシュ': 'Database: MongoDB + Redis Cache',
    'リアルタイム通信：WebSocket': 'Real-time communication: WebSocket',
    'デプロイ：Docker + Kubernetes': 'Deployment: Docker + Kubernetes',
    '六、リスク評価': '6. Risk Assessment',
    '1. 技術リスク：リアルタイムコラボレーションアルゴリズムの複雑さが高い': '1. Technical risk: High complexity of real-time collaboration algorithm',
    '2. スケジュールリスク：機能拡張による延期の可能性': '2. Schedule risk: Feature expansion may cause delays',
    '3. 品質リスク：多人数コラボレーションシナリオのテスト難度': '3. Quality risk: Difficulty in testing multi-user collaboration scenarios',
    '対策：': 'Mitigation measures:',
    '- 事前にキーテクノロジーの予備調査を実施': '- Pre-research key technologies in advance',
    '- アジャイル開発を採用し、段階的にデリバリー': '- Adopt agile development and phased delivery',
    '- 自動テストカバレッジの拡充': '- Increase automated test coverage'
  };

  const JA_PARTIAL_TRANSLATIONS = {
    'プロジェクト開発計画': 'プロジェクト開発計画',
    '一、プロジェクト概要': '一、プロジェクト概要',
    '本プロジェクトは、複数人によるリアルタイム編集と文書管理をサポートするオンラインコラボレーションプラットフォームの開発を目的としています。': '本プロジェクトは、複数人によるリアルタイム編集と文書管理をサポートするオンラインコラボレーションプラットフォームの開発を目的としています。',
    'プラットフォームはマイクロサービスアーキテクチャを採用し、高可用性と拡張性を備えています。': 'プラットフォームはマイクロサービスアーキテクチャを採用し、高可用性と拡張性を備えています。',
    '対象ユーザー：企業チーム、教育機関、個人クリエイター。': '',
    '二、主な機能': '二、主な機能',
    '1. ユーザー登録とログイン': '1. ユーザー登録とログイン',
    '2. 文書の作成と編集': '2. 文書の作成と編集',
    '3. リアルタイムコラボレーション機能': '3. リアルタイムコラボレーション機能',
    '4. バージョン履歴管理': '4. バージョン履歴管理',
    '5. コメントと注釈機能': '',
    '6. 文書エクスポート（PDF、Word）': '',
    '7. チーム権限管理': '',
    '三、開発期間': '三、開発期間',
    '第一版完成までに4か月を予定。': '',
    '詳細マイルストーン：': '',
    '- 1か月目：要件分析とアーキテクチャ設計': '',
    '- 2か月目：コア機能開発': '',
    '- 3か月目：拡張機能と最適化': '',
    '- 4か月目：テストと本番リリース': '',
    '四、チーム体制': '四、チーム体制',
    '- フロントエンド開発：3名': '',
    '- バックエンド開発：2名': '',
    '- テスト：1名': '',
    '- プロダクトマネージャー：1名': '',
    '- UIデザイナー：1名': '',
    '五、技術スタック': '五、技術スタック',
    'フロントエンド：React + TypeScript + Redux': '',
    'バックエンド：Node.js + Express + MongoDB': '',
    'データベース：MongoDB + Redisキャッシュ': '',
    'リアルタイム通信：WebSocket': '',
    'デプロイ：Docker + Kubernetes': '',
    '六、リスク評価': '六、リスク評価',
    '1. 技術リスク：リアルタイムコラボレーションアルゴリズムの複雑さが高い': '',
    '2. スケジュールリスク：機能拡張による延期の可能性': '',
    '3. 品質リスク：多人数コラボレーションシナリオのテスト難度': '',
    '対策：': '',
    '- 事前にキーテクノロジーの予備調査を実施': '',
    '- アジャイル開発を採用し、段階的にデリバリー': '',
    '- 自動テストカバレッジの拡充': ''
  };

  function buildTranslationLines(masterContent, translationMap, defaultEmpty = false) {
    const lines = masterContent.split('\n');
    return lines.map(line => {
      if (line.trim() === '') return '';
      if (translationMap[line] !== undefined) {
        return translationMap[line];
      }
      return defaultEmpty ? '' : line;
    });
  }

  function translateAllPending(mirrorId, masterVersion, translationMap, translatorName, defaultTranslate = false) {
    const mappings = getParagraphMappings(mirrorId);
    let translatedCount = 0;
    mappings.forEach(mapping => {
      if (mapping.status === 'new' || mapping.status === 'outdated') {
        const translated = translationMap[mapping.master_content];
        const finalContent = (translated !== undefined && translated !== '')
          ? translated
          : (defaultTranslate ? `[${translatorName}] ${mapping.master_content}` : '');

        if (finalContent) {
          submitParagraphTranslation({
            mirrorId,
            mappingId: mapping.id,
            translatedContent: finalContent,
            translator: translatorName
          });
          translatedCount++;
        }
      }
    });
    return translatedCount;
  }

  console.log('\n【ステップ1】主ドキュメント v3 をベースに英語镜像を作成（完全翻訳）...');

  const doc = getDocumentById(docId, { reload: false });
  const masterV3Content = doc.versions[doc.versions.length - 1].content;
  const enLines = buildTranslationLines(masterV3Content, EN_TRANSLATIONS, false);

  const enMirror = createMirror({
    documentId: docId,
    languageCode: 'en-US',
    initialContent: null,
    createdBy: 'Translator-Alice'
  });

  if (enMirror.error) {
    console.error('英語镜像作成失敗:', enMirror.error);
  } else {
    console.log(`✅ 英語镜像作成完了 (ID: ${enMirror.id}) - 段落数: ${enMirror.total_paragraph_count}`);

    const enTranslated = translateAllPending(enMirror.id, 3, EN_TRANSLATIONS, 'Translator-Alice', true);
    console.log(`   提交翻译段落: ${enTranslated} 个`);

    const enAfterTranslate = getMirrorById(enMirror.id);
    console.log(`   待同步: ${enAfterTranslate.pending_paragraph_count} / ${enAfterTranslate.total_paragraph_count}`);

    const enVersionResult = submitMirrorVersion({
      mirrorId: enMirror.id,
      commitMessage: 'Initial English translation based on master v3',
      submittedBy: 'Translator-Alice'
    });

    if (enVersionResult.error) {
      console.warn('⚠️ 英語镜像バージョン発行失敗:', enVersionResult.error);
    } else {
      console.log(`✅ 英語镜像 v${enVersionResult.version.version_number} 発行完了`);
      console.log(`   主ドキュメント v${enVersionResult.mirror.synced_master_version} ベース`);
      console.log(`   同期状態: ${enVersionResult.mirror.sync_status} (${enVersionResult.mirror.synchronized_paragraph_count}/${enVersionResult.mirror.total_paragraph_count})`);
    }
  }

  console.log('\n【ステップ2】主ドキュメント v3 をベースに日本語镜像を作成（部分翻訳、意図的に半数残し）...');

  const jaMirror = createMirror({
    documentId: docId,
    languageCode: 'ja-JP',
    initialContent: null,
    createdBy: 'Translator-Bob'
  });

  if (jaMirror.error) {
    console.error('日本語镜像作成失敗:', jaMirror.error);
  } else {
    console.log(`✅ 日本語镜像作成完了 (ID: ${jaMirror.id}) - 段落数: ${jaMirror.total_paragraph_count}`);

    const jaTranslated = translateAllPending(jaMirror.id, 3, JA_PARTIAL_TRANSLATIONS, 'Translator-Bob', false);
    console.log(`   提交翻译段落: ${jaTranslated} 个（意図的に一部未翻訳）`);

    const jaAfterTranslate = getMirrorById(jaMirror.id);
    console.log(`   状態: 待同期 - 同期済み ${jaAfterTranslate.synchronized_paragraph_count} / 全体 ${jaAfterTranslate.total_paragraph_count}, 未処理 ${jaAfterTranslate.pending_paragraph_count} 段落`);
  }

  console.log('\n【ステップ3】主ドキュメントを v3 → v4 に更新（镜像状態遷移をデモ）...');

  const docBefore = getDocumentById(docId, { reload: false });
  const oldVersionNum = docBefore && docBefore.versions.length > 0
    ? docBefore.versions[docBefore.versions.length - 1].version_number
    : 0;

  const v4Content = `プロジェクト開発計画

一、プロジェクト概要
本プロジェクトは、複数人によるリアルタイム編集と文書管理をサポートするオンラインコラボレーションプラットフォームの開発を目的としています。
プラットフォームはマイクロサービスアーキテクチャを採用し、高可用性と拡張性を備えています。
対象ユーザー：企業チーム、教育機関、個人クリエイター。
**新規追加**: オープンソースコミュニティ向けの特別プランを提供予定。

二、主な機能
1. ユーザー登録とログイン
2. 文書の作成と編集
3. リアルタイムコラボレーション機能
4. バージョン履歴管理
5. コメントと注釈機能
6. 文書エクスポート（PDF、Word）
7. チーム権限管理
8. **新規追加**: AI翻訳アシスト（多语言镜像連携）
9. **新規追加**: 変更履歴の可視化グラフ

三、開発期間
第一版完成までに**4.5か月**を予定。
詳細マイルストーン：
- 1か月目：要件分析とアーキテクチャ設計
- 2か月目：コア機能開発
- 3か月目：拡張機能と最適化
- 4か月目：テストと本番リリース準備
- **変更**: 4.5か月目：ベータテストと最終調整

四、チーム体制
- フロントエンド開発：3名
- バックエンド開発：2名
- テスト：1名
- プロダクトマネージャー：1名
- UIデザイナー：1名
- **新規追加**: 多语言担当：1名

五、技術スタック
フロントエンド：React + TypeScript + Redux + **新規**: i18n国際化対応
バックエンド：Node.js + Express + MongoDB
データベース：MongoDB + Redisキャッシュ
リアルタイム通信：WebSocket
デプロイ：Docker + Kubernetes
**削除予定**: レガシーモノリスサポート

六、リスク評価
1. 技術リスク：リアルタイムコラボレーションアルゴリズムの複雑さが高い
2. スケジュールリスク：機能拡張による延期の可能性
3. 品質リスク：多人数コラボレーションシナリオのテスト難度
4. **新規追加**: 多语言镜像の同期タイムラグによる不整合リスク

対策：
- 事前にキーテクノロジーの予備調査を実施
- アジャイル開発を採用し、段階的にデリバリー
- 自動テストカバレッジの拡充
- **新規**: 镜像同期アルゴリズムの段階的なリリース`;

  const updatedDoc = updateDocument(docId, {
    content: v4Content,
    commit_message: 'v4: 多语言镜像功能发布准备，新增AI翻译、调整团队'
  });

  const docAfter = getDocumentById(docId, { reload: false });
  const newVersionNum = docAfter && docAfter.versions.length > 0
    ? docAfter.versions[docAfter.versions.length - 1].version_number
    : oldVersionNum;

  if (newVersionNum > oldVersionNum) {
    detectChangesOnMasterUpdate(docId, oldVersionNum, newVersionNum);
    console.log(`✅ 主ドキュメント v${oldVersionNum} → v${newVersionNum} 更新完了！`);
    console.log('   镜像过期段落検知完了！');

    const finalMirrors = listMirrorsByDocument(docId);
    console.log('\n【最終状態】');
    finalMirrors.forEach(m => {
      const statusText = m.sync_status === 'synced' ? '✅ 同期済み'
        : m.sync_status === 'outdated' ? '⚠️ 主ドキュメント更新済み（过期段落あり）'
        : '⏳ 未処理あり';
      console.log(`\n  ${m.language_flag} ${m.language_name} (${m.language_code}):`);
      console.log(`    - 同期状態: ${m.sync_status} → ${statusText}`);
      console.log(`    - 主ドキュメント: v${m.synced_master_version} → 最新 v${m.latest_master_version}`);
      console.log(`    - 段落: 同期済み ${m.synchronized_paragraph_count} / 全体 ${m.total_paragraph_count} / 未処理 ${m.pending_paragraph_count}`);
    });

    const latestVersion = docAfter.versions[docAfter.versions.length - 1];
    addTag(docId, latestVersion.id, '镜像演示版');

    console.log('\n💡 演示提示：');
    console.log('   1. 镜像管理 → http://localhost:3000/mirror-management.html?docId=1');
    console.log('   2. 2つの镜像の状態違いを確認');
    console.log('      🇺🇸 英語: 同期済みだったが主ドキュメント更新により ⚠️outdated 状態に');
    console.log('      🇯🇵 日本語: 元々未処理あり ⏳pending 状態が継続');
    console.log('   3. 「翻訳ワークベンチ」を開いて左右対照インターフェースで过期段落を確認');
    console.log('   4. 过期段落を翻訳・提交 → 全て完了したら镜像バージョンを発行可能');
    console.log('   5. 別ブラウザで同じ镜像を開き、片方で提交するともう片方のリストが实时更新されることを確認');
    console.log('   6. 主ドキュメントを再度更新すると、同期済み镜像も自动的に未処理状態に戻ります');
  } else {
    console.log('⚠️ 主ドキュメントに更新はありませんでした');
  }

  console.log('\n✅ 多语言镜像演示データ初期化完了！');
}

module.exports = seedDemoData;
