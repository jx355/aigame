/*
 * main.js —— 编排层（串联流程、持有运行时状态、绑定按钮）
 * 职责：读按钮 → 调 Logic 计算 → 交 UI 渲染。不写复杂数值计算。
 * 约定：所有游戏随机都来自 Logic.makeRng(seed)，seed 随局记录可复现。
 */

(function () {
  'use strict';

  var L = window.Logic;
  var UI = window.UI;

  // 运行时状态（仅 main 持有）
  var game = {
    player: null,
    seed: 0,
    rng: null,
    project: null,
    tasks: null,
    traits: null,
    strategies: null,
    result: null,
    narrative: '',
    ending: null
  };

  // ---------- 启动 ----------
  function boot() {
    game.player = clonePlayer(window.GAME_DATA.INIT_PLAYER);
    UI.showTitle(onStart);
  }

  // ---------- 标题 → 开新游戏 ----------
  function onStart() {
    // 种子：用时间+随机生成，再交给 makeRng 驱动整局
    game.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    newRound();
  }

  // ---------- 新一局：接项目 ----------
  function newRound() {
    game.rng = L.makeRng(game.seed);
    game.project = L.generateProject(game.rng);
    game.tasks = L.splitTasks(game.project);
    game.traits = L.rollTraits(game.rng, game.tasks.length); // 每个任务一个 agent
    game.strategies = defaultStrategies(game.tasks.length);
    game.result = null;
    UI.showProject(game.player, game.seed, game.project, onAccept);
  }

  function defaultStrategies(n) {
    var arr = [];
    for (var i = 0; i < n; i++) {
      arr.push({ prompt: '省', review: '关', test: '关', refactor: '关' });
    }
    return arr;
  }

  // ---------- 接下 → 决策 ----------
  function onAccept() {
    UI.showDecision(game.player, game.seed, game.project, game.tasks, game.strategies, onExecute);
  }

  // ---------- 决策完 → 执行 + 结算 ----------
  function onExecute(strategies) {
    game.strategies = strategies;
    // 全程随机都来自同一 rng 流（项目生成后继续消费），保证 seed 可复现
    game.result = L.runExecution({
      project: game.project,
      tasks: game.tasks,
      strategies: game.strategies,
      traits: game.traits,
      rng: game.rng,
      player: game.player
    });
    UI.showExecution(game.player, game.seed, game.result, onSettleNext);
  }

  function onSettleNext() {
    UI.showSettlement(game.player, game.seed, game.project, game.result.settlement, onAttrNext);
  }

  // ---------- 结算 → 归因 ----------
  function onAttrNext() {
    UI.showAttribution(game.player, game.seed, game.result.attribution, onNarrativeNext);
  }

  // ---------- 归因 → 时代观察 + 结局 ----------
  function onNarrativeNext() {
    game.narrative = L.deriveNarrative(game.result.style);
    // 结局要反映"刚玩完这局"，故把本局临时并入历史再判定（不污染真实历史）
    var s = game.result.settlement;
    var tempHistory = game.player.history.concat([{
      style: game.result.style, success: s.success,
      debtAdded: s.techDebt, qualityRatio: s.qualityRatio, defects: s.defects
    }]);
    game.ending = L.pickEnding(tempHistory);
    UI.showNarrative(game.player, game.seed, game.narrative, game.ending, onGrowthNext);
  }

  // ---------- 时代观察 → 成长 + 下一局 ----------
  function onGrowthNext() {
    var adv = L.advancePlayer(game.player, game.result.settlement, game.result.style);
    UI.showGrowth(game.player, game.seed, adv.unlocked, onNextRound);
  }

  function onNextRound() {
    // 新种子、保留 player（经验/技术债/解锁跨局保留）
    game.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    newRound();
  }

  // ---------- 工具：深拷贝初始玩家 ----------
  function clonePlayer(p) {
    return {
      exp: p.exp, rep: p.rep, techDebt: p.techDebt, roundsPlayed: p.roundsPlayed,
      unlocks: p.unlocks.slice(), aiVersion: p.aiVersion, history: []
    };
  }

  // DOM 就绪后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
