'use strict';
/*
 * AI 副驾 · 逻辑层回归测试（纯 node，无依赖）
 *
 * 加载方式：用 vm 在同一上下文按 data → logic 顺序加载两文件，
 * 再调用 window.Logic（此处即 sandbox.Logic）。这样 logic.js 能读到
 * GAME_DATA（否则走空表兜底导致 table.prompt 等 undefined 崩溃）。
 *
 * 运行：node tests/run-tests.js
 * 输出：每条断言 PASS/FAIL + 真实数值；末尾打印样例结算 JSON。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME_JS = path.resolve(__dirname, '../game/js');
const dataCode = fs.readFileSync(path.join(GAME_JS, 'data.js'), 'utf8');
const logicCode = fs.readFileSync(path.join(GAME_JS, 'logic.js'), 'utf8');

// ---- 同一 vm 上下文加载 data → logic ----
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(dataCode, sandbox);   // 设置 sandbox.GAME_DATA
vm.runInContext(logicCode, sandbox);  // 设置 sandbox.Logic（无 module → 走浏览器分支）
const Logic = sandbox.Logic;
const DATA = sandbox.GAME_DATA;

if (!Logic || !DATA) {
  console.error('FATAL: 未能从 vm 上下文加载 Logic / GAME_DATA');
  process.exit(1);
}

// ---------------- 极简断言框架 ----------------
const results = [];
function check(name, cond, detail) {
  const pass = !!cond;
  results.push({ name, pass, detail: detail || '' });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? '  → ' + detail : ''}`);
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------- 测试用具 ----------------
function cloneInit(over) {
  return Object.assign({}, DATA.INIT_PLAYER, { unlocks: [], history: [] }, over || {});
}
function makeProject(scale) {
  const sc = DATA.SCALE_CFG[scale];
  return {
    name: '测试项目', scale, clientType: '测试', hiddenNeed: '无',
    tasksCount: sc.tasks,
    reward: sc.budget,
    baseCost: Math.round(sc.tasks * 1.5),
    deadlineWeeks: Math.round(sc.tasks * 3.5),
    maxDefects: sc.maxDefects
  };
}
function strat(n, s) { const a = []; for (let i = 0; i < n; i++) a.push(Object.assign({}, s)); return a; }
const ALL_OFF = { prompt: '省', review: '关', test: '关', refactor: '关' };
const ALL_ON = { prompt: '精致', review: '开', test: '开', refactor: '开' };
// 永不触发事件的 rng（用于隔离确定性数值断言）
const NO_EVENT_RNG = { next: () => 0.99, int: () => 0, pick: (a) => a[0], chance: () => false };

function runWith(scale, tmpl, rng, player) {
  const n = DATA.SCALE_CFG[scale].tasks;
  const strategies = strat(n, tmpl);
  const project = makeProject(scale);
  const tasks = Logic.splitTasks(project);
  const traits = tasks.map(() => null);
  const p = player || cloneInit();
  const result = Logic.runExecution({
    project, tasks, strategies, traits,
    rng: rng || NO_EVENT_RNG, player: p
  });
  return { project, tasks, result, player: p };
}
// 用真实随机流复现 main.js 流程（generateProject→splitTasks→rollTraits→runExecution）
function playFullRound(seed, strategiesOverride) {
  const rng = Logic.makeRng(seed);
  const project = Logic.generateProject(rng);
  const tasks = Logic.splitTasks(project);
  const traits = Logic.rollTraits(rng, tasks.length);
  const strategies = strategiesOverride || strat(tasks.length, ALL_OFF);
  const player = cloneInit();
  const result = Logic.runExecution({ project, tasks, strategies, traits, rng, player });
  return { project, tasks, traits, result };
}

// =================================================================
section('1. 随机可复现 (makeRng)');
{
  const r1 = Logic.makeRng(12345), r2 = Logic.makeRng(12345);
  const s1 = [r1.next(), r1.next(), r1.next()];
  const s2 = [r2.next(), r2.next(), r2.next()];
  check('同 seed 产生相同随机序列', JSON.stringify(s1) === JSON.stringify(s2), s1.map(x => x.toFixed(4)).join(','));
  const r3 = Logic.makeRng(999);
  const s3 = [r3.next(), r3.next(), r3.next()];
  check('不同 seed 序列不同', JSON.stringify(s1) !== JSON.stringify(s3));
}

section('2. 项目生成 & 拆任务');
{
  const a = Logic.generateProject(Logic.makeRng(7));
  const b = Logic.generateProject(Logic.makeRng(7));
  check('同 seed 生成相同项目', a.name === b.name && a.scale === b.scale && a.reward === b.reward, a.name + '/' + a.scale);
  const proj = makeProject('L');
  const tasks = Logic.splitTasks(proj);
  check('拆任务数 = 规模配置', tasks.length === DATA.SCALE_CFG['L'].tasks, 'L=' + tasks.length);
  const m = Logic.splitTasks(makeProject('M'));
  check('M 规模拆出 5 个任务', m.length === 5, 'M=' + m.length);
}

section('3. agent trait 抽取');
{
  const traits = Logic.rollTraits(Logic.makeRng(3), 5);
  check('rollTraits 数量正确且均为 trait 对象', traits.length === 5 && traits.every(t => t && typeof t.name === 'string'), traits.map(t => t.name).join(','));
}

section('4. 核心循环完整跑通');
{
  let threw = null;
  try { runWith('M', ALL_OFF); } catch (e) { threw = e; }
  check('默认全关策略完整跑通（不崩溃）', !threw, threw ? threw.message : 'ok');
  let threw2 = null;
  try { playFullRound(2024); } catch (e) { threw2 = e; }
  check('真实随机流完整跑通（generate→split→traits→exec）', !threw2, threw2 ? threw2.message : 'ok');
}

section('5. 同 seed 复现 / 可归因');
{
  const ra = playFullRound(2024);
  const rb = playFullRound(2024);
  const same = JSON.stringify(ra.result.settlement) === JSON.stringify(rb.result.settlement) &&
               JSON.stringify(ra.result.taskResults) === JSON.stringify(rb.result.taskResults);
  check('同 seed + 默认策略 → 两次结算完全一致', same,
    'timeline=' + ra.result.settlement.timeline + ' defects=' + ra.result.settlement.defects + ' success=' + ra.result.settlement.success);
}

section('6. 随机事件触发 & 条件事件');
{
  function fakeRngForEvent(evId) {
    const ev = DATA.EVENT_POOL.find(e => e.id === evId);
    return { next: () => 0, int: () => 0, pick: () => ev, chance: () => true };
  }
  const evOn = Logic.rollEvent(fakeRngForEvent('newlang'), { strategy: { prompt: '省', review: '关', test: '开', refactor: '关' }, debt: 0 });
  check('条件事件 newlang：写了测试 → 缺陷-1', evOn && evOn.effect.defects === -1, evOn ? evOn.note : 'null');
  const evOff = Logic.rollEvent(fakeRngForEvent('newlang'), { strategy: { prompt: '省', review: '关', test: '关', refactor: '关' }, debt: 0 });
  check('条件事件 newlang：没写测试 → 缺陷+1', evOff && evOff.effect.defects === 1, evOff ? evOff.note : 'null');
  const evLow = Logic.rollEvent(fakeRngForEvent('rival'), { strategy: ALL_OFF, debt: 2 });
  check('条件事件 rival：技术债低(<5) → 口碑-1', evLow && evLow.effect.reputation === -1, evLow ? evLow.note : 'null');
  const evHigh = Logic.rollEvent(fakeRngForEvent('rival'), { strategy: ALL_OFF, debt: 20 });
  check('条件事件 rival：技术债高(>=5) → 口碑-2', evHigh && evHigh.effect.reputation === -2, evHigh ? evHigh.note : 'null');
  const friday = Logic.rollEvent(fakeRngForEvent('friday'), { strategy: ALL_OFF, debt: 0 });
  check('普通事件可触发（friday 工期+1）', friday && friday.effect.timeline === 1, friday ? friday.name : 'null');
  // 大样本：事件触发概率约为 EVENT_CHANCE
  let hit = 0; const N = 2000;
  for (let i = 0; i < N; i++) { if (Logic.rollEvent(Logic.makeRng(i + 1), { strategy: ALL_OFF, debt: 0 })) hit++; }
  check('事件触发率≈EVENT_CHANCE(0.45)', Math.abs(hit / N - DATA.EVENT_CHANCE) < 0.08, '命中率=' + (hit / N).toFixed(3));
}

section('7. 技术债放大 / 钳制');
{
  // 7.1 计算层钳制生效（数值安全，防雪崩）—— 直接单测 applyStrategy
  const c = Logic.applyStrategy({
    strategy: ALL_OFF, trait: null, event: null,
    ctx: { debtBefore: 100, unlocks: [], aiVersion: 1 }
  });
  // 全关单任务原始缺陷 = 1+2+3+1 = 7；ampl=min(1.5, 1+100*0.03=4)=1.5 → 7*1.5=10.5
  check('计算层放大系数被钳制(债务极高时 defects=7*1.5=10.5)', Math.abs(c.deltas.defects - 10.5) < 1e-6, 'defects=' + c.deltas.defects);

  // 7.2 放大系数跨任务累积（全关 L）
  const r = runWith('L', ALL_OFF);
  const amps = r.result.taskResults.map(t => t.ampl);
  const last = r.result.taskResults[r.result.taskResults.length - 1];
  check('全关策略技术债跨任务累积上升', last.debtAfter > 0, 'finalDebt=' + last.debtAfter);

  // 7.3 [P1 已修复] 展示用的 ampl 与计算层同源钳制（clampAmpl），任何情况不超过 1.5
  check('[P1修复] 展示放大系数已钳制(全关L 全部 ≤1.5)', amps.every(a => a <= 1.5), 'amps=' + amps.join(','));
  const r2 = runWith('L', ALL_OFF, NO_EVENT_RNG, cloneInit({ techDebt: 200 }));
  const amps2 = r2.result.taskResults.map(t => t.ampl);
  check('[P1修复] 高初始债时展示放大系数仍 ≤1.5', amps2.every(a => a <= 1.5), 'maxAmp=' + Math.max.apply(null, amps2));
}

section('8. 疲劳惩罚（精力<0）');
{
  const rFat = runWith('L', ALL_ON);
  check('全开策略精力<0 触发疲劳惩罚', rFat.result.settlement.energy < 0 && rFat.result.settlement.fatigueDefects > 0,
    'energy=' + rFat.result.settlement.energy + ' fatigue=' + rFat.result.settlement.fatigueDefects);
  const rCalm = runWith('S', { prompt: '省', review: '开', test: '开', refactor: '关' });
  check('温和策略精力≥0 不触发疲劳', rCalm.result.settlement.energy >= 0 && rCalm.result.settlement.fatigueDefects === 0,
    'energy=' + rCalm.result.settlement.energy);
}

section('9. 结算成败判定');
{
  const rOff = runWith('S', ALL_OFF);
  check('全关S：缺陷超限 → 结算失败', rOff.result.settlement.success === false && rOff.result.settlement.okDefect === false,
    'defects=' + rOff.result.settlement.defects + ' max=' + rOff.result.settlement.maxDefects);
  const rOn = runWith('S', ALL_ON);
  check('全开S：工期超限 → 结算失败', rOn.result.settlement.success === false && rOn.result.settlement.onTime === false,
    'timeline=' + rOn.result.settlement.timeline + ' deadline=' + rOn.result.settlement.deadlineWeeks);
  const rBal = runWith('S', { prompt: '省', review: '开', test: '开', refactor: '关' });
  check('平衡策略S：存在可行成功解', rBal.result.settlement.success === true,
    'grade=' + rBal.result.settlement.grade + ' defects=' + rBal.result.settlement.defects + ' timeline=' + rBal.result.settlement.timeline);
}

section('10. 多结局切换（连续重速度 vs 连续重质量）');
{
  const rookie = Logic.pickEnding([]);
  check('结局：<2局 → 初出茅庐', rookie.title.indexOf('初出茅庐') >= 0, rookie.title);
  const master = Logic.pickEnding([
    { style: '重平衡', success: true, debtAdded: -2, qualityRatio: 0.8 },
    { style: '重平衡', success: true, debtAdded: -1, qualityRatio: 0.9 },
    { style: '重平衡', success: true, debtAdded: 0, qualityRatio: 0.85 }
  ]);
  check('结局：稳且优(avgQ>=0.6 & avgDebt<=6) → 人机协作大师', master.title.indexOf('人机协作大师') >= 0, master.title);
  const collapse = Logic.pickEnding([
    { style: '重速度', success: false, debtAdded: 20, qualityRatio: 0.2 },
    { style: '重速度', success: false, debtAdded: 18, qualityRatio: 0.1 },
    { style: '重速度', success: false, debtAdded: 22, qualityRatio: 0.15 }
  ]);
  check('结局：长期欠债+重速度 → 技术债崩盘', collapse.title.indexOf('技术债崩盘') >= 0, collapse.title);
  const line = Logic.pickEnding([
    { style: '重速度', success: true, debtAdded: 2, qualityRatio: 0.3 },
    { style: '重速度', success: true, debtAdded: 1, qualityRatio: 0.35 },
    { style: '重速度', success: true, debtAdded: 3, qualityRatio: 0.25 }
  ]);
  check('结局：快但没崩(重速度&avgDebt<=8) → 流水线工人', line.title.indexOf('流水线工人') >= 0, line.title);
  const awake = Logic.pickEnding([
    { style: '重平衡', success: true, debtAdded: 10, qualityRatio: 0.4 },
    { style: '重平衡', success: true, debtAdded: 9, qualityRatio: 0.45 },
    { style: '重平衡', success: true, debtAdded: 11, qualityRatio: 0.4 }
  ]);
  check('结局：平衡多数(avgQ<0.6) → 觉醒的工匠', awake.title.indexOf('觉醒的工匠') >= 0, awake.title);
}

section('11. 跨局成长（经验/解锁/AI版本递增）');
{
  const pl = cloneInit();
  const beforeExp = pl.exp;
  for (let i = 0; i < 4; i++) {
    const r = runWith('S', { prompt: '省', review: '开', test: '开', refactor: '关' }, NO_EVENT_RNG, pl);
    Logic.advancePlayer(pl, r.result.settlement, r.result.style);
  }
  check('跨局成长：经验累积增加', pl.exp > beforeExp, 'exp=' + pl.exp);
  check('跨局成长：AI 版本随局递增(4局后 v=2)', pl.aiVersion === 2, 'aiVersion=' + pl.aiVersion);
  check('跨局成长：经验达标后解锁(评审辅助≥20, 测试脚手架≥50)',
    pl.unlocks.indexOf('review_assist') >= 0 && pl.unlocks.indexOf('test_harness') >= 0,
    'unlocks=' + pl.unlocks.join(','));
  // 解锁效果：开评审精力每任务少扣 1（S=3 任务全开评审 → 总多 +3）
  const rNoUnlock = runWith('S', { prompt: '省', review: '开', test: '关', refactor: '关' }, NO_EVENT_RNG, cloneInit());
  const rUnlock = runWith('S', { prompt: '省', review: '开', test: '关', refactor: '关' }, NO_EVENT_RNG,
    cloneInit({ unlocks: ['review_assist'] }));
  check('解锁评审辅助：开评审精力每任务少扣1（3任务共+3）',
    rUnlock.result.settlement.energy === rNoUnlock.result.settlement.energy + 3,
    'no=' + rNoUnlock.result.settlement.energy + ' unlock=' + rUnlock.result.settlement.energy);
}

section('12. 边界');
{
  // 单任务项目
  const sp = { name: '单任务', scale: 'S', clientType: 'x', hiddenNeed: '无', tasksCount: 1, reward: 8, baseCost: 2, deadlineWeeks: 4, maxDefects: 3 };
  let threw = null, ok = false;
  try {
    const tasks = Logic.splitTasks(sp);
    const res = Logic.runExecution({ project: sp, tasks, strategies: [ALL_OFF], traits: [null], rng: NO_EVENT_RNG, player: cloneInit() });
    ok = res.settlement && typeof res.settlement.timeline === 'number';
  } catch (e) { threw = e; }
  check('边界：单任务项目可结算', ok && !threw, threw ? threw.message : 'timeline=' + (ok ? 'ok' : 'n/a'));
  // 全开 S 的精力耗尽边界
  const r = runWith('S', ALL_ON);
  check('边界：全开S精力耗尽(energy<0)', r.result.settlement.energy < 0, 'energy=' + r.result.settlement.energy);
  // 全关 S 缺陷爆炸边界
  const r2 = runWith('S', ALL_OFF);
  check('边界：全关S缺陷远超容忍', r2.result.settlement.defects > r2.result.settlement.maxDefects,
    'defects=' + r2.result.settlement.defects + ' max=' + r2.result.settlement.maxDefects);
}

section('13. 归因面板 & 风格分析');
{
  const rAttr = runWith('M', ALL_OFF);
  check('归因面板含逐任务项 + 项目级修正',
    rAttr.result.attribution.length >= rAttr.tasks.length && rAttr.result.attribution.some(i => i.kind === 'global'),
    'items=' + rAttr.result.attribution.length);
  check('风格：全关 → 重速度', Logic.analyzeStyle(strat(4, ALL_OFF)) === '重速度');
  check('风格：全开 → 重质量', Logic.analyzeStyle(strat(4, ALL_ON)) === '重质量');
  check('风格：混合 → 重平衡', Logic.analyzeStyle([ALL_OFF, ALL_OFF, ALL_ON, ALL_ON]) === '重平衡');
  check('时代观察文案随风格返回', Logic.deriveNarrative('重速度').length > 0 && Logic.deriveNarrative('重质量').length > 0);
}

// =================================================================
section('真实输出样例（供人工回归核对）');
{
  const balanced = runWith('S', { prompt: '省', review: '开', test: '开', refactor: '关' }).result.settlement;
  const allOff = runWith('S', ALL_OFF).result.settlement;
  const allOn = runWith('S', ALL_ON).result.settlement;
  console.log('— 平衡策略(S) 结算 —\n' + JSON.stringify(balanced, null, 0));
  console.log('— 全关策略(S) 结算 —\n' + JSON.stringify(allOff, null, 0));
  console.log('— 全开策略(S) 结算 —\n' + JSON.stringify(allOn, null, 0));
}

// ---------------- 汇总 ----------------
const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log('\n========================================');
console.log(`断言总数 ${results.length} ｜ PASS ${pass} ｜ FAIL ${fail}`);
console.log('========================================');
process.exit(fail === 0 ? 0 : 2);
