(() => {
  const style = document.createElement('style');
  style.textContent = `
    .kai-announcement{position:fixed;left:50%;top:62px;z-index:9500;width:min(720px,calc(100vw - 32px));display:none;align-items:flex-start;gap:11px;padding:12px 14px;border:1px solid #37414f;border-radius:13px;background:rgba(25,29,36,.96);box-shadow:0 16px 45px rgba(0,0,0,.42);backdrop-filter:blur(12px);transform:translateX(-50%);color:#e8ecf2}
    .kai-announcement.open{display:flex}.kai-announcement.warning{border-color:#6b5630;background:rgba(42,35,24,.97)}.kai-announcement.success{border-color:#315b47;background:rgba(24,42,34,.97)}
    .kai-announcement-icon{width:27px;height:27px;flex:0 0 27px;display:grid;place-items:center;border-radius:8px;background:#283547;color:#90bcff;font-weight:800}.kai-announcement.warning .kai-announcement-icon{background:#4a3a20;color:#f4c86b}.kai-announcement.success .kai-announcement-icon{background:#204333;color:#79dfa8}
    .kai-announcement-copy{min-width:0;flex:1}.kai-announcement-copy b{display:block;margin-bottom:3px;font-size:13px}.kai-announcement-copy span{display:block;color:#adb4bf;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
    .kai-announcement-close{width:28px;height:28px;flex:0 0 28px;border:0;border-radius:7px;background:transparent;color:#959ca7;font-size:19px;cursor:pointer}.kai-announcement-close:hover{background:rgba(255,255,255,.08);color:white}
  `;
  document.head.appendChild(style);

  const banner = document.createElement('aside');
  banner.className = 'kai-announcement';
  banner.innerHTML = '<span class="kai-announcement-icon">i</span><div class="kai-announcement-copy"><b></b><span></span></div><button class="kai-announcement-close" aria-label="关闭公告">×</button>';
  document.body.appendChild(banner);

  function dismissed() {
    try { return new Set(JSON.parse(localStorage.getItem('kai-dismissed-announcements') || '[]')); }
    catch { return new Set(); }
  }
  function hide(id) {
    const values = dismissed(); values.add(id);
    localStorage.setItem('kai-dismissed-announcements', JSON.stringify([...values].slice(-80)));
    banner.classList.remove('open');
  }
  async function refresh() {
    try {
      const response = await fetch('/api/announcements', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      const hidden = dismissed();
      const item = (data.announcements || []).find(entry => !hidden.has(entry.id));
      if (!item) { banner.classList.remove('open'); return; }
      banner.dataset.id = item.id;
      banner.className = `kai-announcement open ${item.level || 'info'}`;
      banner.querySelector('.kai-announcement-icon').textContent = item.level === 'warning' ? '!' : item.level === 'success' ? '✓' : 'i';
      banner.querySelector('b').textContent = item.title;
      banner.querySelector('.kai-announcement-copy span').textContent = item.content;
    } catch {}
  }
  banner.querySelector('.kai-announcement-close').onclick = () => hide(banner.dataset.id);
  refresh();
  setInterval(refresh, 60000);
})();
