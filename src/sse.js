// Live updates from /api/events. The browser reconnects on its own and replays what it missed;
// after repeated failures the page falls back to polling until the stream comes back.
// Every type the server publishes that a page acts on: a type missing here never reaches the page (a deleted task stayed on
// other boards until the next poll).
export const TYPES = ['task.updated', 'task.state', 'task.live', 'task.event', 'task.removed', 'notification.new', 'notification.read', 'notification.removed', 'office.updated', 'brain.updated', 'thread.message', 'thread.delivered', 'audit.recorded', 'resync'];
export function connectLive({ onEvent, onStatus = () => {} }) {
  let source = null, failures = 0, closed = false, lastId = 0, retry = null;
  const open = () => {
    if (closed) return;
    if (typeof EventSource === 'undefined') { onStatus('polling'); return; }
    source = new EventSource('/api/events' + (lastId ? `?lastEventId=${lastId}` : ''));
    source.onopen = () => { failures = 0; onStatus('live'); };
    source.onerror = () => {
      failures++;
      if (failures < 3) { onStatus('reconnecting'); return; }
      onStatus('polling'); source.close(); clearTimeout(retry); retry = setTimeout(open, Math.min(60000, 5000 * failures));
    };
    for (const type of TYPES) source.addEventListener(type, event => {
      lastId = Number(event.lastEventId) || lastId;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      try { onEvent(type, data); } catch (error) { console.warn('live update', type, error); }
    });
  };
  open();
  return { close() { closed = true; clearTimeout(retry); source?.close(); }, get live() { return source?.readyState === 1; } };
}
