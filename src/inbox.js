// The CEO's inbox: a bell in the top bar and a drawer listing everything that needs you, with the action inline.
const ACTION_LABEL = { decide: 'Review and decide', answer: 'Answer', retry: 'Retry', open: 'Open', note: 'Read' };
const KIND_LABEL = { ceo_decision: 'Decision', ceo_approval: 'Approval', question: 'Question', blocked: 'Blocked', escalated: 'Needs you', done: 'Done', overdue: 'Overdue', digest: 'Digest', routine_failed: 'Routine', config_changed: 'Settings', provider_error: 'Models' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ago = at => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(at).toLocaleDateString(); };

export function initInbox({ api, openTask, openNote, retryTask }) {
  let items = [], counts = { unread: 0, needsYou: 0 };
  const bell = document.createElement('button');
  bell.id = 'inboxBell'; bell.type = 'button'; bell.setAttribute('aria-label', 'Inbox'); bell.setAttribute('aria-expanded', 'false');
  bell.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span>Inbox</span><b class="inbox-count" hidden></b>';
  document.getElementById('clock')?.before(bell);
  const drawer = document.createElement('aside');
  drawer.id = 'inboxDrawer'; drawer.hidden = true; drawer.setAttribute('aria-label', 'Inbox');
  drawer.innerHTML = `<header><h2>Inbox</h2><div class="inbox-tools"><button type="button" id="inboxReadAll">Mark all read</button><button type="button" id="inboxAlerts">Desktop alerts</button><button type="button" id="inboxClose" aria-label="Close">×</button></div></header><div id="inboxList"></div>`;
  document.body.appendChild(drawer);
  const $ = id => document.getElementById(id);
  const needsYou = item => item.severity === 'action' && !item.ackedAt;
  function render() {
    const badge = bell.querySelector('.inbox-count'); badge.hidden = !counts.needsYou; badge.textContent = counts.needsYou;
    bell.classList.toggle('has-unread', counts.unread > 0);
    const row = item => `<article class="inbox-item ${item.readAt ? '' : 'unread'} ${needsYou(item) ? 'needs' : ''}" data-id="${esc(item.id)}"><div class="inbox-meta"><span class="inbox-kind ${esc(item.kind)}">${esc(KIND_LABEL[item.kind] || item.kind)}</span><time>${esc(ago(item.at))}</time></div><b>${esc(item.title)}</b>${item.body ? `<p>${esc(item.body.slice(0, 280))}</p>` : ''}<div class="inbox-actions">${item.action?.type ? `<button type="button" data-act="${esc(item.action.type)}">${esc(ACTION_LABEL[item.action.type] || 'Open')}</button>` : ''}${item.action?.type === 'retry' ? '<button type="button" class="secondary" data-act="open">Open</button>' : ''}</div></article>`;
    const open = items.filter(needsYou), rest = items.filter(i => !needsYou(i)).slice(0, 40);
    $('inboxList').innerHTML = (open.length ? `<h3>Needs you <span>${open.length}</span></h3>${open.map(row).join('')}` : '<p class="inbox-empty">Nothing needs you right now.</p>') + (rest.length ? `<h3>Updates</h3>${rest.map(row).join('')}` : '');
    $('inboxAlerts').hidden = typeof Notification === 'undefined' || Notification.permission === 'granted';
  }
  async function refresh() { try { ({ items, counts } = await api('/inbox?limit=150')); render(); } catch {} }
  async function act(item, type) {
    if (!item.readAt) { api(`/inbox/${item.id}/read`, 'POST', {}).catch(() => {}); item.readAt = Date.now(); counts.unread = Math.max(0, counts.unread - 1); }
    if (type === 'note' && item.action?.id) openNote(item.action.id);
    else if (type === 'retry' && item.jobId) { await retryTask(item.jobId); await refresh(); }
    else if (item.jobId) openTask(item.jobId);
    render();
  }
  $('inboxList').addEventListener('click', event => {
    const card = event.target.closest('.inbox-item'); if (!card) return;
    const item = items.find(i => i.id === card.dataset.id); if (!item) return;
    act(item, event.target.closest('[data-act]')?.dataset.act || item.action?.type || 'open');
  });
  const toggle = show => { drawer.hidden = !show; bell.setAttribute('aria-expanded', String(show)); if (show) refresh(); };
  bell.onclick = () => toggle(drawer.hidden);
  $('inboxClose').onclick = () => toggle(false);
  $('inboxReadAll').onclick = async () => { counts = await api('/inbox/read-all', 'POST', {}); items.forEach(i => { i.readAt ||= Date.now(); }); render(); };
  $('inboxAlerts').onclick = async () => { if (typeof Notification !== 'undefined') { await Notification.requestPermission(); render(); } };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !drawer.hidden) toggle(false); });
  // Desktop alerts only when the office is in the background; clicking one brings you to the item.
  function alertFor(item) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden || !needsYou(item)) return;
    const note = new Notification(item.title, { body: String(item.body || '').slice(0, 180), tag: item.id });
    note.onclick = () => { window.focus(); act(item, item.action?.type || 'open'); note.close(); };
  }
  function onEvent(type, data) {
    if (type === 'notification.new') {
      const at = items.findIndex(i => i.id === data.id), wasOpen = at >= 0 && needsYou(items[at]);
      if (at >= 0) items.splice(at, 1);
      items.unshift(data); if (!data.readAt) counts.unread++; if (needsYou(data) && !wasOpen) counts.needsYou++;
      render(); alertFor(data);
    } else if (type === 'notification.read') {
      for (const id of data.ids || []) { const item = items.find(i => i.id === id); if (!item) continue; if (!item.readAt) { item.readAt = Date.now(); counts.unread = Math.max(0, counts.unread - 1); } if (data.acked && !item.ackedAt) { if (needsYou(item)) counts.needsYou = Math.max(0, counts.needsYou - 1); item.ackedAt = Date.now(); } }
      render();
    }
  }
  refresh();
  return { refresh, onEvent, open: () => toggle(true), close: () => toggle(false), get counts() { return counts; } };
}
