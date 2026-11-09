// Timer: Official (time_limit.minutes) / Custom / Off (elapsed only).
import { h, fmtClock } from './util.js';
import { sfx } from './fx.js';

export function timerPicker(officialMinutes, { suggestion = null, suggestionLabel = '' } = {}) {
  const wrap = h('fieldset', { class: 'timer-pick' }, h('legend', {}, 'Timer'));
  const custom = h('input', { type: 'number', min: '1', max: '600', step: '1', value: String(suggestion ?? officialMinutes ?? 30), 'aria-label': 'Custom minutes' });
  const mk = (val, label, extra, disabled) => h('label', { class: disabled ? 'disabled' : '' },
    h('input', { type: 'radio', name: 'timer', value: val, disabled }), ' ', label, extra || '');
  const off = mk('official', officialMinutes ? `Official (${officialMinutes} min)` : 'Official', officialMinutes ? '' : ' — not printed for this year', !officialMinutes);
  wrap.append(off, mk('custom', 'Custom ', custom), mk('off', 'Off (elapsed time only)'));
  if (suggestion != null) wrap.append(h('div', { class: 'muted small' }, suggestionLabel));
  const first = wrap.querySelector(officialMinutes ? 'input[value=official]' : (suggestion != null ? 'input[value=custom]' : 'input[value=off]'));
  first.checked = true;
  return {
    el: wrap,
    value() {
      const v = wrap.querySelector('input[name=timer]:checked').value;
      if (v === 'official') return { mode: 'official', minutes: officialMinutes };
      if (v === 'custom') return { mode: 'custom', minutes: Math.max(1, +custom.value || 1) };
      return { mode: 'off', minutes: null };
    },
  };
}

export class Clock {
  constructor({ minutes, onExpire, startedAt = Date.now(), pausedMs = 0 }) {
    this.minutes = minutes; this.onExpire = onExpire; this.start = startedAt;
    this.el = h('div', { class: 'clock', role: 'timer', 'aria-live': 'off' });
    this.tick = this.tick.bind(this);
    this.iv = setInterval(this.tick, 250);
    this.tick();
  }
  elapsed() { return (Date.now() - this.start) / 1000; }
  tick() {
    const e = this.elapsed();
    if (this.minutes) {
      const left = this.minutes * 60 - e;
      this.el.textContent = '⏱ ' + fmtClock(left) + ' left';
      this.el.classList.toggle('low', left < 300);
      for (const mark of [300, 60]) if (left <= mark && left > mark - 2 && !this['warned' + mark]) { this['warned' + mark] = true; sfx.warn(); }
      if (left <= 0) { this.stop(); this.onExpire?.(); }
    } else this.el.textContent = '⏱ ' + fmtClock(e) + ' elapsed';
  }
  stop() { clearInterval(this.iv); }
}
