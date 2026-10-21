/*
 * ui-flow.test.js —— UI 流程集成测试（零依赖，node 直接跑）
 * 目的：用极简 DOM 桩模拟浏览器，加载 game/ 下 4 个脚本，按真实顺序点击主按钮，
 *       逐屏验证「主按钮是否存在」+「点击是否切换到下一屏」+「是否抛错」。
 * 复现用户报告的 bug：归因反馈无法退回 / 完成一局无法进入下一局。
 * 运行：node tests/ui-flow.test.js
 */
const fs = require('fs');
const vm = require('vm');

// ---------------- 极简 DOM 桩 ----------------
class FakeClassList {
  constructor(node) { this.node = node; }
  _get() { return (this.node.className || '').split(/\s+/).filter(Boolean); }
  _set(arr) { this.node.className = arr.join(' '); }
  add() { const s = this._get(); for (const c of arguments) if (!s.includes(c)) s.push(c); this._set(s); }
  remove() { let s = this._get(); s = s.filter(c => !Array.prototype.includes.call(arguments, c)); this._set(s); }
  contains(c) { const cn = ' ' + (this.node.className || '') + ' '; return cn.indexOf(' ' + c + ' ') >= 0; }
}
class FakeText { constructor(t) { this.text = String(t); } get textContent() { return this.text; } }
class FakeNode {
  constructor(tag) {
    this.tagName = (tag || 'div').toLowerCase();
    this.children = []; this.listeners = {}; this.attributes = {};
    this._text = ''; this._html = ''; this.className = '';
    this.classList = new FakeClassList(this);
  }
  appendChild(c) {
    if (typeof c === 'string') c = new FakeText(c);
    if (c instanceof FakeNode || c instanceof FakeText) { c.parentNode = this; this.children.push(c); }
    return c;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  set id(v) { this.attributes.id = v; }
  get id() { return this.attributes.id; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  querySelectorAll() { return []; }
  get textContent() { return this._text || this.children.map(c => c.textContent || '').join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; } // 模拟 innerHTML='' 清空
  click() { (this.listeners['click'] || []).slice().forEach(fn => fn({})); }
  findById(id) {
    if (this.attributes.id === id) return this;
    for (const c of this.children) if (c instanceof FakeNode) { const r = c.findById(id); if (r) return r; }
    return null;
  }
  findPrimaryButton() {
    if (this.tagName === 'button' && this.classList.contains('btn primary')) return this;
    for (const c of this.children) if (c instanceof FakeNode) { const r = c.findPrimaryButton(); if (r) return r; }
    return null;
  }
}
function findHeading(node) {
  if ((node.tagName === 'h1' || node.tagName === 'h2') && node._text) return node._text;
  for (const c of node.children) if (c instanceof FakeNode) { const r = findHeading(c); if (r) return r; }
  return null;
}

const APP = new FakeNode('div'); APP.attributes.id = 'app';
const document = {
  readyState: 'complete',
  getElementById(id) { return id === 'app' ? APP : APP.findById(id); },
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') fn(); },
  createElement(tag) { return new FakeNode(tag); }
};

// setInterval 同步化：立即把回调跑到 clearInterval 为止（执行屏依赖它挂"查看结算"按钮）
const sandbox = {};
sandbox.window = sandbox;
sandbox.document = document;
sandbox.console = console;
sandbox.Math = Math; sandbox.Date = Date; sandbox.Object = Object;
sandbox.JSON = JSON; sandbox.Array = Array; sandbox.String = String; sandbox.Number = Number;
sandbox.setInterval = function (fn) {
  const id = { done: false }; let guard = 0;
  while (!id.done && guard < 500000) { fn.call(null); guard++; }
  return id;
};
sandbox.clearInterval = function (id) { if (id) id.done = true; };
vm.createContext(sandbox);

// ---------------- 加载 game 脚本（顺序同 index.html） ----------------
const files = ['game/js/data.js', 'game/js/logic.js', 'game/js/ui.js', 'game/js/main.js'];
for (const f of files) {
  try {
    vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
  } catch (e) {
    console.log('❌ 加载 ' + f + ' 抛错: ' + e.message);
    process.exit(1);
  }
}

// ---------------- 模拟点击整条流程 ----------------
const STEPS = [
  '标题→项目', '项目→决策', '决策→执行', '执行→结算',
  '结算→归因', '归因→时代观察', '时代观察→成长', '成长→下一局(回到项目)'
];
let ok = true;
for (let i = 0; i < STEPS.length; i++) {
  const before = findHeading(APP);
  const btn = APP.findPrimaryButton();
  if (!btn) {
    console.log('❌ [' + STEPS[i] + '] 当前屏="' + before + '" 未找到主按钮 → 卡死（无法继续/退回）');
    ok = false; break;
  }
  let err = null;
  try { btn.click(); } catch (e) { err = e; }
  const after = findHeading(APP);
  if (err) { console.log('❌ [' + STEPS[i] + '] 屏="' + before + '" 点击抛错: ' + err.message); ok = false; break; }
  const switched = after !== before;
  console.log((switched ? '✅' : '❌') + ' [' + STEPS[i] + '] ' + before + ' → ' + after);
  if (!switched) { ok = false; break; }
}
console.log(ok ? '\n结果：UI 主按钮链路完整，8 步全部正常切换。' : '\n结果：发现卡死点，见上方 ❌。');
process.exit(ok ? 0 : 1);
