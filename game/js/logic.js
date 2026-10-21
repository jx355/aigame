/*
 * logic.js —— 纯函数计算层（不碰 DOM）
 * 职责：全部游戏数值与流程计算，可 node 直接 require 单测。
 * 禁止：不得引用 document / window / localStorage。
 * 所有随机来自 makeRng(seed)，保证"决策→后果"可复现、可归因。
 * UMD 包裹：浏览器挂 window.Logic；node 下 module.exports。
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Logic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var D = (typeof GAME_DATA !== 'undefined') ? GAME_DATA : null;

  // 兜底常量（node 单测若未加载 data.js 时使用，保证可跑）
  var CFG = D || {
    STRATEGY_TABLE: {}, SCALE_CFG: {}, PROJECT_POOL: [], TRAIT_POOL: [], EVENT_POOL: [],
    EVENT_CHANCE: 0.45, BASE_TASK_WEEKS: 3, AMPLIFY: 0.04, TASK_NAMES: [], NARRATIVE: {},
    ENDINGS: {}, UNLOCKS: [], AI_VERSION_INTERVAL: 3, INIT_PLAYER: {}
  };

  // ---------- 伪随机：mulberry32，seed 可复现 ----------
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    function next() {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; }
    };
  }

  // ---------- 1. 生成项目卡 ----------
  function generateProject(rng) {
    var tpl = rng.pick(CFG.PROJECT_POOL);
    var scaleCfg = CFG.SCALE_CFG[tpl.scale];
    var reward = scaleCfg.budget;
    // 报酬波动 0.8~1.2（口碑→报酬加成尚未实现，见 QA 报告 P2-3，待人类确认后补）
    var repBonus = 0.8 + (rng.next() * 0.4); // 待试玩校准
    return {
      name: tpl.name,
      scale: tpl.scale,
      clientType: tpl.clientType,
      hiddenNeed: tpl.hiddenNeed,
      tasksCount: scaleCfg.tasks,
      reward: Math.round(reward * repBonus),
      baseCost: Math.round(scaleCfg.tasks * 1.5),       // 基础人力成本，待试玩校准
      deadlineWeeks: Math.round(scaleCfg.tasks * 3.5),  // 甲方容忍工期，待试玩校准
      maxDefects: scaleCfg.maxDefects
    };
  }

  // ---------- 2. 拆任务（纯函数，规模→任务列表） ----------
  function splitTasks(project) {
    var names = CFG.TASK_NAMES;
    var list = [];
    for (var i = 0; i < project.tasksCount; i++) {
      var nm = names[i % names.length];
      // 同名任务加序号，避免展示重复
      var label = (i >= names.length) ? (nm + '·续') : nm;
      list.push({ index: i, name: label });
    }
    return list;
  }

  // ---------- 3. 抽 agent trait（每个任务一个 agent） ----------
  function rollTraits(rng, agentCount) {
    var out = [];
    for (var i = 0; i < agentCount; i++) {
      out.push(rng.pick(CFG.TRAIT_POOL));
    }
    return out;
  }

  // ---------- 4. 掷随机事件（单任务，命中概率才触发） ----------
  function rollEvent(rng, context) {
    if (!rng.chance(CFG.EVENT_CHANCE)) return null;
    var ev = rng.pick(CFG.EVENT_POOL);
    var effect = cloneEffect(ev.effect);
    var note = ev.desc;
    // 条件型事件：根据当前决策做差异化处理
    if (ev.conditional) {
      if (ev.id === 'newlang') {
        // 写了测试则收益（缺陷-1），否则返工（缺陷+1）
        var hasTest = context && context.strategy && context.strategy.test === '开';
        effect.defects = hasTest ? -1 : +1;
        note = hasTest ? '新框架上手顺利，缺陷−' : '新框架踩坑，返工↑';
      } else if (ev.id === 'rival') {
        // 技术债低则缓冲（口碑只-1）
        var lowDebt = context && context.debt != null && context.debt < 5;
        effect.reputation = lowDebt ? -1 : -2;
        note = lowDebt ? '竞品抢发，但你技术领先缓冲了冲击' : '竞品抢发，口碑重挫';
      }
    }
    return { id: ev.id, name: ev.name, desc: ev.desc, effect: effect, note: note };
  }

  function cloneEffect(e) {
    return { timeline: e.timeline || 0, defects: e.defects || 0, techDebt: e.techDebt || 0,
             reputation: e.reputation || 0, energy: e.energy || 0, funds: e.funds || 0 };
  }

  // ---------- 5. 决策风格分析（重速度/重质量/重平衡） ----------
  function analyzeStyle(strategies) {
    var speed = 0, quality = 0;
    strategies.forEach(function (st) {
      if (st.prompt === '省') speed++; else quality++;
      if (st.review === '关') speed++; else quality++;
      if (st.test === '关') speed++; else quality++;
      if (st.refactor === '关') speed++; else quality++;
    });
    var total = speed + quality;
    if (total === 0) return '重平衡';
    if (speed - quality >= Math.ceil(total * 0.25)) return '重速度';
    if (quality - speed >= Math.ceil(total * 0.25)) return '重质量';
    return '重平衡';
  }

  // ---------- 6. 单任务：应用策略 + trait + 事件，产出增量 ----------
  // ctx: { debtBefore, unlocks, aiVersion, strategyDefault }
  function applyStrategy(input) {
    var strategy = input.strategy;
    var trait = input.trait;
    var event = input.event;
    var ctx = input.ctx || {};
    var table = CFG.STRATEGY_TABLE;

    // 基线工期
    var d = cloneEffect({});
    d.timeline = CFG.BASE_TASK_WEEKS;

    // 四个维度增量
    addEffect(d, table.prompt[strategy.prompt]);
    addEffect(d, table.review[strategy.review]);
    addEffect(d, table.test[strategy.test]);
    addEffect(d, table.refactor[strategy.refactor]);

    // 解锁修正：评审/测试精力消耗减半
    if (ctx.unlocks && ctx.unlocks.indexOf('review_assist') >= 0 && strategy.review === '开') d.energy += 1;
    if (ctx.unlocks && ctx.unlocks.indexOf('test_harness') >= 0 && strategy.test === '开') d.energy += 1;

    // AI 版本衰减：旧提示词收益随版本轻微下降（精致提示词的缺陷减免打折）
    if (ctx.aiVersion > 1 && strategy.prompt === '精致') {
      d.defects += (ctx.aiVersion - 1) * 0.5; // 衰减，待试玩校准
    }

    // agent trait 叠加
    if (trait) addEffect(d, trait.effect);

    // 技术债放大：当前任务工期/缺陷按"此前累计技术债"放大
    // 钳制 [0.6, 1.5]：保留"欠债抬高后期成本"的直觉，但防止雪崩式失控（待试玩校准）
    // 注意：计算与展示（runExecution 的 ampl 字段）共用 clampAmpl，避免两处逻辑漂移（QA P1-1 修复）
    var ampl = clampAmpl(ctx.debtBefore || 0);
    d.timeline = d.timeline * ampl;
    d.defects = d.defects * ampl;

    // 随机事件叠加（在放大后叠加，事件本身不被放大）
    if (event) addEffect(d, event.effect);

    var notes = buildNotes(strategy, trait, event);
    return { deltas: d, notes: notes };
  }

  function addEffect(target, e) {
    if (!e) return;
    target.timeline += (e.timeline || 0);
    target.defects += (e.defects || 0);
    target.techDebt += (e.techDebt || 0);
    target.reputation += (e.reputation || 0);
    target.energy += (e.energy || 0);
    target.funds += (e.funds || 0);
  }

  function buildNotes(strategy, trait, event) {
    var parts = [];
    parts.push('提示词' + strategy.prompt + ' / 评审' + strategy.review + ' / 测试' + strategy.test + ' / 重构' + strategy.refactor);
    if (trait) parts.push('agent【' + trait.name + '】：' + trait.desc);
    if (event) parts.push('事件【' + event.name + '】：' + event.note);
    return parts;
  }

  // ---------- 7. 执行一局：逐任务跑，累积并产出结算 + 归因 ----------
  // 输入：{ project, tasks, strategies, traits, rng, player }
  // 输出：{ taskResults, settlement, attribution, style }
  function runExecution(input) {
    var project = input.project;
    var tasks = input.tasks;
    var strategies = input.strategies;
    var traits = input.traits;
    var rng = input.rng;
    var player = input.player;

    var runningDebt = (player && player.techDebt) || 0; // 跨局技术债带入
    var taskResults = [];
    var sum = cloneEffect({}); // 累积各维度（不含基线工期，基线在 apply 内）

    for (var i = 0; i < tasks.length; i++) {
      var ctx = {
        debtBefore: runningDebt,
        unlocks: player ? player.unlocks : [],
        aiVersion: player ? player.aiVersion : 1
      };
      var ev = rollEvent(rng, { strategy: strategies[i], debt: runningDebt });
      var r = applyStrategy({ task: tasks[i], strategy: strategies[i], trait: traits[i], event: ev, ctx: ctx });
      var deltas = r.deltas;

      // 任务结果（用于归因展示）
      taskResults.push({
        index: i,
        name: tasks[i].name,
        strategy: strategies[i],
        trait: traits[i],
        event: ev,
        deltas: roundDeltas(deltas),
        notes: r.notes,
        ampl: round2(clampAmpl(runningDebt)) // 与计算层同源钳制，展示不失真（QA P1-1 修复）
      });

      // 累积（techDebt 立即并入 runningDebt，影响后续任务放大）
      addEffect(sum, deltas);
      runningDebt += deltas.techDebt;

      // 记录该任务后的累计债，便于归因
      taskResults[i].debtAfter = round2(runningDebt);
    }

    var style = analyzeStyle(strategies);
    var settlement = settleProject({
      project: project, sum: sum, style: style,
      player: player, runningDebt: runningDebt
    });

    // 归因：逐任务链路 + 全局项目级修正
    var attribution = buildAttribution(taskResults, settlement, project);

    return {
      taskResults: taskResults,
      settlement: settlement,
      attribution: attribution,
      style: style
    };
  }

  function round2(x) { return Math.round(x * 100) / 100; }
  function roundDeltas(d) {
    return {
      timeline: round2(d.timeline), defects: round2(d.defects), techDebt: round2(d.techDebt),
      reputation: round2(d.reputation), energy: round2(d.energy), funds: round2(d.funds)
    };
  }

  // ---------- 8. 结算：汇总 7 项数值 + 成败判定 ----------
  // 7 项：工期(timeline)、缺陷(defects)、技术债(techDebt)、口碑(reputation)、精力(energy)、资金(funds)、经验(experience)
  function settleProject(input) {
    var project = input.project;
    var sum = input.sum;
    var style = input.style;
    var player = input.player;

    // 工期（周）：基线+增量，最低 0.5 周
    var timeline = Math.max(0.5, round2(sum.timeline));
    // 缺陷：非负
    var defects = Math.max(0, round2(sum.defects));
    // 技术债：可负（净偿还），本局新增量
    var techDebt = round2(sum.techDebt);
    // 口碑：跨局累计（player.rep + 本局增量），钳制 0..100
    var repBefore = player ? player.rep : 50;
    var reputation = clamp(repBefore + round2(sum.reputation), 0, 100);
    var repDelta = round2(reputation - repBefore);
    // 精力：本局剩余（基线 10 + 增量），可为负触发疲劳
    var energy = 10 + round2(sum.energy);
    // 资金：报酬 - 基础成本 + 增量
    var funds = project.reward - project.baseCost + round2(sum.funds);
    // 经验：见 computeExperience

    // 隐藏需求满足度：整体质量比>=0.5 则口碑+1，否则-1
    var qualityRatio = computeQualityRatio(input.sum);
    var hiddenMod = 0;
    if (project.hiddenNeed && project.hiddenNeed !== '无') {
      hiddenMod = qualityRatio >= 0.5 ? +1 : -1;
      reputation = clamp(reputation + hiddenMod, 0, 100);
      repDelta += hiddenMod;
    }

    // 疲劳惩罚：精力<0 时缺陷上浮（压榨工期→判断力下降）
    var fatigueDefects = 0;
    if (energy < 0) {
      fatigueDefects = Math.ceil(-energy * 0.5);
      defects += fatigueDefects;
    }

    // 经验
    var experience = computeExperience({ timeline: timeline, defects: defects, funds: funds,
      techDebt: techDebt, qualityRatio: qualityRatio, style: style }, project);

    // 成败判定
    var onTime = timeline <= project.deadlineWeeks;
    var okDefect = defects <= project.maxDefects;
    var okFund = funds >= 0;
    var success = onTime && okDefect && okFund;

    var grade;
    if (success && defects === 0 && timeline <= project.deadlineWeeks * 0.8) grade = '优';
    else if (success) grade = '合格';
    else grade = '失败';

    return {
      timeline: timeline, defects: defects, techDebt: techDebt, reputation: reputation,
      repDelta: repDelta, energy: energy, funds: funds, experience: experience,
      qualityRatio: round2(qualityRatio), grade: grade, success: success,
      onTime: onTime, okDefect: okDefect, okFund: okFund,
      hiddenNeed: project.hiddenNeed, hiddenMod: hiddenMod,
      fatigueDefects: fatigueDefects,
      deadlineWeeks: project.deadlineWeeks, maxDefects: project.maxDefects,
      reward: project.reward, baseCost: project.baseCost
    };
  }

  // 质量比：以"缺陷压降、技术债偿还、评审/测试开启"粗略衡量 0..1
  function computeQualityRatio(sum) {
    var total = Math.abs(sum.defects) + Math.abs(sum.techDebt) + 4; // 分母保险
    var good = Math.max(0, -sum.defects) + Math.max(0, -sum.techDebt) + 4;
    return clamp(good / total, 0, 1);
  }

  function computeExperience(s, project) {
    var base = 10; // 待试玩校准
    var bonus = 0;
    if (s.success) bonus += 8;
    if (s.defects === 0) bonus += 5;
    if (s.funds > 0) bonus += 3;
    if (s.qualityRatio >= 0.6) bonus += 4;
    var exp = base + bonus - Math.max(0, s.techDebt); // 欠债不涨经验
    return Math.max(1, Math.round(exp));
  }

  // ---------- 9. 归因：逐任务链路 + 全局修正 ----------
  function buildAttribution(taskResults, settlement, project) {
    var items = taskResults.map(function (t) {
      return {
        kind: 'task',
        title: '任务' + (t.index + 1) + '·' + t.name,
        lines: t.notes,
        deltas: t.deltas,
        ampl: t.ampl
      };
    });
    // 全局项目级修正（隐藏需求、疲劳、报酬）
    var globalLines = [];
    if (settlement.hiddenMod !== 0) {
      globalLines.push((settlement.hiddenMod > 0 ? '✅' : '⚠️') + ' 隐藏需求【' + settlement.hiddenNeed +
        '】：质量' + (settlement.hiddenMod > 0 ? '达标，口碑+1' : '不达标，口碑-1'));
    }
    if (settlement.fatigueDefects > 0) {
      globalLines.push('⚠️ 精力透支（' + settlement.energy + '）：疲劳致缺陷 +' + settlement.fatigueDefects);
    }
    globalLines.push('💰 报酬 ' + settlement.reward + ' 万 − 基础成本 ' + settlement.baseCost + ' 万 = 利润 ' + settlement.funds + ' 万');
    if (globalLines.length) {
      items.push({ kind: 'global', title: '项目级修正', lines: globalLines, deltas: null, ampl: null });
    }
    return items;
  }

  // ---------- 10. 时代观察文案 ----------
  function deriveNarrative(style) {
    return CFG.NARRATIVE[style] || CFG.NARRATIVE['重平衡'];
  }

  // ---------- 11. 多结局判定（按累计历史） ----------
  function pickEnding(history) {
    var h = history || [];
    var rounds = h.length;
    if (rounds < 2) return CFG.ENDINGS.rookie;
    var totalDebt = 0, totalQuality = 0, speedRounds = 0, balancedRounds = 0;
    h.forEach(function (r) {
      totalDebt += (r.debtAdded || 0);
      totalQuality += (r.qualityRatio || 0);
      if (r.style === '重速度') speedRounds++;
      if (r.style === '重平衡') balancedRounds++;
    });
    var avgQuality = totalQuality / rounds;
    var avgDebt = totalDebt / rounds;

    if (avgDebt > 12 && speedRounds >= rounds * 0.6) return CFG.ENDINGS.collapse;     // 长期欠债+重速度
    if (avgQuality >= 0.6 && avgDebt <= 6) return CFG.ENDINGS.master;                  // 稳且优
    if (speedRounds >= rounds * 0.6 && avgDebt <= 8) return CFG.ENDINGS.lineworker;    // 快但没崩
    if (balancedRounds >= rounds * 0.5) return CFG.ENDINGS.awakened;                   // 平衡觉醒
    return CFG.ENDINGS.rookie;
  }

  // ---------- 12. 解锁检查 ----------
  function checkUnlocks(player) {
    var newly = [];
    CFG.UNLOCKS.forEach(function (u) {
      if (player.exp >= u.needExp && player.unlocks.indexOf(u.id) < 0) {
        player.unlocks.push(u.id);
        newly.push(u);
      }
    });
    return newly;
  }

  // ---------- 13. 推进玩家状态（结算后调用） ----------
  function advancePlayer(player, settlement, style) {
    player.exp += settlement.experience;
    player.rep = settlement.reputation;
    player.techDebt += settlement.techDebt; // 跨局累积（核心反噬）
    player.techDebt = round2(player.techDebt);
    player.roundsPlayed += 1;
    player.aiVersion = 1 + Math.floor(player.roundsPlayed / CFG.AI_VERSION_INTERVAL);
    player.history.push({
      style: style,
      success: settlement.success,
      debtAdded: settlement.techDebt,
      qualityRatio: settlement.qualityRatio,
      defects: settlement.defects
    });
    var unlocked = checkUnlocks(player);
    return { unlocked: unlocked };
  }

  // ---------- 工具 ----------
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // 技术债放大系数：计算层与展示层共用的唯一来源，钳制 [0.6, 1.5]（QA P1-1 修复）
  function clampAmpl(debt) {
    return clamp(1 + debt * CFG.AMPLIFY, 0.6, 1.5);
  }

  // ---------- 导出 ----------
  return {
    makeRng: makeRng,
    generateProject: generateProject,
    splitTasks: splitTasks,
    rollTraits: rollTraits,
    rollEvent: rollEvent,
    analyzeStyle: analyzeStyle,
    applyStrategy: applyStrategy,
    runExecution: runExecution,
    settleProject: settleProject,
    deriveNarrative: deriveNarrative,
    pickEnding: pickEnding,
    checkUnlocks: checkUnlocks,
    advancePlayer: advancePlayer,
    computeQualityRatio: computeQualityRatio
  };
});
