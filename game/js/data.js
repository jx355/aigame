/*
 * data.js —— 常量数据层（零逻辑）
 * 职责：只放游戏里所有"写死"的常量与文案，供 logic / ui / main 读取。
 * 禁止：不得写任何计算逻辑，不得引用 DOM。
 * 全部挂到全局 window.GAME_DATA（浏览器）上；node 测试不需要本文件。
 */

(function (root) {
  'use strict';

  // ===== 数值表：每个任务四维度独立开关的增量 =====
  // 相对"基线任务"的增量；正=增加，负=减少。
  // 工期单位：周；其余为无量纲点数。
  // 设计文档第 7 节表格里的 "+/-" 占位，此处给出具体初值，待试玩校准。
  // 注：技术债会在后续任务按系数放大"工期/缺陷"（见 logic.js 的 AMPLIFY）。
  // 注意：prompt 精致 的资金为 -1（更费 token/人工），属设计原文占位"−"。
  //       review/test/refactor 的精力：关=省力(+)，开=费力(-)，属设计原文占位"+/-"。
  var STRATEGY_TABLE = {
    prompt: {
      省:   { timeline: -1,   defects: +1, techDebt: 0,  reputation: 0,  energy: 0,  funds: 0 },  // 待试玩校准
      精致: { timeline: +0.5, defects: -1, techDebt: 0,  reputation: +1, energy: 0,  funds: -1 }  // 待试玩校准
    },
    review: {
      关: { timeline: -0.5, defects: +2, techDebt: +1, reputation: -1, energy: +1, funds: 0 },  // 待试玩校准
      开: { timeline: +0.5, defects: -2, techDebt: -1, reputation: +1, energy: -1, funds: 0 }    // 待试玩校准
    },
    test: {
      关: { timeline: -1,   defects: +3, techDebt: +1, reputation: -2, energy: +1, funds: 0 },  // 待试玩校准
      开: { timeline: +1,   defects: -3, techDebt: -1, reputation: +2, energy: -2, funds: 0 }    // 待试玩校准
    },
    refactor: {
      关: { timeline: -0.5, defects: +1, techDebt: +3, reputation: -1, energy: +1, funds: 0 },  // 待试玩校准
      开: { timeline: +0.5, defects: -1, techDebt: -3, reputation: +1, energy: -1, funds: 0 }    // 待试玩校准
    }
  };

  // 四维度的中文标签与可选项（顺序即界面展示顺序）
  var STRATEGY_DIMS = [
    { key: 'prompt',   label: '提示词',     options: ['省', '精致'] },
    { key: 'review',   label: '代码评审',   options: ['关', '开'] },
    { key: 'test',     label: '写测试',     options: ['关', '开'] },
    { key: 'refactor', label: '重构',       options: ['关', '开'] }
  ];

  // 每个任务的基础工期（周），再叠加上面各维度增量
  var BASE_TASK_WEEKS = 2; // 待试玩校准

  // 技术债放大系数：后续任务工期/缺陷 = 自身增量 × (1 + 累计技术债 × AMPLIFY)
  // 放大系数在 logic.js 内被钳制在 [0.6, 1.5]，避免单局/跨局失控式雪崩。
  var AMPLIFY = 0.03; // 待试玩校准

  // ===== 项目卡池（模板）=====
  // scale: S/M/L 决定任务数；budget 为预算(万)，作为本局报酬基准。
  // hiddenNeed: 隐藏需求，结算时按整体质量给口碑 ±1（见 logic.js）。
  var PROJECT_POOL = [
    { name: '电商秒杀系统',   scale: 'L', clientType: '创业公司', hiddenNeed: '高并发性能' },
    { name: '企业内部审批流', scale: 'M', clientType: '国企',     hiddenNeed: '安全合规' },
    { name: '个人博客站点',   scale: 'S', clientType: '个人',     hiddenNeed: '无' },
    { name: '在线教育平台',   scale: 'L', clientType: '外企',     hiddenNeed: '国际化多语言' },
    { name: '外卖点餐小程序', scale: 'M', clientType: '创业公司', hiddenNeed: '弱网体验' },
    { name: '医院挂号系统',   scale: 'L', clientType: '国企',     hiddenNeed: '数据隐私合规' },
    { name: '健身打卡 App',   scale: 'S', clientType: '个人',     hiddenNeed: '无' },
    { name: '供应链中台',     scale: 'L', clientType: '外企',     hiddenNeed: '多系统对接' },
    { name: '活动报名页',     scale: 'S', clientType: '创业公司', hiddenNeed: '无' },
    { name: '智能客服机器人', scale: 'M', clientType: '外企',     hiddenNeed: '语料质量' }
  ];

  // 规模 → 任务数 / 预算(万) / 缺陷容忍阈值
  var SCALE_CFG = {
    S: { tasks: 3, budget: 8,  maxDefects: 3 }, // 待试玩校准
    M: { tasks: 5, budget: 15, maxDefects: 5 }, // 待试玩校准
    L: { tasks: 8, budget: 28, maxDefects: 8 }  // 待试玩校准
  };

  // 任务名素材（拆任务时按规模随机拼接，纯装饰）
  var TASK_NAMES = [
    '需求澄清', '接口设计', '数据建模', '核心逻辑', '页面交互',
    '联调测试', '权限模块', '性能优化', '异常处理', '部署上线',
    '日志监控', '文档补全'
  ];

  // ===== AI agent 拟人化 trait 池（7 个，见设计第 5.1 节）=====
  // effect 为本任务额外增量；正向/负向仅作倾向说明。
  var TRAIT_POOL = [
    { id: 'overdesign',  name: '过度设计癖', desc: '爱加没用的抽象层',     effect: { timeline: +0.5, defects: 0, techDebt: -1, reputation: 0, energy: 0, funds: 0 } }, // 待试玩校准
    { id: 'hallucinate', name: '幻觉天才',   desc: '写得快但常编出错',     effect: { timeline: -0.5, defects: +2, techDebt: 0,  reputation: 0, energy: 0, funds: 0 } }, // 待试玩校准
    { id: 'shortcut',    name: '捷径大师',   desc: '怎么快怎么来',         effect: { timeline: -0.5, defects: 0, techDebt: +2, reputation: 0, energy: 0, funds: 0 } }, // 待试玩校准
    { id: 'scholar',     name: '严谨老学究', desc: '慢但极少出错',         effect: { timeline: +0.5, defects: -2, techDebt: 0,  reputation: 0, energy: 0, funds: 0 } }, // 待试玩校准
    { id: 'sycophant',   name: '马屁精',     desc: '顺你意图、不敢质疑',   effect: { timeline: 0,    defects: +1, techDebt: 0,  reputation: +1, energy: 0, funds: 0 } }, // 待试玩校准
    { id: 'lazy',        name: '偷懒鬼',     desc: '能不写就不写',         effect: { timeline: -0.5, defects: +2, techDebt: 0,  reputation: 0, energy: +1, funds: 0 } }, // 待试玩校准
    { id: 'perfection',  name: '完美主义',   desc: '慢、爱重构',           effect: { timeline: +0.5, defects: 0, techDebt: -2, reputation: 0, energy: 0, funds: 0 } }  // 待试玩校准
  ];

  // ===== 随机事件池（12 个，见设计第 5.2 节）=====
  // effect 为增量补丁；weight 为相对触发权重；chance 为单任务触发概率。
  // 事件只对"触发它的那个任务"生效（在 applyStrategy 之后叠加）。
  var EVENT_POOL = [
    { id: 'friday',     name: '甲方周五晚改需求', desc: '范围蔓延，工期 +1 周',           effect: { timeline: +1, defects: 0,  techDebt: 0, reputation: 0,  energy: 0,  funds: 0 } },
    { id: 'modelver',   name: '模型大版本更新',   desc: '旧提示词效果衰减，返工↑',         effect: { timeline: 0,  defects: +1, techDebt: 0, reputation: 0,  energy: 0,  funds: 0 } },
    { id: 'downtime',   name: '服务器宕机',       desc: '本任务工期被拖累',                 effect: { timeline: +1, defects: 0,  techDebt: 0, reputation: 0,  energy: 0,  funds: 0 } },
    { id: 'inspire',    name: '灵感爆发',         desc: '一次过，缺陷↓',                   effect: { timeline: 0,  defects: -2, techDebt: 0, reputation: 0,  energy: 0,  funds: 0 } },
    { id: 'cve',        name: '开源库爆漏洞',     desc: '被迫升级，技术债+',               effect: { timeline: 0,  defects: 0,  techDebt: +2, reputation: 0,  energy: 0,  funds: 0 } },
    { id: 'quit',       name: '同事离职',         desc: '精力−',                           effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: 0,  energy: -2, funds: 0 } },
    { id: 'investor',   name: '投资人加预算',     desc: '资金+',                           effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: 0,  energy: 0,  funds: +3 } },
    { id: 'prcrash',    name: '行业热搜翻车',     desc: '口碑−',                           effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: -2, energy: 0,  funds: 0 } },
    { id: 'newlang',    name: '新语言/框架流行',  desc: '写测试则收益，否则返工',           effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: 0,  energy: 0,  funds: 0 }, conditional: true },
    { id: 'checkup',    name: '体检警告',         desc: '过度压榨，精力−',                 effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: 0,  energy: -3, funds: 0 } },
    { id: 'praise',     name: '用户好评如潮',     desc: '口碑+',                           effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: +3, energy: 0,  funds: 0 } },
    { id: 'rival',      name: '竞品抢先发布',     desc: '口碑−（技术债低则缓冲）',         effect: { timeline: 0,  defects: 0,  techDebt: 0, reputation: -2, energy: 0,  funds: 0 }, conditional: true }
  ];

  // 单任务触发事件的基准概率（掷骰命中才触发）
  var EVENT_CHANCE = 0.45; // 待试玩校准

  // ===== 时代观察文案（按决策风格，见设计第 6 节）=====
  var NARRATIVE = {
    重速度: '你交付得最快，也最快忘记自己交付了什么。速度成了习惯，判断却悄悄生锈。',
    重质量: '你交付得慢，但每一行都经得起追问。当 AI 写得越来越快，肯慢下来的人反而稀缺。',
    重平衡: '你在快与稳之间反复掂量。这掂量的功夫，正是 AI 替你写不出、也替你担不了的东西。'
  };

  // ===== 多结局文案（见设计第 6 节）=====
  // 条件在 logic.pickEnding 里按历史判定；此处只放文案。
  var ENDINGS = {
    master: {
      title: '🤝 人机协作大师',
      text: '你让 AI 写，自己判。技术债始终在可控水位，口碑稳步累积。你证明了：当机器接管"写"，人类守住"判"，才是最贵的能力。'
    },
    collapse: {
      title: '💥 技术债崩盘',
      text: '你一路省事，技术债像雪球滚成雪崩。某天改一个小需求要动半个系统，你终于分不清——到底是你用 AI，还是债在用你。'
    },
    lineworker: {
      title: '🏭 流水线工人',
      text: '你交付了不少，也赚到了钱，但你越来越像流水线上按下"生成"按钮的人。活儿是做了，判断力却没长。'
    },
    awakened: {
      title: '🌱 觉醒的工匠',
      text: '早期你也曾迷信"全自动"，吃过几次亏后开始重新掂量每个开关。你没成为大师，但你已经不会再把脑袋交给别人。'
    },
    rookie: {
      title: '🐣 初出茅庐',
      text: '你才刚上手这套"AI 副驾"。路还长，先活过下一局再说——记得：省下的每一步，迟早要还。'
    }
  };

  // ===== 成长：经验解锁（见设计第 7 步）=====
  // 到达阈值后解锁，对结算做轻量修正（减少某类代价）。
  var UNLOCKS = [
    { id: 'review_assist', name: '评审辅助插件',   needExp: 20, desc: '代码评审的精力消耗减半（开评审时 energy 少扣 1）' }, // 待试玩校准
    { id: 'test_harness',  name: '测试脚手架',     needExp: 50, desc: '写测试的精力消耗减半（开测试时 energy 少扣 1）' }      // 待试玩校准
  ];

  // AI 能力递增：每 3 局升一版，旧策略收益轻微衰减（见设计第 6 节）。
  var AI_VERSION_INTERVAL = 3; // 待试玩校准

  var GAME_DATA = {
    STRATEGY_TABLE: STRATEGY_TABLE,
    STRATEGY_DIMS: STRATEGY_DIMS,
    BASE_TASK_WEEKS: BASE_TASK_WEEKS,
    AMPLIFY: AMPLIFY,
    PROJECT_POOL: PROJECT_POOL,
    SCALE_CFG: SCALE_CFG,
    TASK_NAMES: TASK_NAMES,
    TRAIT_POOL: TRAIT_POOL,
    EVENT_POOL: EVENT_POOL,
    EVENT_CHANCE: EVENT_CHANCE,
    NARRATIVE: NARRATIVE,
    ENDINGS: ENDINGS,
    UNLOCKS: UNLOCKS,
    AI_VERSION_INTERVAL: AI_VERSION_INTERVAL,
    // 初始玩家状态（main.js 首次开局使用）
    INIT_PLAYER: {
      exp: 0,
      rep: 50,        // 口碑 0..100，跨局累积
      techDebt: 0,    // 技术债跨局累积（核心反噬）
      roundsPlayed: 0,
      unlocks: [],
      aiVersion: 1,
      history: []     // 每局 { style, success, debtAdded, qualityRatio, defects }
    }
  };

  root.GAME_DATA = GAME_DATA;
})(typeof window !== 'undefined' ? window : this);
