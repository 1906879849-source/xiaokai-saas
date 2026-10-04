(() => {
  'use strict';
  let modelCatalog = [];
  let lastStatus = null;
  let activeWorkflowNodes = [];
  let bypassRunCheck = false;

  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const nodeName = node => (node?.querySelector('.node-label')?.textContent || '节点').replace(/^[^　]*　/, '').trim();
  const incoming = node => [...document.querySelectorAll('.wire path[data-a][data-b]')].filter(path => path.dataset.b === node.id).map(path => document.getElementById(path.dataset.a)).filter(Boolean);
  const outgoing = node => [...document.querySelectorAll('.wire path[data-a][data-b]')].filter(path => path.dataset.a === node.id).map(path => document.getElementById(path.dataset.b)).filter(Boolean);

  function ensureUi() {
    if (!document.getElementById('kaiServiceStatus')) {
      document.body.insertAdjacentHTML('beforeend', '<button class="kai-service-status checking" id="kaiServiceStatus"><i></i><span>检查服务</span></button><div class="kai-status-pop" id="kaiStatusPop" hidden></div>');
      const button = document.getElementById('kaiServiceStatus'), pop = document.getElementById('kaiStatusPop');
      button.onclick = () => { pop.hidden = !pop.hidden; if (!pop.hidden) renderStatusPop(); };
      document.addEventListener('click', event => { if (!event.target.closest('#kaiServiceStatus,#kaiStatusPop')) pop.hidden = true; });
    }
    if (!document.getElementById('kaiMaintenance')) {
      document.body.insertAdjacentHTML('beforeend', '<section class="kai-maintenance" id="kaiMaintenance" hidden><div class="kai-maintenance-card"><div class="kai-maintenance-icon">⚙</div><h1></h1><p></p><div class="kai-maintenance-time"></div><div class="kai-maintenance-actions"><button type="button">重新检查</button><a href="/admin.html">管理员入口</a></div></div></section>');
      document.querySelector('#kaiMaintenance button').onclick = refreshStatus;
    }
    if (!document.getElementById('kaiPreflightPanel')) {
      document.body.insertAdjacentHTML('beforeend', '<section class="kai-preflight-panel" id="kaiPreflightPanel" hidden><div class="kai-preflight-shell"><header class="kai-preflight-head"><div><b>运行预设工作流</b><span>只需填写下面的输入，内部节点会按顺序自动执行</span></div><button class="kai-preflight-close">×</button></header><div class="kai-preflight-body"><div class="kai-input-list" id="kaiInputList"></div><div class="kai-check-results" id="kaiCheckResults"></div></div><footer class="kai-preflight-foot"><span class="kai-preflight-summary" id="kaiPreflightSummary"></span><button id="kaiAdvancedEdit">高级编辑</button><button class="primary" id="kaiRunPreset">检查并运行</button></footer></div></section>');
      document.querySelector('.kai-preflight-close').onclick = closeRunner;
      document.getElementById('kaiAdvancedEdit').onclick = closeRunner;
      document.getElementById('kaiRunPreset').onclick = runFromRunner;
    }
  }

  function renderStatusPop() {
    const pop = document.getElementById('kaiStatusPop');
    if (!lastStatus) { pop.innerHTML = '<b>服务状态未知</b><small>正在重新检查……</small>'; return; }
    const online = lastStatus.status === 'operational';
    pop.innerHTML = `<b>${online ? '服务运行正常' : '维护模式已开启'}</b><small>版本：${escapeHtml(lastStatus.version || '未知')}</small><small>启动时间：${lastStatus.startedAt ? new Date(lastStatus.startedAt).toLocaleString() : '未知'}</small><small>最近检查：${new Date().toLocaleTimeString()}</small>`;
  }

  async function refreshStatus() {
    const button = document.getElementById('kaiServiceStatus');
    button.className = 'kai-service-status checking'; button.querySelector('span').textContent = '检查服务';
    try {
      const response = await fetch('/api/platform/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastStatus = await response.json();
      const maintenance = lastStatus.status === 'maintenance';
      button.className = 'kai-service-status ' + (maintenance ? 'bad' : 'ok');
      button.querySelector('span').textContent = maintenance ? '系统维护' : '服务正常';
      const overlay = document.getElementById('kaiMaintenance'); overlay.hidden = !maintenance;
      if (maintenance) {
        overlay.querySelector('h1').textContent = lastStatus.maintenance?.title || '系统维护中';
        overlay.querySelector('p').textContent = lastStatus.maintenance?.message || '请稍后再试';
        overlay.querySelector('.kai-maintenance-time').textContent = lastStatus.maintenance?.expectedEnd ? `预计恢复：${lastStatus.maintenance.expectedEnd}` : '';
      }
    } catch {
      lastStatus = null; button.className = 'kai-service-status bad'; button.querySelector('span').textContent = '服务离线';
    }
    renderStatusPop();
  }

  async function loadModels() {
    try {
      const response = await fetch('/api/models', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '模型配置读取失败');
      modelCatalog = data.models || [];
      const byName = new Map(modelCatalog.map(model => [model.name, model]));
      document.querySelectorAll('.model-choice').forEach(button => {
        const model = byName.get(button.dataset.model);
        button.hidden = !model; button.dataset.dynamicEnabled = model ? '1' : '0';
        if (model) { button.dataset.resolutions = JSON.stringify(model.resolutions); button.title = `${model.resolutions.join(' / ')} · ${model.resolutions.map(resolution => `${resolution} ${model.prices[resolution]}积分`).join('，')}`; }
      });
      const chosen = document.getElementById('modelLabel')?.dataset.model;
      if (!byName.has(chosen)) {
        const first = document.querySelector('.model-choice[data-dynamic-enabled="1"]');
        if (first && typeof applyModelChoice === 'function') applyModelChoice(first.dataset.model);
      }
      installDynamicResolution();
    } catch (error) { console.warn('[platform models]', error); }
  }

  function installDynamicResolution() {
    if (typeof configureResolutionForModel !== 'function') return;
    configureResolutionForModel = function(modelName) {
      const model = modelCatalog.find(item => item.name === modelName);
      const allowed = model?.resolutions?.length ? model.resolutions : ['1K'];
      const buttons = [...document.querySelectorAll('.resolution-grid button')];
      buttons.forEach(button => {
        const enabled = allowed.includes(button.dataset.value); button.hidden = !enabled;
        if (enabled) button.dataset.price = `${model?.prices?.[button.dataset.value] ?? 0} 积分`; else delete button.dataset.price;
      });
      const visible = buttons.filter(button => !button.hidden);
      const selected = visible.find(button => button.classList.contains('on')) || visible[0];
      buttons.forEach(button => button.classList.toggle('on', button === selected));
      const ratio = document.querySelector('.ratio-grid .on')?.textContent.trim() || '自适应';
      const resolution = selected?.dataset.value || allowed[0];
      const count = document.querySelector('.count-grid .on')?.textContent.trim() || '1';
      const size = document.getElementById('sizeButton'); if (size) size.title = `${ratio} · ${resolution} · ${count} 张 · ${model?.prices?.[resolution] ?? 0} 积分/张`;
    };
    const current = document.getElementById('modelLabel')?.dataset.model; if (current) configureResolutionForModel(current);
  }

  function workflowScope() {
    if (activeWorkflowNodes.length && activeWorkflowNodes.some(node => node.isConnected)) return activeWorkflowNodes.filter(node => node.isConnected);
    const grouped = new Map();
    document.querySelectorAll('.node[data-workflow-instance]').forEach(node => { const key = node.dataset.workflowInstance; const item = grouped.get(key) || { time: 0, nodes: [] }; item.time = Math.max(item.time, Number(node.dataset.workflowImportedAt) || 0); item.nodes.push(node); grouped.set(key, item); });
    return [...grouped.values()].sort((a, b) => b.time - a.time)[0]?.nodes || [...document.querySelectorAll('.node')];
  }

  function clearErrors() { document.querySelectorAll('.kai-preflight-error').forEach(node => node.classList.remove('kai-preflight-error')); }
  function validateWorkflow(scope = workflowScope()) {
    clearErrors(); const errors = [], scopeSet = new Set(scope);
    const edges = [...document.querySelectorAll('.wire path[data-a][data-b]')].filter(path => scopeSet.has(document.getElementById(path.dataset.a)) && scopeSet.has(document.getElementById(path.dataset.b)));
    const push = (node, message) => { errors.push({ node, message }); node?.classList.add('kai-preflight-error'); };
    scope.forEach(node => {
      if (node.classList.contains('blank-image-node') && !node.querySelector('.uploaded-image')) push(node, `${nodeName(node)}：请上传图片`);
      if (node.matches('.text-node,.note-node') && outgoing(node).some(target => scopeSet.has(target)) && !node.querySelector('textarea')?.value.trim()) push(node, `${nodeName(node)}：请填写文字`);
      if (node.classList.contains('agent-node')) {
        const userNeed = node.querySelectorAll('textarea')[1]?.value.trim();
        if (!userNeed && !incoming(node).some(source => scopeSet.has(source))) push(node, `${nodeName(node)}：缺少用户需求或上游输入`);
      }
      if (node.classList.contains('generation-node')) {
        const modelName = (node.dataset.modelName || document.getElementById('modelLabel')?.dataset.model || '').trim();
        if (!modelCatalog.some(model => model.name === modelName)) push(node, `${nodeName(node)}：模型“${modelName || '未选择'}”已停用或未配置`);
        const hasPrompt = Boolean((node.dataset.promptText || node.dataset.agentPushedText || '').trim());
        const hasTextInput = incoming(node).some(source => source.classList.contains('agent-node') || source.matches('.text-node,.note-node'));
        if (!hasPrompt && !hasTextInput) push(node, `${nodeName(node)}：缺少生图描述或上游文案`);
      }
    });
    const runnable = scope.filter(node => node.classList.contains('agent-node') || node.classList.contains('generation-node'));
    if (!runnable.length) errors.push({ node: null, message: '工作流中没有可运行的 Agent 或生图节点' });
    const indegree = new Map(scope.map(node => [node.id, 0])), adjacency = new Map(scope.map(node => [node.id, []]));
    edges.forEach(path => { adjacency.get(path.dataset.a)?.push(path.dataset.b); indegree.set(path.dataset.b, (indegree.get(path.dataset.b) || 0) + 1); });
    const queue = scope.filter(node => (indegree.get(node.id) || 0) === 0).map(node => node.id); let visited = 0;
    while (queue.length) { const id = queue.shift(); visited++; for (const next of adjacency.get(id) || []) { indegree.set(next, indegree.get(next) - 1); if (indegree.get(next) === 0) queue.push(next); } }
    if (edges.length && visited < scope.length) errors.push({ node: null, message: '工作流连线存在循环，请先断开循环连接' });
    return errors;
  }

  function renderInputs(scope) {
    const root = document.getElementById('kaiInputList'); root.replaceChildren();
    const inputs = scope.filter(node => node.classList.contains('blank-image-node') || (node.matches('.text-node,.note-node') && outgoing(node).length));
    if (!inputs.length) { root.innerHTML = '<div class="kai-preflight-empty">这个预设没有需要填写的外部输入，可直接运行。</div>'; return; }
    inputs.forEach((node, index) => {
      const item = document.createElement('div'); item.className = 'kai-input-item';
      const label = document.createElement('label'); label.textContent = `${index + 1}. ${nodeName(node)}`; item.appendChild(label);
      if (node.classList.contains('blank-image-node')) {
        const row = document.createElement('div'); row.className = 'kai-input-image';
        const preview = document.createElement('img'), button = document.createElement('button'); button.type = 'button'; button.textContent = node.querySelector('.uploaded-image') ? '更换图片' : '选择图片';
        const sync = () => { preview.src = node.querySelector('.uploaded-image')?.src || ''; button.textContent = node.querySelector('.uploaded-image') ? '更换图片' : '选择图片'; };
        button.onclick = () => { node.querySelector('.blank-image-upload')?.click() || node.querySelector('.blank-image-file')?.click(); setTimeout(sync, 350); };
        node.querySelector('.blank-image-file')?.addEventListener('change', () => setTimeout(sync, 120), { once: false }); sync(); row.append(preview, button); item.appendChild(row);
      } else {
        const source = node.querySelector('textarea'), field = document.createElement('textarea'); field.placeholder = source?.placeholder || '请输入内容'; field.value = source?.value || '';
        field.oninput = () => { source.value = field.value; source.dispatchEvent(new Event('input', { bubbles: true })); };
        item.appendChild(field);
      }
      root.appendChild(item);
    });
  }

  function showValidation(errors) {
    const root = document.getElementById('kaiCheckResults'); root.replaceChildren();
    const summary = document.getElementById('kaiPreflightSummary'), run = document.getElementById('kaiRunPreset');
    if (!errors.length) { root.innerHTML = '<div class="kai-check-result ok">✓ 检查通过：输入、连线和模型配置均可用</div>'; summary.textContent = '可以开始运行'; run.disabled = false; return; }
    errors.forEach(error => { const row = document.createElement('button'); row.type = 'button'; row.className = 'kai-check-result error'; row.textContent = '● ' + error.message; if (error.node) row.onclick = () => { closeRunner(); try { selectNode(error.node, false, true); } catch {} }; root.appendChild(row); });
    summary.textContent = `发现 ${errors.length} 个问题`; run.disabled = true;
  }

  function openRunner(scope = workflowScope()) { activeWorkflowNodes = scope; document.getElementById('kaiPreflightPanel').hidden = false; renderInputs(scope); showValidation(validateWorkflow(scope)); }
  function closeRunner() { document.getElementById('kaiPreflightPanel').hidden = true; clearErrors(); }
  function runFromRunner() { const errors = validateWorkflow(activeWorkflowNodes); showValidation(errors); if (errors.length) return; closeRunner(); const button = document.getElementById('runWholeWorkflow'); if (!button) return; bypassRunCheck = true; try { button.onclick?.call(button, new MouseEvent('click')); } finally { bypassRunCheck = false; } }

  function hookWorkflowImport() {
    document.addEventListener('kai:workflow-imported', event => {
      const ids = Array.isArray(event.detail?.nodeIds) ? event.detail.nodeIds : [];
      setTimeout(() => { activeWorkflowNodes = ids.map(id => document.getElementById(id)).filter(Boolean); if (activeWorkflowNodes.length) openRunner(activeWorkflowNodes); }, 80);
    });
  }

  function hookWholeRun() {
    document.addEventListener('click', event => {
      const button = event.target.closest('#runWholeWorkflow'); if (!button || bypassRunCheck) return;
      event.preventDefault(); event.stopImmediatePropagation(); openRunner(workflowScope());
    }, true);
  }

  ensureUi(); hookWorkflowImport(); hookWholeRun(); loadModels(); refreshStatus();
  window.KAI_PLATFORM_RUNTIME = { validateWorkflow, openRunner, refreshStatus, loadModels, get models() { return modelCatalog; } };
  setInterval(refreshStatus, 30000); setInterval(loadModels, 120000);
})();
