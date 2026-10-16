import { describe, expect, it } from 'vitest';
import { detectInAppBrowser } from './inAppBrowser';

const UA = {
  fbAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A135M Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.109;]',
  fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 [FBAN/FBIOS;FBAV/450.0.0.30.109;FBBV/560000000;FBDV/iPhone14,5]',
  messenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 [FBAN/MessengerForiOS;FBAV/440.0.0.0.0]',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 Instagram 310.0.0.0.0 (iPhone14,5)',
  tiktok: 'Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 musical_ly_2023000000',
  webviewAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

describe('detectInAppBrowser', () => {
  it('reconoce el navegador integrado de Facebook, Messenger, Instagram y TikTok', () => {
    expect(detectInAppBrowser(UA.fbAndroid)).toBe('Facebook');
    expect(detectInAppBrowser(UA.fbIos)).toBe('Facebook');
    expect(detectInAppBrowser(UA.messenger)).toBe('Facebook');
    expect(detectInAppBrowser(UA.instagram)).toBe('Instagram');
    expect(detectInAppBrowser(UA.tiktok)).toBe('TikTok');
  });

  it('detecta un WebView genérico de Android', () => {
    expect(detectInAppBrowser(UA.webviewAndroid)).toBe('esta aplicación');
  });

  it('no marca como integrados a Chrome, Safari ni Chrome de iOS', () => {
    for (const ua of [UA.chromeAndroid, UA.safariIos, UA.chromeIos, UA.chromeDesktop]) expect(detectInAppBrowser(ua)).toBeNull();
  });

  it('tolera un user agent vacío', () => {
    expect(detectInAppBrowser('')).toBeNull();
  });
});
