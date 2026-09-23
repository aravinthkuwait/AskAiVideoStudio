import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { setTitle } from '../app.js';

const PLANS = {
  editor: 'Multi-track, non-destructive timeline: video, audio, text, overlay, logo, subtitle and effect tracks; cut, trim, split, crop, speed, keyframes and transitions.',
  audio: 'Voice, narration, BGM, SFX and ambient tracks with per-clip volume, fades, normalise and auto-ducking.',
  subtitles: 'Subtitle tracks with timing, styles and reusable subtitle presets.',
  brand: 'Reusable Brand Kits: channel name, logo, watermark position/opacity, intro/outro, default fonts and styles.',
  thumbnail: 'YouTube 16:9 thumbnails from the best video frame or your own images, with title text, logo and templates. JPG/PNG export.',
  exports: 'FFmpeg MP4 (H.264) export at 1080p, 720p or custom sizes in 16:9, 9:16 and 1:1.',
};

export function renderComingSoon(main, nav) {
  setTitle(nav.label);
  mount(main, h('div', { class: 'card soon-page' },
    h('div', { class: 'brand-mark', style: { width: '56px', height: '56px', margin: '0 auto 16px', borderRadius: '16px' } }, icon(nav.icon)),
    h('span', { class: 'tag' }, 'COMING SOON'),
    h('h1', null, nav.label),
    h('p', { class: 'muted', style: { maxWidth: '560px', margin: '0 auto' } }, PLANS[nav.key] || 'Planned for a future phase.'),
    h('p', { class: 'faint', style: { marginTop: '18px', fontSize: '13px' } }, 'This module is not available yet. Nothing on this page is functional.')));
}
