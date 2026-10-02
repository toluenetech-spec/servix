/**
 * Identity verification (KYC) client.
 *
 * Files go straight to a private bucket key via the API (never a public URL).
 * The browser checks type by MAGIC BYTES (not just the extension) and the
 * server repeats the check, so a renamed file is refused on both sides.
 */
import { authorizedFetch } from './authApi.js';
import { prepareImage } from './uploadApi.js';
import { workspaceCall } from './workspaceApi.js';

const V1 = `${import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''}/api/v1`;

export const KYC_MAX_BYTES = 5 * 1024 * 1024;
export const KYC_DOCUMENT_TYPES = [
  { value: 'nin_slip', label: 'NIN slip', hint: 'Photo or PDF of your National Identification Number slip.' },
  { value: 'international_passport', label: 'International passport', hint: 'Photo of the data page.' },
  { value: 'voters_card', label: "Voter's card (PVC)", hint: 'Photo of the front of the card.' },
  { value: 'drivers_license', label: "Driver's licence", hint: 'Photo of the front of the licence.' },
];
export const KYC_SELFIE_INSTRUCTION = 'Hold a paper with today\u2019s date and your full name clearly visible.';
export const KYC_CONSENT_TEXT = 'I confirm these documents are mine and consent to identity processing under NDPA regulations.';

export const getKycStatus = () => workspaceCall('/kyc/status');
export const submitKyc = (body) => workspaceCall('/kyc/submit', body);

/** Reads the first bytes and returns the real type, or null. */
export async function sniffFile(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d) return 'application/pdf';
  return null;
}

/**
 * Validates and uploads one part. Images are downscaled client-side when
 * huge (phone cameras often produce 8–12 MB photos) so people are not
 * blocked by the 5 MB cap; PDFs are sent untouched.
 */
export async function uploadKycFile(rawFile, part, documentType) {
  if (!rawFile) throw Object.assign(new Error('Choose a file first.'), { status: 422 });
  let actual = await sniffFile(rawFile);
  if (!actual) throw Object.assign(new Error('Only JPEG or PNG photos are accepted' + (part === 'document' && documentType === 'nin_slip' ? ' (or a PDF for an NIN slip).' : '.')), { status: 422 });
  if (actual === 'application/pdf') {
    if (part !== 'document') throw Object.assign(new Error('Your selfie must be a JPEG or PNG photo.'), { status: 422 });
    if (documentType !== 'nin_slip') throw Object.assign(new Error('PDF is only accepted for an NIN slip. Take a photo of this document instead.'), { status: 422 });
  }
  let file = rawFile;
  if (actual !== 'application/pdf') {
    file = await prepareImage(rawFile, { maxEdge: 2200 });
    actual = (await sniffFile(file)) || actual;
  }
  if (file.size > KYC_MAX_BYTES) throw Object.assign(new Error('That file is larger than 5 MB. Please use a smaller photo or PDF.'), { status: 422 });
  const params = new URLSearchParams({ part, fileName: file.name || part });
  if (documentType) params.set('documentType', documentType);
  const res = await authorizedFetch(`${V1}/kyc/upload?${params}`, { method: 'POST', headers: { 'Content-Type': actual }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || 'The upload failed. Please try again.');
    err.status = res.status; err.code = data.error?.code; throw err;
  }
  return { ...data, previewUrl: URL.createObjectURL(file), fileName: rawFile.name, isPdf: actual === 'application/pdf' };
}
