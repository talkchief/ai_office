// Who may see a task or a project. The viewer is `null` in a single-owner office (everything is visible) and
// `{ id, role, groups }` in a hosted one. Rules, in order: no viewer → visible; office owner or admin → visible;
// the record's owner → visible; public → visible; shared with the viewer or one of their groups → visible;
// a task inherits its project's audience. Otherwise: 403 on direct access and absent from every list and stream.
import { httpError } from './routes.mjs';

export const ADMIN_ROLES = new Set(['owner', 'admin']);
export const INVISIBLE = 'This task belongs to someone else in the office.';
export const isAdmin = viewer => !viewer || ADMIN_ROLES.has(viewer.role);
export const audienceOf = record => ({ visibility: record?.visibility === 'public' ? 'public' : 'private', sharedWith: { users: record?.sharedWith?.users || [], groups: record?.sharedWith?.groups || [] } });

// The owner / public / shared test for any record carrying ownerId, visibility and sharedWith.
export function canSeeRecord(viewer, record) {
  if (!viewer || !record) return true;
  if (ADMIN_ROLES.has(viewer.role)) return true;
  if (record.ownerId && record.ownerId === viewer.id) return true;
  if (record.visibility === 'public') return true;
  const shared = record.sharedWith || {};
  if ((shared.users || []).includes(viewer.id)) return true;
  const mine = viewer.groups || [];
  return (shared.groups || []).some(g => mine.includes(g));
}
export const canSeeProject = (viewer, project) => canSeeRecord(viewer, project);
export function canSeeJob(viewer, job, { project = null } = {}) {
  if (!viewer) return true;
  if (canSeeRecord(viewer, job)) return true;
  return !!project && canSeeRecord(viewer, project);
}
// `projectFor(id)` hands back the project record; results are cached per call so a list of 1,000 tasks does not look one up 1,000 times.
export function visibleJobs(viewer, jobs, { projectFor = () => null } = {}) {
  if (!viewer || ADMIN_ROLES.has(viewer.role)) return jobs;
  const cache = new Map();
  const project = id => { if (!id) return null; if (!cache.has(id)) cache.set(id, projectFor(id)); return cache.get(id); };
  return jobs.filter(job => canSeeJob(viewer, job, { project: project(job.projectId) }));
}
export function requireRole(viewer, roles = ['owner', 'admin'], message = 'Only the office owner or an admin can do this.') {
  if (viewer && !roles.includes(viewer.role)) throw httpError(message, 403);
}
// May this viewer change who sees the record? The office owner/admin, or the record's own owner.
export const canShare = (viewer, record) => !viewer || ADMIN_ROLES.has(viewer.role) || (!!record?.ownerId && record.ownerId === viewer.id);
// An inbox item addressed to a person reaches that person and the office owner/admin; one addressed to nobody reaches the owner/admin.
export function notificationVisible(viewer, item) {
  if (!viewer || ADMIN_ROLES.has(viewer.role)) return true;
  return !!item?.userId && item.userId === viewer.id;
}
// The per-client filter for the event stream: task events pass when the task is visible; inbox items when addressed to the viewer.
export function sseFilter(viewer, { jobFor, projectFor = () => null } = {}) {
  if (!viewer || ADMIN_ROLES.has(viewer.role)) return () => true;
  const job = data => data?.ownerId !== undefined || data?.visibility !== undefined ? data : jobFor(data?.id);
  return event => {
    const { type, data } = event;
    if (type === 'task.updated' || type === 'task.state' || type === 'task.live' || type === 'task.event') { const j = job(data); return !j || canSeeJob(viewer, j, { project: projectFor(j.projectId) }); }
    if (type === 'thread.message') { if (!data?.jobId) return String(data?.threadId || '').endsWith(':' + viewer.id); const j = jobFor(data.jobId); return !j || canSeeJob(viewer, j, { project: projectFor(j.projectId) }); }
    if (type === 'notification.new') return notificationVisible(viewer, data);
    return true;
  };
}
