/**
 * New-device sign-in alerts.
 *  - Every completed sign-in (password, Google, passkey/authenticator flow) creates a refresh-token family;
 *    `refresh_tokens.user_agent` is already stored per session, so no new table is needed.
 *  - A sign-in counts as a *new device* when the account already had at least one earlier session and none
 *    of them came from the same browser + operating system. The very first session of a brand-new account
 *    never alerts (the person is reading the welcome / verification email instead).
 *  - Alert = one email ("New sign-in to your Servix account") + one in-app notification. Both say what we
 *    know (browser, device, approximate time, network address) and how to lock the account down. Nothing in
 *    the alert is secret and nothing in it can be used to sign in.
 *  - Never blocks or fails the sign-in: any error here is logged and swallowed.
 *  - Set LOGIN_ALERTS=false to switch the emails off (in-app notification still written).
 */
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';
import { enqueueMail } from './jobs.js';
import { newDeviceSignInMail } from './mailer.js';
import { notify } from './notifications.js';
import { audit } from './audit.js';
import { describeDevice, clientAddress, type DeviceInfo } from './deviceInfo.js';
export { describeDevice, clientAddress } from './deviceInfo.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const loginAlertsEnabled = (): boolean => process.env.LOGIN_ALERTS !== 'false';

/**
 * Decide whether this freshly created session is from a device the account has not used before and, if so,
 * send the alert. `sessionId` is the refresh token row just created (excluded from the "earlier sessions").
 */
export async function alertIfNewDevice(
  db: Db,
  input: { userId: string; sessionId: string; userAgent?: string; ip?: string | null; log?: { error: (obj: unknown, msg?: string) => void } },
): Promise<{ alerted: boolean; device: DeviceInfo }> {
  const device = describeDevice(input.userAgent);
  try {
    const earlier = await db.refreshToken.findMany({
      where: { userId: input.userId, id: { not: input.sessionId } },
      select: { userAgent: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    if (earlier.length === 0) return { alerted: false, device }; // first session ever (registration)
    const seen = earlier.some((t) => describeDevice(t.userAgent).key === device.key);
    if (seen) return { alerted: false, device };

    const user = await db.user.findUnique({ where: { id: input.userId }, select: { email: true, fullName: true, deletedAt: true } });
    if (!user || user.deletedAt) return { alerted: false, device };
    const when = new Date();
    const whenLabel = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(when) + ' (Lagos time)';

    await notify(db, {
      userId: input.userId,
      type: 'security.new_device',
      title: `New sign-in from ${device.label}`,
      body: `Your account was signed in from ${device.label} on ${whenLabel}. If this was you, nothing to do. If not, change your password now — that signs every device out.`,
      link: '/dashboard/settings',
    });
    await audit(db, { actorId: input.userId, action: 'security.new_device', entity: 'user', entityId: input.userId, ip: input.ip ?? undefined, data: { device: device.label } });
    if (loginAlertsEnabled()) {
      await enqueueMail(newDeviceSignInMail(user.email, { name: user.fullName, device: device.label, when: whenLabel, ip: input.ip ?? null }), `new-device-${input.sessionId}`);
    }
    return { alerted: true, device };
  } catch (err) {
    input.log?.error(err, 'new-device alert failed (sign-in unaffected)');
    return { alerted: false, device };
  }
}
