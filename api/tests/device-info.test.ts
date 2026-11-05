/** Pure unit tests for the user-agent summary used by new-device sign-in alerts (no database). */
import { describe, it, expect } from 'vitest';
import { describeDevice } from '../src/lib/deviceInfo.js';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const APP_A = 'ServixAndroid/0.3.2 (Android 14; Samsung SM-A125F)';
const APP_B = 'ServixAndroid/0.3.2 (Android 13; Tecno KI5k)';
const OKHTTP = 'okhttp/4.12.0';

describe('describeDevice — native Servix app user agent', () => {
  it('recognises the app and keeps the phone model in the label', () => {
    const d = describeDevice(APP_A);
    expect(d.browser).toBe('Servix app');
    expect(d.os).toBe('Android');
    expect(d.label).toBe('Servix app on Android (Samsung SM-A125F)');
  });

  it('treats two different phones as different devices, the same phone as the same device', () => {
    expect(describeDevice(APP_A).key).not.toBe(describeDevice(APP_B).key);
    expect(describeDevice(APP_A).key).toBe(describeDevice('ServixAndroid/0.4.0 (Android 15; Samsung SM-A125F)').key);
    expect(describeDevice(APP_A).key).not.toBe(describeDevice(CHROME_ANDROID).key);
  });

  it('leaves browser user agents and the bare OkHttp default unchanged', () => {
    expect(describeDevice(CHROME_ANDROID).label).toBe('Chrome on Android');
    expect(describeDevice(OKHTTP).label).toBe('Unknown browser on Unknown device');
  });

  it('ignores malformed native strings instead of throwing', () => {
    expect(describeDevice('ServixAndroid/').browser).toBe('Unknown browser');
    expect(describeDevice('ServixAndroid/1.0 (Android 14; ' + 'x'.repeat(200) + ')').browser).not.toBe('Servix app');
  });
});
