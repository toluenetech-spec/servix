import { authorizedFetch } from './authApi.js';
const BASE = `${import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''}/api/v1`;
export async function workspaceCall(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await authorizedFetch(`${BASE}${path}`, { method, headers: body === undefined ? {} : {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data.error?.message || 'This request could not be completed. Please try again.');e.status=response.status;e.code=data.error?.code;e.meta=data.error?.meta;if(data.error?.errors)e.errors=data.error.errors;throw e;}return data;
}
export const getPayments = () => workspaceCall('/account/payments');
export const getSecuritySummary = () => workspaceCall('/account/security-summary');
export const updateAccount = data => workspaceCall('/account/profile',data,'PATCH');
export const communityConfig = () => workspaceCall('/community/config');
export const getConnections = () => workspaceCall('/community/connections');
export const connectProfessional = profileSlug => workspaceCall('/community/connections',{profileSlug});
export const connectionAction = (id,action) => workspaceCall(`/community/connections/${encodeURIComponent(id)}/action`,{action});
export const getThreads = () => workspaceCall('/community/threads');
export const openThread = body => workspaceCall('/community/threads',body);
export const getMessages = (id,before) => workspaceCall(`/community/threads/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export const sendMessage = (id,body,clientId) => workspaceCall(`/community/threads/${encodeURIComponent(id)}/messages`,{body,clientId});
export const markRead = id => workspaceCall(`/community/threads/${encodeURIComponent(id)}/read`,{});
export const blockThread = id => workspaceCall(`/community/threads/${encodeURIComponent(id)}/block`,{});
/* notifications */
export const getNotifications = before => workspaceCall(`/account/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export const getUnreadCount = () => workspaceCall('/account/notifications/unread');
export const markNotificationsRead = ids => workspaceCall('/account/notifications/read', ids ? { ids } : { all: true });
/* saved professionals + customer insights */
export const getSaved = () => workspaceCall('/account/saved');
export const saveProfessional = profileSlug => workspaceCall('/account/saved', { profileSlug });
export const unsaveProfessional = slug => workspaceCall(`/account/saved/${encodeURIComponent(slug)}`, undefined, 'DELETE');
export const getInsights = () => workspaceCall('/account/insights');
/* professional workspace */
/* plans & entitlements (every account; the old /pro/plan* routes remain as aliases) */
export const getPlan = () => workspaceCall('/billing/plan');
export const startPlanCheckout = plan => workspaceCall('/billing/checkout', { plan });
export const verifyPlan = reference => workspaceCall('/billing/verify', { reference });
export const downgradePlan = () => workspaceCall('/billing/downgrade', { confirm: true });
export const getEntitlements = () => workspaceCall('/me/entitlements');
/* saved searches, exports, profile versions */
export const getSavedSearches = () => workspaceCall('/account/saved-searches');
export const saveSearch = (kind, name, params) => workspaceCall('/account/saved-searches', { kind, name, params });
export const deleteSavedSearch = id => workspaceCall(`/account/saved-searches/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const getExportMeter = () => workspaceCall('/exports');
export const getProfileVersions = () => workspaceCall('/pro/profile/versions');
export const saveProfileVersion = name => workspaceCall('/pro/profile/versions', { name });
export const restoreProfileVersion = id => workspaceCall(`/pro/profile/versions/${encodeURIComponent(id)}/restore`, {});
export const deleteProfileVersion = id => workspaceCall(`/pro/profile/versions/${encodeURIComponent(id)}`, undefined, 'DELETE');
/* team workspace */
export const getTeam = () => workspaceCall('/team');
export const createTeam = name => workspaceCall('/team', { name });
export const renameTeam = name => workspaceCall('/team', { name }, 'PATCH');
export const inviteTeamMember = (email, role = 'member') => workspaceCall('/team/invites', { email, role });
export const previewTeamInvite = token => workspaceCall(`/team/invites/preview?token=${encodeURIComponent(token)}`);
export const acceptTeamInvite = token => workspaceCall('/team/invites/accept', { token });
export const updateTeamMember = (id, patch) => workspaceCall(`/team/members/${encodeURIComponent(id)}`, patch, 'PATCH');
export const removeTeamMember = id => workspaceCall(`/team/members/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const leaveTeam = () => workspaceCall('/team/leave', {});
export const getTeamActivity = (days = 30) => workspaceCall(`/team/activity?days=${days}`);
export const getTeamAiUsage = () => workspaceCall('/team/ai-usage');
export const getTeamWork = () => workspaceCall('/team/work');
export const getTeamAudit = () => workspaceCall('/team/audit');
export const getProAnalytics = (days = 30) => workspaceCall(`/pro/analytics?days=${days}`);
export const getAvailability = () => workspaceCall('/pro/availability');
export const saveAvailability = rules => workspaceCall('/pro/availability', { rules }, 'PUT');
export const addDayOff = (date, reason) => workspaceCall('/pro/availability/exceptions', { date, ...(reason ? { reason } : {}) });
export const removeDayOff = id => workspaceCall(`/pro/availability/exceptions/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const getProReviews = () => workspaceCall('/pro/reviews');
