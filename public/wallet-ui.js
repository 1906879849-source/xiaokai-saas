(() => {
  const style = document.createElement('style');
  style.textContent = `
    .wallet-pill{width:auto!important;min-width:112px;padding:0 12px!important;display:flex;align-items:center;justify-content:center;gap:7px;font-weight:700;color:#e7e9ee!important}
    .wallet-pill .wallet-dot{width:8px;height:8px;border-radius:50%;background:#2f8cff;box-shadow:0 0 12px #2f8cff}
    .wallet-pill.low .wallet-dot{background:#ffb53d;box-shadow:0 0 12px #ffb53d}
    .wallet-cost{margin-left:auto;padding:5px 9px;border:1px solid #343840;border-radius:8px;color:#aeb4bf;font-size:12px;white-space:nowrap}
    .agent-price{margin-left:auto;color:#aeb4bf;font-size:12px;white-space:nowrap}
    .wallet-cost.insufficient{border-color:#794047;color:#ff929c}
    .wallet-modal{position:fixed;inset:0;z-index:10000;display:none;place-items:center;background:rgba(0,0,0,.62);backdrop-filter:blur(5px)}
    .wallet-modal.open{display:grid}.wallet-card{width:min(700px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));overflow:auto;padding:20px;border:1px solid #393d45;border-radius:18px;background:#1d1f23;box-shadow:0 28px 90px rgba(0,0,0,.55);color:#eef0f4}
    .wallet-head{display:flex;align-items:center;justify-content:space-between}.wallet-head h2{margin:0;font-size:18px}.wallet-close{width:32px;height:32px;border:0;border-radius:8px;background:#2b2d32;color:#bbc0c8;cursor:pointer}
    .wallet-balance{margin:18px 0;padding:18px;border:1px solid #343944;border-radius:14px;background:linear-gradient(135deg,#202b41,#202126)}.wallet-balance strong{display:block;font-size:34px}.wallet-balance small{color:#9da4b0}
    .wallet-note{padding:11px 13px;border-radius:10px;background:#27292e;color:#aeb3bd;line-height:1.6}.wallet-card h3{margin:20px 0 10px;font-size:14px}
    .wallet-prices,.wallet-ledger{display:grid;gap:8px}.wallet-row{display:flex;justify-content:space-between;gap:14px;padding:10px 12px;border:1px solid #30333a;border-radius:10px;background:#24262a}.wallet-row small{color:#858b96}.wallet-empty{padding:18px;text-align:center;color:#777d87}
    .auth-modal{position:fixed;inset:0;z-index:10001;display:none;place-items:center;background:rgba(0,0,0,.68);backdrop-filter:blur(6px)}.auth-modal.open{display:grid}
    .auth-card{width:min(430px,calc(100vw - 32px));padding:22px;border:1px solid #383c44;border-radius:18px;background:#1d1f23;box-shadow:0 28px 90px rgba(0,0,0,.6)}
    .auth-card h2{margin:0 0 6px}.auth-card p{margin:0 0 16px;color:#9096a1}.form-grid{display:grid;gap:10px}.form-grid input,.form-grid select{width:100%;height:42px;padding:0 11px;border:1px solid #363a42;border-radius:9px;background:#15171b;color:#eef0f4;outline:0}.form-grid button,.wallet-action{height:40px;border:0;border-radius:9px;background:#ecedf0;color:#17181b;font-weight:700;cursor:pointer}.wallet-action:disabled{cursor:not-allowed;opacity:.58}.auth-switch{margin-top:12px;color:#8ebcff;cursor:pointer;text-align:center}.wallet-user{display:flex;justify-content:space-between;align-items:center;margin:10px 0;color:#aeb4bf}.wallet-user button{border:0;background:transparent;color:#ff969e;cursor:pointer}.recharge-box{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:12px;border:1px solid #343840;border-radius:12px;background:#222429}.recharge-box input,.recharge-box select{height:38px;padding:0 9px;border:1px solid #393d45;border-radius:8px;background:#17191d;color:#e8eaf0}.recharge-box input[type=file]{grid-column:1/-1;padding:7px}.recharge-box .wide{grid-column:1/-1}.recharge-hint{grid-column:1/-1;color:#8e949f;font-size:12px;line-height:1.6}.payment-qr{min-width:0;display:grid;justify-items:center;align-content:start;gap:7px;padding:12px;border:1px solid #2b2e34;border-radius:12px;background:#15171a;text-align:center}.payment-qr img{width:100%;height:255px;object-fit:contain;border-radius:10px;background:white}.payment-qr b{color:#70dc9e}.payment-qr.contact b{color:#8ebcff}.payment-qr small{color:#9ba1aa;line-height:1.5}.payment-reminder{grid-column:1/-1;padding:11px 13px;border:1px solid #3b4a42;border-radius:10px;background:#1b2922;color:#b9d5c5;font-size:12px;line-height:1.7}.payment-reminder b{color:#78e1aa}.arrival-note{grid-column:1/-1;display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:10px;background:#282a30;color:#aeb4bf;font-size:12px;line-height:1.65}.arrival-note b{color:#f0c56b;white-space:nowrap}.package-grid{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.package-grid button{height:38px;border:1px solid #3a3e46;border-radius:8px;background:#292c32;color:#e5e8ed;cursor:pointer}.package-grid button:hover,.package-grid button.on{border-color:#66d596;background:#21392e;color:#82e8ad}.status-pending{color:#ffc560}.status-approved{color:#69d99c}.status-rejected{color:#ff8f99}@media(max-width:620px){.recharge-box{grid-template-columns:1fr}.payment-reminder,.arrival-note,.package-grid,.recharge-box .wide{grid-column:1}.payment-qr img{height:285px}}
  `;
  document.head.appendChild(style);

  const apiBase = () => {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
      return local && location.port !== '4318' ? 'http://127.0.0.1:4318' : '';
    }
    return 'http://127.0.0.1:4318';
  };
  let wallet = { balance: 0, reserved: 0, available: 0 };
  let quote = null;
  let currentUser = null;

  // Keep the price visible before login as well. The server remains the source
  // of truth for billing; this is only a display fallback for the public canvas.
  const LOCAL_IMAGE_PRICES = {
    'GPT Image 2': { standard: 24, high: 24, default: 24 },
    'GPT Image 2 · 4K 超分': { default: 24 },
    'GPT Image 2 · 原生 4K': { default: 40 },
    'GPT Image 2.5 Flare': { standard: 24, high: 24, default: 24 },
    'GPT Image 2.5 Sunburst': { standard: 24, high: 24, default: 24 },
    'Gemini 3 Pro Image': { default: 80 },
    'Gemini 3.1 Flash Image': { default: 60 },
  };
  // 示例按输入 2,000 + 输出 1,000 tokens 估算；真正扣费按返回用量计算。
  const LOCAL_AGENT_ESTIMATES = {
    'GPT 5.5 Vision · 省积分': 3,
    'GPT 5.5 Vision · 高质量': 3,
    'Gemini 3.1 Flash Lite · 省积分': 1,
    'Gemini 3 Flash · 标准': 1,
  };

  const actions = document.querySelector('.top-actions');
  const button = document.createElement('button');
  button.className = 'wallet-pill';
  button.title = '积分账户与消费记录';
  button.innerHTML = '<span class="wallet-dot"></span><span id="walletBalance">积分 --</span>';
  actions?.prepend(button);

  const cost = document.createElement('span');
  cost.className = 'wallet-cost';
  const run = document.getElementById('run');
  run?.parentElement?.insertBefore(cost, run);

  const modal = document.createElement('div');
  modal.className = 'wallet-modal';
  modal.innerHTML = `<section class="wallet-card" role="dialog" aria-modal="true" aria-label="积分账户">
    <div class="wallet-head"><h2>KAI 积分</h2><button class="wallet-close">×</button></div>
    <div class="wallet-user"><span id="walletUser">未登录</span><span><a id="walletAdmin" href="/admin.html" target="_blank" hidden style="color:#8ebcff;margin-right:12px">管理员后台</a><button id="walletLogout">退出登录</button></span></div>
    <div class="wallet-balance"><strong id="walletAvailable">--</strong><small id="walletDetail">可用积分</small></div>
    <div class="wallet-note">100 KAI 积分 = ¥1.00。任务会先冻结积分，成功后按实际用量扣除，失败自动返还。</div>
    <h3>申请充值</h3><form class="recharge-box" id="rechargeForm"><div class="payment-qr"><img src="/payment/wechat-qr.png" alt="微信收款二维码"><b>① 微信扫码付款</b><small>收款人：kai（**凯）<br>¥1 = 100 积分</small></div><div class="payment-qr contact"><img src="/payment/wechat-contact-qr.png" alt="添加 kai 微信好友二维码"><b>② 添加客服微信</b><small>付款后添加好友<br>把付款信息发给我</small></div><div class="payment-reminder"><b>付款后请发送：</b>登录账号、付款金额、付款时间。这样可以更快核对到账，避免遗漏充值申请。</div><div class="arrival-note"><b>预计到账</b><span>当前为人工审核，通常 5–30 分钟到账。如超过 30 分钟仍未到账，请添加客服微信并发送订单号。</span></div><div class="package-grid"><button type="button" data-recharge-amount="10">¥10</button><button type="button" data-recharge-amount="30">¥30</button><button type="button" data-recharge-amount="50">¥50</button><button type="button" data-recharge-amount="100">¥100</button></div><input id="rechargeAmount" type="number" min="1" step="1" placeholder="充值金额（元）" required><select id="rechargeChannel"><option value="wechat">微信支付</option><option value="alipay" disabled>支付宝（尚未配置）</option></select><button class="wallet-action wide" type="submit">我已完成付款，提交审核</button></form>
    <h3>充值记录</h3><div class="wallet-ledger" id="rechargeList"><div class="wallet-empty">暂无充值申请</div></div>
    <h3>模型价格</h3><div class="wallet-prices" id="walletPrices"></div>
    <h3>最近流水</h3><div class="wallet-ledger" id="walletLedger"><div class="wallet-empty">正在读取…</div></div>
  </section>`;
  document.body.appendChild(modal);

  const authModal = document.createElement('div');
  authModal.className = 'auth-modal';
  authModal.innerHTML = `<section class="auth-card"><div class="wallet-head"><h2 id="authTitle">登录画布</h2><button class="wallet-close" id="authClose">×</button></div><p id="authHint">登录后才能使用生成模型和个人积分。</p><form class="form-grid" id="authForm"><input id="authDisplay" placeholder="昵称（注册时填写）" hidden><input id="authUsername" autocomplete="username" placeholder="账号 / 邮箱" required><input id="authPassword" type="password" autocomplete="current-password" placeholder="密码（至少 8 位）" required><button type="submit" id="authSubmit">登录</button></form><div class="auth-switch" id="authSwitch">没有账号？立即注册</div></section>`;
  document.body.appendChild(authModal);
  let authMode = 'login';

  function apply(next) {
    if (!next) return;
    wallet = next;
    document.getElementById('walletBalance').textContent = currentUser ? `积分 ${next.available}` : '登录';
    document.getElementById('walletAvailable').textContent = next.available;
    document.getElementById('walletDetail').textContent = `总额 ${next.balance}　冻结 ${next.reserved}`;
    button.classList.toggle('low', quote ? next.available < quote.total : next.available < 50);
    renderQuote();
  }

  async function json(path, options = {}) {
    const response = await fetch(apiBase() + path, { credentials: 'include', ...options, headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function showAuth(mode = 'login') {
    authMode = mode;
    const registering = mode === 'register';
    document.getElementById('authTitle').textContent = registering ? '注册账号' : '登录画布';
    document.getElementById('authDisplay').hidden = !registering;
    document.getElementById('authSubmit').textContent = registering ? '注册并登录' : '登录';
    document.getElementById('authSwitch').textContent = registering ? '已有账号？返回登录' : '没有账号？立即注册';
    authModal.classList.add('open');
  }

  async function loadAccount() {
    try {
      const data = await json('/api/auth/me'); currentUser = data.user; apply(data.wallet);
      document.getElementById('walletUser').textContent = `${currentUser.displayName || currentUser.username} · ${currentUser.username}`;
      document.getElementById('walletAdmin').hidden = currentUser.role !== 'admin';
      return true;
    } catch {
      currentUser = null; wallet = { balance: 0, reserved: 0, available: 0 }; apply(wallet); refreshQuote(); return false;
    }
  }

  function currentParams() {
    const label = document.getElementById('modelLabel');
    const model = label?.dataset?.model || label?.textContent?.trim() || '';
    const resolutionButton = document.querySelector('.resolution-grid button.on');
    const resolution = resolutionButton?.dataset?.value || resolutionButton?.textContent?.trim() || 'standard';
    const count = document.querySelector('.count-grid button.on')?.textContent?.trim() || '1';
    return { model, resolution, count };
  }

  function renderQuote() {
    if (!quote) { cost.textContent = '暂未定价'; cost.classList.remove('insufficient'); return; }
    cost.textContent = `消耗 ${quote.total} 积分 · ¥${Number(quote.totalRmb || quote.total * 0.01).toFixed(2)}`;
    const insufficient = wallet.available < quote.total;
    cost.classList.toggle('insufficient', insufficient);
    cost.title = insufficient ? `积分不足：需要 ${quote.total}，可用 ${wallet.available}` : `单张 ${quote.unit} 积分，共 ${quote.count} 张`;
  }

  function localQuote(params) {
    const values = LOCAL_IMAGE_PRICES[params.model];
    if (!values) return null;
    const count = Math.max(1, Math.min(8, Number(params.count) || 1));
    const unit = Number(values[params.resolution] ?? values.default);
    return {
      model: params.model,
      resolution: params.resolution,
      count,
      unit,
      total: unit * count,
      unitRmb: unit * 0.01,
      totalRmb: unit * count * 0.01,
    };
  }

  let quoteTimer;
  async function refreshQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      const p = currentParams();
      try {
        const data = await json(`/api/pricing/quote?model=${encodeURIComponent(p.model)}&resolution=${encodeURIComponent(p.resolution)}&count=${encodeURIComponent(p.count)}`);
        quote = data.quote; apply(data.wallet);
      } catch { quote = localQuote(p); renderQuote(); }
    }, 80);
  }

  async function refreshAgentQuote(node) {
    if (!node?.classList?.contains('agent-node')) return;
    const model = node.querySelector('.agent-model')?.value?.trim();
    const button = node.querySelector('.agent-run');
    if (!model || !button) return;
    try {
      const data = await json(`/api/pricing/agent?model=${encodeURIComponent(model)}`);
      const q = data.quote;
      button.dataset.price = String(q.total);
      button.textContent = `运行 Agent · 约 ${q.total} 积分（按用量）`;
      button.title = `按实际输入/输出 token 结算；当前示例按输入 2000、输出 1000 tokens 估算。失败不扣积分`;
    } catch {
      const points = LOCAL_AGENT_ESTIMATES[model];
      button.dataset.price = points ? String(points) : '';
      button.textContent = points ? `运行 Agent · 约 ${points} 积分（按用量）` : '运行 Agent · 暂未定价';
      button.title = points ? '示例按输入 2000、输出 1000 tokens 估算；实际按 token 用量结算，失败不扣积分' : '';
    }
  }

  function refreshAllAgentQuotes() {
    document.querySelectorAll('.agent-node').forEach(refreshAgentQuote);
  }

  let agentQuoteTimer;
  function scheduleAgentQuoteRefresh() {
    clearTimeout(agentQuoteTimer);
    agentQuoteTimer = setTimeout(refreshAllAgentQuotes, 120);
  }

  async function refresh() {
    if (!currentUser && !(await loadAccount())) { refreshQuote(); return; }
    try { apply((await json('/api/wallet')).wallet); } catch { currentUser = null; document.getElementById('walletBalance').textContent = '登录'; }
    refreshQuote();
  }

  const labels = { opening: '初始积分', reserve: '冻结', charge: '生成扣除', release: '返还', grant: '充值' };
  async function open() {
    if (!currentUser && !(await loadAccount())) return showAuth('login');
    modal.classList.add('open');
    try {
      const [history, pricing, rechargeData] = await Promise.all([json('/api/wallet/history?limit=30'), json('/api/pricing'), json('/api/recharges?limit=20')]);
      apply(history.wallet);
      const priceEl = document.getElementById('walletPrices'); priceEl.replaceChildren();
      const priceLabels = { standard: '标准', high: '高质量', '4K': '4K' };
      const modelLabels = { 'GPT Image 2 · 原生 4K': 'GPT Image 2 · 4K', 'GPT Image 2.5 Flare': 'GPT Image 2.5', 'GPT Image 2.5 Sunburst': 'GPT Image 2.5 Pro' };
      Object.entries(pricing.prices).forEach(([name, values]) => {
        const row = document.createElement('div'); row.className = 'wallet-row';
        const format = (points, suffix='') => `${points} 积分（¥${(points * (pricing.pointValueRmb || 0.01)).toFixed(2)}）${suffix}`;
        const detail = Object.entries(values).filter(([key]) => key !== 'default').map(([key, value]) => `${priceLabels[key] || key} ${format(value)}`).join(' · ');
        const agentSuffix = name.startsWith('Agent ·') ? '（示例用量，实际按 token）' : ' / 张';
        row.innerHTML = `<span>${modelLabels[name] || name}</span><b>${detail || (name.startsWith('Agent ·') ? '约 ' : '') + format(values.default, agentSuffix)}</b>`; priceEl.appendChild(row);
      });
      const ledger = document.getElementById('walletLedger'); ledger.replaceChildren();
      history.ledger.forEach(item => {
        const row = document.createElement('div'); row.className = 'wallet-row';
        const sign = item.amount > 0 ? '+' : '';
        row.innerHTML = `<span>${labels[item.type] || item.type}<br><small>${new Date(item.createdAt).toLocaleString()}</small></span><b>${sign}${item.amount}</b>`;
        ledger.appendChild(row);
      });
      if (!history.ledger.length) ledger.innerHTML = '<div class="wallet-empty">暂无流水</div>';
      const rechargeList = document.getElementById('rechargeList'); rechargeList.replaceChildren();
      const statusText = { pending:'待审核', approved:'已到账', rejected:'已拒绝' };
      rechargeData.recharges.forEach(item => { const row=document.createElement('div');row.className='wallet-row';row.innerHTML=`<span>${item.channel==='wechat'?'微信':'支付宝'} ¥${Number(item.amountRmb).toFixed(2)}<br><small>${new Date(item.createdAt).toLocaleString()}</small></span><b class="status-${item.status}">${statusText[item.status]||item.status}<br><small>${item.points} 积分</small></b>`;rechargeList.appendChild(row) });
      if (!rechargeData.recharges.length) rechargeList.innerHTML='<div class="wallet-empty">暂无充值申请</div>';
    } catch (error) { document.getElementById('walletLedger').innerHTML = `<div class="wallet-empty">${error.message}</div>`; }
  }

  button.onclick = open;
  modal.querySelector('.wallet-close').onclick = () => modal.classList.remove('open');
  modal.onclick = event => { if (event.target === modal) modal.classList.remove('open'); };
  authModal.onclick = event => { if (event.target === authModal) authModal.classList.remove('open'); };
  document.getElementById('authClose').onclick = () => authModal.classList.remove('open');
  document.getElementById('authSwitch').onclick = () => showAuth(authMode === 'login' ? 'register' : 'login');
  document.getElementById('authForm').onsubmit = async event => {
    event.preventDefault();
    const payload={username:document.getElementById('authUsername').value,password:document.getElementById('authPassword').value,displayName:document.getElementById('authDisplay').value};
    try { const data=await json(`/api/auth/${authMode}`,{method:'POST',body:JSON.stringify(payload)});currentUser=data.user;apply(data.wallet);authModal.classList.remove('open');await open(); }
    catch(error){ alert(error.message); }
  };
  document.getElementById('walletLogout').onclick = async () => { try{await json('/api/auth/logout',{method:'POST'})}catch{} currentUser=null;modal.classList.remove('open');apply({balance:0,reserved:0,available:0});showAuth('login'); };
  document.querySelectorAll('[data-recharge-amount]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-recharge-amount]').forEach(item => item.classList.toggle('on', item === button));
    document.getElementById('rechargeAmount').value = button.dataset.rechargeAmount;
  });
  document.getElementById('rechargeAmount').addEventListener('input', () => document.querySelectorAll('[data-recharge-amount]').forEach(item => item.classList.toggle('on', item.dataset.rechargeAmount === document.getElementById('rechargeAmount').value)));
  let rechargeRequestId = '';
  document.getElementById('rechargeForm').onsubmit = async event => {
    event.preventDefault();
    const submit=event.submitter||event.target.querySelector('[type="submit"]');
    if(submit?.disabled)return;
    rechargeRequestId=rechargeRequestId||(crypto.randomUUID?.()||('recharge-'+Date.now()+'-'+Math.random().toString(16).slice(2)));
    if(submit){submit.disabled=true;submit.textContent='正在提交，请勿重复点击…'}
    try { const data=await json('/api/recharges',{method:'POST',body:JSON.stringify({amountRmb:document.getElementById('rechargeAmount').value,channel:document.getElementById('rechargeChannel').value,clientRequestId:rechargeRequestId})});alert((data.recharge.duplicate?'该充值申请已提交，请勿重复提交':'充值申请已提交')+'\n订单号：'+data.recharge.id+'\n预计 5–30 分钟到账，超时请联系微信客服');if(!data.recharge.duplicate){event.target.reset();document.querySelectorAll('[data-recharge-amount]').forEach(item=>item.classList.remove('on'))}rechargeRequestId='';await open(); }
    catch(error){alert(error.message)}
    finally{if(submit){submit.disabled=false;submit.textContent='我已完成付款，提交审核'}}
  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') modal.classList.remove('open'); });
  document.addEventListener('click', event => { if (event.target.closest('.model-choice,.resolution-grid button,.count-grid button')) refreshQuote(); }, true);
  document.addEventListener('change', event => { const node = event.target.closest('.agent-node'); if (event.target.matches('.agent-model') && node) refreshAgentQuote(node); }, true);
  new MutationObserver(scheduleAgentQuoteRefresh).observe(document.getElementById('world'), { childList: true, subtree: true });
  new MutationObserver(refreshQuote).observe(document.getElementById('modelLabel'), { childList: true, characterData: true, subtree: true });
  window.KAI_WALLET = { apply, refresh, refreshQuote };
  loadAccount().then(ok=>{if(ok)refresh()});
  refreshAllAgentQuotes();
  setInterval(refresh, 30000);
})();
