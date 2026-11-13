// Headline Breakdown: marks the words in a headline that steer the reader, scores the headline's lean,
// heat and certainty, and can rewrite it in neutral words. Runs entirely in the browser.
//
// Two layers:
//  1. The site's word list (scanner.js): left-coded, right-coded and loaded terms.
//  2. Headline techniques: attitude verbs ("slams", "claims"), heat words ("shocking"), unconfirmed
//     language ("reportedly"), SHOUTING, and quoted words.
// These are signals, not verdicts: a strong word can be the accurate one.

(function () {
  const CATS = {
    left:    { label: 'Left-coded',      icon: '◀', tip: 'Wording favoured by the left.' },
    right:   { label: 'Right-coded',     icon: '▶', tip: 'Wording favoured by the right.' },
    loaded:  { label: 'Loaded',          icon: '⚠', tip: 'Charged wording either side might use.' },
    tone:    { label: 'Attitude verb',   icon: '🎭', tip: 'A verb that tells you how to feel about the speaker.' },
    heat:    { label: 'Heat word',       icon: '🔥', tip: 'An emotional or dramatic word.' },
    hedge:   { label: 'Unconfirmed',     icon: '❓', tip: 'Not established as fact yet.' },
    shout:   { label: 'Shouting',        icon: '📢', tip: 'ALL CAPS grabs attention.' },
    quoted:  { label: 'Quoted words',    icon: '❝',  tip: "Someone else's words, or scare quotes that signal doubt." },
  };

  // Attitude verbs → a neutral verb. "claims" casts doubt where "says" doesn't; "slams" picks a winner.
  const TONE = [
    [/\b(slams?|slammed|blasts?|blasted|rips?|ripped|torches?|torched|lambasts?|lambasted|skewers?|skewered|trashes|trashed|eviscerates?|destroys?|demolishes?)\b/gi, 'criticizes', 'Turns criticism into a fight with a winner.'],
    [/\b(lashes|lashed) out( at)?\b/gi, 'criticizes', 'Paints the speaker as angry or out of control.'],
    [/\b(hits|fires|fired|hit) back( at)?\b/gi, 'responds to', 'Frames a reply as a counter-punch.'],
    [/\b(claims?|claimed)\b/gi, 'says', '"Claims" quietly suggests it might not be true. "Says" is neutral.'],
    [/\b(admits?|admitted|concedes?|conceded)\b/gi, 'says', '"Admits" implies they were hiding something.'],
    [/\b(touts?|touted|boasts?|boasted|brags?|bragged)\b/gi, 'highlights', 'Makes the speaker sound self-serving.'],
    [/\b(pounces?|pounced)( on)?\b/gi, 'responds to', 'Makes a response sound opportunistic.'],
    [/\b(caves?|caved)\b/gi, 'agrees', 'Frames a decision as weakness.'],
    [/\b(mocks?|mocked|taunts?|taunted|sneers?|sneered)\b/gi, 'criticizes', 'Makes the speaker sound petty.'],
    [/\b(dodges?|dodged|ducks?|ducked)\b/gi, 'does not answer', 'Implies evasion.'],
    [/\b(scrambles?|scrambled)\b/gi, 'moves', 'Suggests panic.'],
  ];
  // Heat words. Neutral version: drop it (''), or a calmer word.
  const HEAT = [
    [/\b(shocking|stunning|chilling|horrific|horrifying|terrifying|harrowing|gruesome|disturbing)\b/gi, ''],
    [/\b(devastating|catastrophic|disastrous)\b/gi, 'serious'],
    [/\b(brutal|savage|barbaric|vicious)\b/gi, ''],
    [/\b(slaughter(ed|s)?|bloodbath|carnage)\b/gi, 'killing'],
    [/\b(bombshell|explosive)\b/gi, 'new'],
    [/\b(outrage[ds]?|fury|furious|uproar|firestorm|meltdown)\b/gi, 'criticism'],
    [/\b(chaos|chaotic|mayhem|nightmare|catastrophe|disaster)\b/gi, 'disruption'],
    [/\b(humiliat\w+|disgrace\w*|shameful|vile|evil|heroic|epic)\b/gi, ''],
    [/\b(crush(es|ed|ing)?|obliterat\w+|annihilat\w+)\b/gi, 'defeats'],
    [/\b(historic|unprecedented|dramatic|massive)\b/gi, ''],
    [/\btotal victory\b/gi, 'victory'],
  ];
  const HEDGE = /\b(reportedly|allegedly|alleged|rumou?red|could|may|might|possible|possibly|apparent(ly)?|sources say|sources|report:|reports? says?|appears? to|seems? to)\b/gi;
  const SHOUT_WORDS = /^(BREAKING|EXCLUSIVE|WATCH|URGENT|ALERT|SHOCKING|MUST|NEVER|NOT|NO|ALL|END|TOTAL|HUGE|BOOM|WOW|YES|LIVE|UPDATE|JUST|NOW|EVER|ONLY|FINALLY)$/;
  const ACRONYMS = new Set(['IDF', 'US', 'USA', 'UN', 'UK', 'EU', 'NATO', 'IRGC', 'GOP', 'CNN', 'BBC', 'NPR', 'NYC', 'FBI', 'CIA', 'DC', 'AI', 'TV', 'PM', 'MK', 'MKS', 'PA', 'UAE', 'ICC', 'ICJ', 'UNRWA', 'NGO', 'OSINT', 'MAGA', 'COP31', 'CEO', 'II', 'III', 'IV']);

  // Every highlighted span in a headline, without overlaps (the word list wins over the extra layers).
  function spans(title) {
    const out = [];
    const add = (start, end, cat, extra = {}) => {
      if (end <= start || out.some(s => start < s.end && end > s.start)) return;
      out.push({ start, end, text: title.slice(start, end), cat, ...extra });
    };
    const scan = window.BiasScanner?.scanText([title]);
    for (const f of scan?.findings || []) {
      if (f.pi !== 0) continue;
      const at = title.indexOf(f.text);
      if (at < 0) continue;
      add(at, at + f.text.length, f.quoted ? 'quoted' : f.side, { note: f.note, neutral: /^(say|describe|name|attack \/)/i.test(f.neutral) ? null : f.neutral.split(' / ')[0].replace(/\s*\(.*\)$/, ''), how: f.neutral });
    }
    for (const [re, neutral, note] of TONE) for (const m of title.matchAll(re)) add(m.index, m.index + m[0].length, 'tone', { note, neutral });
    for (const [re, neutral] of HEAT) for (const m of title.matchAll(re)) add(m.index, m.index + m[0].length, 'heat', { note: 'Adds emotion; the facts work without it.', neutral });
    for (const m of title.matchAll(HEDGE)) add(m.index, m.index + m[0].length, 'hedge', { note: 'Signals this is not confirmed. Fine when true, but easy to overlook.' });
    // Shouting: attention words in capitals (BREAKING, EXCLUSIVE…), or long all-caps words that aren't abbreviations.
    for (const m of title.matchAll(/\b[A-Z]{3,}\b/g)) if (!ACRONYMS.has(m[0]) && (SHOUT_WORDS.test(m[0]) || m[0].length >= 7)) add(m.index, m.index + m[0].length, 'shout', { note: 'Capital letters raise the volume, not the facts.', neutral: m[0].charAt(0) + m[0].slice(1).toLowerCase() });
    // Quoted words: "…", “…”, ‘…’ or '…'. An apostrophe inside ("don't") doesn't end the quote.
    const QUOTES = /["“]([^"“”]{2,80})["”]|(?<!\w)[‘']((?:[^‘’']|[’'](?=\w)){2,80})[’'](?!\w)/g;
    for (const m of title.matchAll(QUOTES)) {
      add(m.index, m.index + m[0].length, 'quoted', { note: "Quote marks show these are someone else's words. Around a single word they can also signal doubt (scare quotes)." });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  function analyze(title) {
    const s = spans(title);
    const n = cat => s.filter(x => x.cat === cat).length;
    const left = n('left'), right = n('right');
    const lean = left + right ? (right - left) / (left + right) : 0;
    const heatScore = n('heat') * 1.5 + n('tone') + n('loaded') * 1.5 + n('shout') * 1.5 + (left + right) * 0.5 + (/!/.test(title) ? 1 : 0);
    const heat = heatScore >= 4 ? 3 : heatScore >= 2 ? 2 : heatScore >= 1 ? 1 : 0;
    return { spans: s, lean, left, right, heat, hedges: n('hedge'), quotes: n('quoted') };
  }

  const HEAT_LEVELS = [
    { icon: '🧊', label: 'Cool', note: 'Straight, plain wording.' },
    { icon: '🌤', label: 'Mild', note: 'A touch of attitude.' },
    { icon: '🌶', label: 'Spicy', note: 'Several words push a reaction.' },
    { icon: '🔥', label: 'Hot', note: 'Written to make you feel something.' },
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The headline with highlights; with neutral=true, the rewritten version (struck words → neutral words).
  function marked(title, an, neutral = false, interactive = true) {
    let html = '', at = 0;
    an.spans.forEach((sp, i) => {
      html += esc(title.slice(at, sp.start));
      if (neutral && sp.neutral != null) {
        const repl = sp.neutral && /^[A-Z]/.test(sp.text) ? sp.neutral[0].toUpperCase() + sp.neutral.slice(1) : sp.neutral;
        html += `<del class="hb-old">${esc(sp.text)}</del>${repl ? `<ins class="hb-new">${esc(repl)}</ins>` : ''}`;
      } else {
        html += interactive
          ? `<mark class="hb-m hb-${sp.cat}" data-hb="${i}" tabindex="0" role="button" aria-label="${esc(CATS[sp.cat].label)}: ${esc(sp.text)}" style="--d:${i * 0.12}s">${esc(sp.text)}</mark>`
          : `<mark class="hb-m hb-${sp.cat}" title="${esc(CATS[sp.cat].label)}: ${esc(sp.note || CATS[sp.cat].tip)}" style="--d:${i * 0.12}s">${esc(sp.text)}</mark>`;
      }
      at = sp.end;
    });
    return html + esc(title.slice(at));
  }

  function meter(an) {
    const x = 50 + an.lean * 42; // 8%..92%
    const label = !an.left && !an.right ? 'No side-coded words' : Math.abs(an.lean) < 0.34 ? 'Mixed signals' : an.lean < 0 ? 'Leans left' : 'Leans right';
    return `<div class="hb-meter" title="Based on left- and right-coded words in the headline">
      <div class="hb-track"><span class="hb-needle" style="--x:${x}%"></span></div>
      <div class="hb-scale"><span>Left</span><span>Neutral</span><span>Right</span></div>
      <div class="hb-meter-l">${label}</div></div>`;
  }

  function render(a, others = []) {
    const an = analyze(a.title);
    const h = HEAT_LEVELS[an.heat];
    const counts = Object.keys(CATS).map(c => [c, an.spans.filter(s => s.cat === c).length]).filter(([, n]) => n);
    const canRewrite = an.spans.some(s => s.neutral != null);
    const all = [{ ...a, an }, ...others.map(o => ({ ...o, an: analyze(o.title) }))];
    const hottest = all.length > 1 ? all.reduce((x, y) => (y.an.heat > x.an.heat ? y : x)) : null;
    const calmest = all.length > 1 ? all.reduce((x, y) => (y.an.heat < x.an.heat ? y : x)) : null;
    return `<section class="hb" data-hb-for="${esc(a.link)}">
      <div class="hb-head"><span class="hb-title">Headline breakdown</span><span class="hb-sub">${an.spans.length ? `${an.spans.length} word${an.spans.length === 1 ? '' : 's'} flagged. Tap one.` : 'Nothing flagged: plain wording.'}</span></div>
      <div class="hb-cards">
        <div class="hb-card">${meter(an)}</div>
        <div class="hb-card hb-heat"><div class="hb-big">${h.icon}</div><div><b>${h.label}</b><small>${h.note}</small></div></div>
        <div class="hb-card hb-cert"><div class="hb-big">${an.hedges ? '❓' : '✅'}</div><div><b>${an.hedges ? 'Unconfirmed' : 'Stated as fact'}</b><small>${an.hedges ? 'Uses hedging words.' : 'No hedging words.'}</small></div></div>
      </div>
      ${counts.length ? `<div class="hb-legend">${counts.map(([c, n]) => `<span class="hb-chip hb-${c}" title="${esc(CATS[c].tip)}">${CATS[c].icon} ${CATS[c].label}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}</div>` : ''}
      <div class="hb-explain" aria-live="polite">${an.spans.length ? '<span class="hb-hint">Tap a highlighted word in the headline above to see why.</span>' : ''}</div>
      ${canRewrite ? `<div class="hb-rewrite"><button class="hb-btn" data-hb-neutral>✨ Neutralize it</button><div class="hb-neutral" hidden></div></div>` : ''}
      ${others.length ? `<div class="hb-face"><div class="hb-face-h">Headline face-off <small>Same story, ${all.length} outlets</small></div>
        ${all.map(o => `<div class="hb-row${o.link === a.link ? ' here' : ''}">
          <div class="hb-row-m"><span class="lean ${String(o.lean || '').replace(' ', '-')}">${esc(o.lean || 'unrated')}</span><b>${esc(o.source)}</b>
            <span class="hb-row-heat" title="${HEAT_LEVELS[o.an.heat].label}">${HEAT_LEVELS[o.an.heat].icon}</span>
            ${o === hottest && hottest.an.heat > calmest.an.heat ? '<span class="hb-badge hot">Hottest</span>' : ''}${o === calmest && hottest.an.heat > calmest.an.heat ? '<span class="hb-badge cool">Calmest</span>' : ''}</div>
          <div class="hb-row-t">${marked(o.title, o.an, false, false)}</div></div>`).join('')}</div>` : ''}
    </section>`;
  }

  // Wire up a rendered breakdown: highlights in the headline element, explanations, neutral rewrite.
  function attach(root, a, headlineEl) {
    const an = analyze(a.title);
    if (headlineEl) headlineEl.innerHTML = marked(a.title, an);
    const box = root.querySelector('.hb');
    if (!box) return;
    const explain = box.querySelector('.hb-explain');
    const show = i => {
      const sp = an.spans[i];
      if (!sp) return;
      root.querySelectorAll('.hb-m.on').forEach(m => m.classList.remove('on'));
      root.querySelectorAll(`[data-hb="${i}"]`).forEach(m => m.classList.add('on'));
      explain.innerHTML = `<div class="hb-x hb-${sp.cat}"><div class="hb-x-h"><span class="hb-chip hb-${sp.cat}">${CATS[sp.cat].icon} ${CATS[sp.cat].label}</span><q>${esc(sp.text)}</q></div>
        <p>${esc(sp.note || CATS[sp.cat].tip)}</p>
        ${sp.neutral ? `<p class="hb-x-n">Neutral: <b>${esc(sp.neutral)}</b></p>` : sp.neutral === '' ? '<p class="hb-x-n">Neutral: <b>leave it out</b></p>' : sp.how ? `<p class="hb-x-n">Neutral: <b>${esc(sp.how)}</b></p>` : ''}</div>`;
    };
    headlineEl?.addEventListener('click', e => { const m = e.target.closest('.hb-m'); if (m) show(+m.dataset.hb); });
    headlineEl?.addEventListener('keydown', e => { const m = e.target.closest('.hb-m'); if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(+m.dataset.hb); } });
    const btn = box.querySelector('[data-hb-neutral]');
    btn?.addEventListener('click', () => {
      const out = box.querySelector('.hb-neutral');
      const on = out.hidden;
      out.hidden = !on;
      btn.textContent = on ? '↩ Show original' : '✨ Neutralize it';
      if (on) out.innerHTML = `<small>Neutral rewrite (word list, not AI)</small><div class="hb-neutral-t">${marked(a.title, an, true)}</div>`;
    });
  }

  window.HeadlineBreakdown = { analyze, render, attach, CATS };
})();
