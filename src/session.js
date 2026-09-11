// Who is looking at the page, and in which mode. serve.mjs injects window.__OFFICE_BOOT__ before the bundle runs:
// mode ('single' | 'hosted'), the signed-in user (hosted), the office limits and whether the models are the platform's.
export const BOOT = (typeof window !== 'undefined' && window.__OFFICE_BOOT__) || {};
export const HOSTED = BOOT.mode === 'hosted';
export const USER = BOOT.user || null;
export const ROLE = USER?.role || (HOSTED ? 'member' : 'owner');
export const LIMITS = BOOT.limits || { maxTeams: 10, maxMembersPerTeam: 7 };
export const MANAGED_MODELS = !!BOOT.managedModels;
/** The single owner, or a hosted office's owner or admin: may change teams, connectors, the Vault, office settings, and read the audit log. */
export const isOfficeAdmin = () => !HOSTED || ['owner', 'admin'].includes(ROLE);
export const canOpenAreaPlatform = id => id === 'admin';
/** A platform session: the platform administrator's own sign-in, which belongs to no office and sees the Platform page only. */
export const PLATFORM_ONLY = !!USER?.platform;
export const isPlatformAdmin = () => PLATFORM_ONLY;
/** Areas a plain member never sees. */
export const ADMIN_AREAS = new Set(['tools', 'vault', 'office', 'audit', 'users', 'models']);
export const canOpenArea = id => PLATFORM_ONLY ? id === 'admin' : id === 'admin' ? isPlatformAdmin() : id === 'models' ? !MANAGED_MODELS && isOfficeAdmin() : id === 'users' ? HOSTED && isOfficeAdmin() : !ADMIN_AREAS.has(id) || isOfficeAdmin();
