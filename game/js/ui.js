/*
 * ui.js —— DOM 渲染与输入收集层
 * 职责：把 logic 算好的结果画成 DOM、收集玩家按钮输入。只调用 logic、只画 DOM。
 * 禁止：不直接算数值（数值一律由 main 调 logic 算好后传入）。
 * 说明：本文件依赖全局 Logic（logic.js）、GAME_DATA（data.js）。
 */

(function (root) {
  'use strict';

  // 极简建元素工具：el('div', {class:'x'}, [child|string])
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k === 'html') node.innerHTML = props[k];
        else if (k.indexOf('on') === 0 && typeof props[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else node.setAttribute(k, props[k]);
      });
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }

  // 数值正负着色（正向绿、负向红、零灰）
  function signClass(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : 'zero'); }
  function fmt(v) { return (v > 0 ? '+' : '') + v; }

  // 主容器
  function app() { return document.getElementById('app'); }
  function clear() { app().innerHTML = ''; }

  // 顶部状态条（种子 / 局数 / 口碑 / 经验 / 技术债）
  function renderStatusBar(player, seed) {
    var bar = el('div', { class: 'statusbar' }, [
      el('span', { class: 'chip', text: '🌱 第 ' + (player.roundsPlayed + 1) + ' 局' }),
      el('span', { class: 'chip', text: '🎲 seed ' + seed }),
      el('span', { class: 'chip', text: '⭐ 经验 ' + player.exp }),
      el('span', { class: 'chip', text: '💬 口碑 ' + player.rep }),
      el('span', { class: 'chip', text: '📉 技术债 ' + player.techDebt }),
      el('span', { class: 'chip', text: '🤖 AI v' + player.aiVersion })
    ]);
    return bar;
  }

  // ---------- 标题界面 ----------
  function showTitle(onStart) {
    clear();
    var box = el('div', { class: 'card center' }, [
      el('h1', { text: '🤖 AI 副驾 · Co-Pilot Life' }),
      el('p', { class: 'sub', text: '你是重度依赖 AI 的开发者：接项目 → 拆任务 → 决定"怎么用 AI" → 看现实规律反噬。' }),
      el('p', { class: 'hint', text: '核心张力：用 AI 越省事，短期越快，但技术债会在后期反噬。' }),
      el('button', { class: 'btn primary', text: '▶ 开始新的一局', onclick: onStart })
    ]);
    app().appendChild(box);
  }

  // ---------- 接项目界面 ----------
  function showProject(player, seed, project, onAccept) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    var scaleTag = { S: '小', M: '中', L: '大' }[project.scale];
    var card = el('div', { class: 'card' }, [
      el('h2', { text: '📋 接到项目：' + project.name }),
      el('div', { class: 'kv' }, [
        kv('规模', scaleTag + '（' + project.tasksCount + ' 个任务）'),
        kv('甲方', project.clientType),
        kv('隐藏需求', project.hiddenNeed),
        kv('报酬', project.reward + ' 万'),
        kv('甲方容忍工期', project.deadlineWeeks + ' 周'),
        kv('缺陷容忍', '≤ ' + project.maxDefects + ' 个')
      ]),
      el('p', { class: 'hint', text: '🎲 本局 seed：' + seed + '（所有随机由此决定，可复现）' }),
      el('button', { class: 'btn primary', text: '✂ 接下并拆解任务', onclick: onAccept })
    ]);
    app().appendChild(card);
  }

  function kv(k, v) {
    return el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-k', text: k }),
      el('span', { class: 'kv-v', text: v })
    ]);
  }

  // ---------- 逐任务决策界面 ----------
  // tasks: [{index,name}]; defaultStrategies: [{prompt,review,test,refactor}]
  // onExecute(strategies): 玩家点"开始执行"时回调，传入收集到的策略数组
  function showDecision(player, seed, project, tasks, defaultStrategies, onExecute) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    // 本地可变副本
    var strat = defaultStrategies.map(function (s) { return Object.assign({}, s); });

    var intro = el('div', { class: 'card' }, [
      el('h2', { text: '🎛 逐任务决策（4 维策略开关）' }),
      el('p', { class: 'hint', text: '每个任务决定"怎么用 AI"。省/关 = 快但埋雷；精致/开 = 稳但慢费精力。' })
    ]);
    app().appendChild(intro);

    tasks.forEach(function (task) {
      var tcard = el('div', { class: 'card task-card' }, [
        el('h3', { text: '任务 ' + (task.index + 1) + ' · ' + task.name })
      ]);
      GAME_DATA.STRATEGY_DIMS.forEach(function (dim) {
        var row = el('div', { class: 'dim-row' }, [ el('span', { class: 'dim-label', text: dim.label }) ]);
        dim.options.forEach(function (opt) {
          var btn = el('button', {
            class: 'toggle' + (strat[task.index][dim.key] === opt ? ' on' : ''),
            text: opt
          });
          btn.addEventListener('click', function () {
            strat[task.index][dim.key] = opt;
            // 刷新同组高亮
            var siblings = row.querySelectorAll('.toggle');
            siblings.forEach(function (s) { s.classList.remove('on'); });
            btn.classList.add('on');
          });
          row.appendChild(btn);
        });
        tcard.appendChild(row);
      });
      app().appendChild(tcard);
    });

    var go = el('button', { class: 'btn primary big', text: '🚀 开始执行（掷 trait / 事件）', onclick: function () { onExecute(strat); } });
    app().appendChild(el('div', { class: 'card center' }, [go]));
  }

  // ---------- 执行过程（滚动日志，逐任务揭示） ----------
  // result: logic.runExecution 的返回（已算好），此处仅做过程展示
  // onDone(): 展示完后回调
  function showExecution(player, seed, result, onDone) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    var box = el('div', { class: 'card' }, [
      el('h2', { text: '⚙️ 执行中…' }),
      el('div', { id: 'execLog', class: 'log' })
    ]);
    app().appendChild(box);
    var log = document.getElementById('execLog');

    var idx = 0;
    var results = result.taskResults;
    var timer = setInterval(function () {
      if (idx >= results.length) {
        clearInterval(timer);
        log.appendChild(el('p', { class: 'log-done', text: '✅ 全部任务执行完毕，进入结算…' }));
        var btn = el('button', { class: 'btn primary', text: '📊 查看结算', onclick: onDone });
        log.appendChild(btn);
        return;
      }
      var t = results[idx];
      var block = el('div', { class: 'log-item' }, [
        el('div', { class: 'log-head', text: '▶ 任务 ' + (t.index + 1) + ' · ' + t.name +
          (t.trait ? '  ［agent：' + t.trait.name + '］' : '') +
          (t.event ? '  ［事件：' + t.event.name + '］' : '') }),
        el('div', { class: 'log-deltas', html: deltasHtml(t.deltas) }),
        el('div', { class: 'log-note', text: (t.ampl > 1 ? '⚠️ 技术债放大 ×' + t.ampl + '  ' : '') + t.notes.join('；') })
      ]);
      log.appendChild(block);
      idx++;
    }, 350);
  }

  function deltasHtml(d) {
    var items = [
      ['工期', d.timeline], ['缺陷', d.defects], ['技术债', d.techDebt],
      ['口碑', d.reputation], ['精力', d.energy], ['资金', d.funds]
    ];
    return items.map(function (p) {
      return '<span class="d ' + signClass(p[1]) + '">' + p[0] + ' ' + fmt(p[1]) + '</span>';
    }).join('');
  }

  // ---------- 项目结算 ----------
  function showSettlement(player, seed, project, settlement, onNext) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    var s = settlement;
    var gradeColor = s.grade === '优' ? 'pos' : (s.grade === '合格' ? 'zero' : 'neg');
    var card = el('div', { class: 'card' }, [
      el('h2', { text: '📊 项目结算：' + project.name }),
      el('div', { class: 'grade ' + gradeColor, text: '评级：' + s.grade + (s.success ? '（交付成功）' : '（交付失败）') }),
      el('div', { class: 'kv' }, [
        kv('⏱ 工期', s.timeline + ' 周 / 容忍 ' + s.deadlineWeeks + ' 周 ' + (s.onTime ? '✅' : '❌')),
        kv('🐞 缺陷', s.defects + ' 个 / 容忍 ' + s.maxDefects + ' 个 ' + (s.okDefect ? '✅' : '❌')),
        kv('📉 技术债', fmt(s.techDebt)),
        kv('💬 口碑', s.reputation + '（本局 ' + fmt(s.repDelta) + '）'),
        kv('🔋 精力', s.energy),
        kv('💰 资金', fmt(s.funds) + ' 万 ' + (s.okFund ? '✅' : '❌')),
        kv('⭐ 经验', '+' + s.experience),
        kv('🎯 质量比', s.qualityRatio)
      ])
    ]);
    app().appendChild(card);
    app().appendChild(el('div', { class: 'card center' }, [
      el('button', { class: 'btn primary', text: '🔍 看归因反馈', onclick: onNext })
    ]));
  }

  // ---------- 归因反馈面板 ----------
  function showAttribution(player, seed, attribution, onNext) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    var card = el('div', { class: 'card' }, [
      el('h2', { text: '🔍 归因反馈：哪个决策 → 什么后果' })
    ]);
    attribution.forEach(function (item) {
      try {
        if (item.kind === 'global') {
          card.appendChild(el('div', { class: 'attr-global' }, [
            el('div', { class: 'attr-title', text: item.title }),
            el('ul', {}, item.lines.map(function (l) { return el('li', { text: l }); }))
          ]));
          return;
        }
        var d = item.deltas;
        var block = el('div', { class: 'attr-item' }, [
          el('div', { class: 'attr-title', text: item.title + (item.ampl > 1 ? '  ⚠️放大×' + item.ampl : '') }),
          el('div', { class: 'attr-deltas', html: deltasHtml(d) }),
          // 契约：logic.buildAttribution 的归因项文本列表挂在 lines（任务项由 t.notes 映射而来），notes 可能为空
          el('div', { class: 'attr-note', text: (item.lines || item.notes || []).join(' ｜ ') })
        ]);
        card.appendChild(block);
      } catch (e) {
        // 单条归因异常降级为占位块，避免中断循环导致底部「下一步」按钮丢失、玩家卡死
        card.appendChild(el('div', { class: 'attr-item', text: '⚠️ 该归因项渲染异常：' + (e && e.message) }));
      }
    });
    app().appendChild(card);
    app().appendChild(el('div', { class: 'card center' }, [
      el('button', { class: 'btn primary', text: '🌐 时代观察 & 结局', onclick: onNext })
    ]));
  }

  // ---------- 时代观察 + 结局 ----------
  function showNarrative(player, seed, narrativeText, ending, onNext) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    var card = el('div', { class: 'card' }, [
      el('h2', { text: '🌐 时代观察' }),
      el('p', { class: 'narrative', text: narrativeText })
    ]);
    app().appendChild(card);
    var endCard = el('div', { class: 'card ending' }, [
      el('h2', { text: ending.title }),
      el('p', { class: 'ending-text', text: ending.text })
    ]);
    app().appendChild(endCard);
    app().appendChild(el('div', { class: 'card center' }, [
      el('button', { class: 'btn primary', text: '🌱 成长 & 下一局', onclick: onNext })
    ]));
  }

  // ---------- 成长 + 下一局 ----------
  function showGrowth(player, seed, unlocked, onNext) {
    clear();
    app().appendChild(renderStatusBar(player, seed));
    var lines = [
      '本局获得经验 +（累计 ' + player.exp + '）',
      '累计技术债：' + player.techDebt + '（跨局反噬，越低越好）',
      'AI 版本：v' + player.aiVersion + '（旧策略收益随版本轻微衰减）',
      '已解锁：' + (player.unlocks.length ? describeUnlocks(player.unlocks) : '无')
    ];
    var card = el('div', { class: 'card' }, [
      el('h2', { text: '🌱 轻度成长' }),
      el('ul', {}, lines.map(function (l) { return el('li', { text: l }); }))
    ]);
    if (unlocked && unlocked.length) {
      card.appendChild(el('div', { class: 'unlock-note', text: '🎉 新解锁：' +
        unlocked.map(function (u) { return u.name + '（' + u.desc + '）'; }).join('；') }));
    }
    app().appendChild(card);
    app().appendChild(el('div', { class: 'card center' }, [
      el('button', { class: 'btn primary big', text: '▶ 开始下一局', onclick: onNext })
    ]));
  }

  function describeUnlocks(ids) {
    return ids.map(function (id) {
      var u = GAME_DATA.UNLOCKS.filter(function (x) { return x.id === id; })[0];
      return u ? u.name : id;
    }).join('、');
  }

  root.UI = {
    showTitle: showTitle,
    showProject: showProject,
    showDecision: showDecision,
    showExecution: showExecution,
    showSettlement: showSettlement,
    showAttribution: showAttribution,
    showNarrative: showNarrative,
    showGrowth: showGrowth,
    el: el
  };
})(typeof window !== 'undefined' ? window : this);
