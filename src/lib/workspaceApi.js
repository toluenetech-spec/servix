import { authorizedFetch } from './authApi.js';
const BASE = `${import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''}/api/v1`;
export async function workspaceCall(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await authorizedFetch(`${BASE}${path}`, { method, headers: body === undefined ? {} : {'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data.error?.message || 'This request could not be completed. Please try again.');e.status=response.status;e.code=data.error?.code;throw e;}return data;
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
export const getPlan = () => workspaceCall('/pro/plan');
export const startPlanCheckout = plan => workspaceCall('/pro/plan/checkout', { plan });
export const verifyPlan = reference => workspaceCall('/pro/plan/verify', { reference });
export const getProAnalytics = (days = 30) => workspaceCall(`/pro/analytics?days=${days}`);
export const getAvailability = () => workspaceCall('/pro/availability');
export const saveAvailability = rules => workspaceCall('/pro/availability', { rules }, 'PUT');
export const addDayOff = (date, reason) => workspaceCall('/pro/availability/exceptions', { date, ...(reason ? { reason } : {}) });
export const removeDayOff = id => workspaceCall(`/pro/availability/exceptions/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const getProReviews = () => workspaceCall('/pro/reviews');
