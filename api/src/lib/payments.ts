/**
 * SERVIX payment provider abstraction (Phase D).
 *
 * The booking/ledger domain depends only on this interface. Two
 * implementations:
 *
 *  - PaystackProvider — real Paystack REST calls; active when
 *    PAYSTACK_SECRET_KEY is configured.
 *  - SandboxProvider — used when no key is configured (or PAYMENT_MODE=
 *    sandbox). It serves a clearly-labelled local checkout page whose
 *    "Pay" button emits a webhook through the SAME signature-verified,
 *    idempotent pipeline as production. Nothing can reach `captured`
 *    without a correctly-signed webhook in either mode — this is
 *    sandbox parity for real integration testing, never a faked
 *    client-side success.
 */
import { createHmac } from 'node:crypto';

export interface InitializeParams {
  reference: string;
  amountKobo: bigint;
  email: string;
  callbackUrl: string;
}

export interface InitializeResult {
  authorizationUrl: string;
  reference: string;
}

export interface VerifyResult {
  status: 'success' | 'failed' | 'pending';
  amountKobo: bigint;
  currency: string;
}

export interface TransferParams {
  reference: string;
  amountKobo: bigint;
  recipientName: string;
}

export interface TransferResult {
  status: 'success' | 'pending' | 'failed';
  providerRef: string;
}

export interface PaymentProvider {
  name: string;
  initialize(p: InitializeParams): Promise<InitializeResult>;
  verify(reference: string): Promise<VerifyResult>;
  transfer(p: TransferParams): Promise<TransferResult>;
}

export function webhookSecret(): string {
  return process.env.PAYSTACK_SECRET_KEY ?? 'sandbox-paystack-secret';
}

/** HMAC-SHA512 signature exactly as Paystack computes it. */
export function signWebhook(rawBody: string): string {
  return createHmac('sha512', webhookSecret()).update(rawBody).digest('hex');
}

/* ---------------- Paystack (production) ---------------- */

class PaystackProvider implements PaymentProvider {
  name = 'paystack';
  private base = 'https://api.paystack.co';
  private key = process.env.PAYSTACK_SECRET_KEY!;

  private async call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json()) as { status: boolean; message: string; data: Record<string, unknown> };
    if (!res.ok || !body.status) throw new Error(`Paystack: ${body.message ?? res.status}`);
    return body.data;
  }

  async initialize(p: InitializeParams): Promise<InitializeResult> {
    const data = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        reference: p.reference,
        amount: p.amountKobo.toString(),
        email: p.email,
        callback_url: p.callbackUrl,
        currency: 'NGN',
      }),
    });
    return { authorizationUrl: String(data.authorization_url), reference: p.reference };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const data = await this.call(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status === 'success' ? 'success' : data.status === 'failed' ? 'failed' : 'pending',
      amountKobo: BigInt(String(data.amount)),
      currency: String(data.currency ?? 'NGN'),
    };
  }

  async transfer(p: TransferParams): Promise<TransferResult> {
    // Full production flow: create a transfer recipient then a transfer.
    // Recipient management (bank details) is collected at onboarding; for
    // Phase D the recipient code is expected on the profile in production.
    const data = await this.call('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        reference: p.reference,
        amount: p.amountKobo.toString(),
        recipient: p.recipientName,
        reason: 'Servix payout',
      }),
    });
    return {
      status: data.status === 'success' || data.status === 'pending' ? 'success' : 'failed',
      providerRef: String(data.transfer_code ?? data.reference ?? p.reference),
    };
  }
}

/* ---------------- Sandbox (dev/CI parity) ---------------- */

class SandboxProvider implements PaymentProvider {
  name = 'paystack-sandbox';

  /** Registry of initialized checkouts so verify() has real state. */
  private static sessions = new Map<string, { amountKobo: bigint; settled: 'success' | 'failed' | null }>();

  static settle(reference: string, outcome: 'success' | 'failed'): boolean {
    const s = SandboxProvider.sessions.get(reference);
    if (!s || s.settled) return false;
    s.settled = outcome;
    return true;
  }

  async initialize(p: InitializeParams): Promise<InitializeResult> {
    SandboxProvider.sessions.set(p.reference, { amountKobo: p.amountKobo, settled: null });
    const base = process.env.API_BASE_URL ?? 'http://localhost:8080';
    return {
      authorizationUrl: `${base}/sandbox/checkout/${encodeURIComponent(p.reference)}`,
      reference: p.reference,
    };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const s = SandboxProvider.sessions.get(reference);
    if (!s || !s.settled) return { status: 'pending', amountKobo: 0n, currency: 'NGN' };
    return { status: s.settled, amountKobo: s.amountKobo, currency: 'NGN' };
  }

  async transfer(p: TransferParams): Promise<TransferResult> {
    return { status: 'success', providerRef: `sandbox-trf-${p.reference}` };
  }
}

export const SandboxControl = SandboxProvider;

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    provider =
      process.env.PAYSTACK_SECRET_KEY && process.env.PAYMENT_MODE !== 'sandbox'
        ? new PaystackProvider()
        : new SandboxProvider();
  }
  return provider;
}
