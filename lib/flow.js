// The two ways to take part, one centred screen per step, with the steps as
// dots in the top bar.
//
// Just me (/contribute, /u/<id>/contribute, and /c/<id>/contribute for a
// colleague): paste one line, the assistant looks around, you check it and say
// yes, your results. One page: site.js moves between the steps as the
// assistant fetches the prompt (step 2) and its answer arrives (step 4).
// Without JavaScript the first step is all there is, and the assistant gives
// the link to the results at the end.
//
// With my company: name the page (/contribute?for=company), invite colleagues
// (/c/<id>/invite), reach five people (/c/<id> until then), results.
import { page, html, raw, SITE, companyName } from './html.js';
import { MIN_GROUP } from './stats.js';
import { icon } from './icons.js';

const ME_STEPS = ['Paste one line', 'It looks around', 'Check and say yes', 'Your results'];
const CO_STEPS = ['Name the page', 'Invite colleagues', `Reach ${MIN_GROUP} people`, 'Results open'];

const ICON = { left: icon('left', 18), arrow: icon('arrow') };

export const promptLine = (url) => `Fetch ${url} and follow the instructions in it.`;

// What the survey looks at, in the words of its "What will it look at?" tip.
const LOOKS_AT = 'Its last 30 days with you, with secrets masked: the habits that repeat and the models that did the work. Which coding tools are installed and open, and on how many days you used each, by name only. Never code, file names, paths or project names.';

// `steps`: names; `at`: the current step (1-based); `links[i]`: where dot i+1
// leads, if anywhere. `live`: the dots are buttons site.js moves between.
function stepDots(steps, at, { links = [], live = false } = {}) {
  return html`<nav class="tour-dots" aria-label="Steps">
    ${steps.map((name, i) => {
      const n = i + 1;
      const cls = n === at ? 'on' : n < at ? 'done' : '';
      const cur = raw(n === at ? ' aria-current="step"' : '');
      const inner = html`<i></i><span class="tip">${n} · ${name}</span>`;
      if (live) return html`<button type="button" class="tdot-nav fdot ${cls}" data-flow-dot="${n}" aria-label="Step ${n}: ${name}"${cur}${raw(n > at ? ' disabled' : '')}>${inner}</button>`;
      if (links[i] && n !== at) return html`<a class="tdot-nav fdot ${cls}" href="${links[i]}" aria-label="Step ${n}: ${name}">${inner}</a>`;
      return html`<span class="tdot-nav fdot ${cls}" tabindex="0" aria-label="Step ${n}: ${name}"${cur}>${inner}</span>`;
    })}
  </nav>`;
}

// Where an answer counts, at the foot of every step.
const countsIn = (company) => html`<p class="flow-foot"><span>Counts in</span>${company ? html`<span class="in-tag co">${companyName(company)}</span>` : ''}<span class="in-tag all">Everyone</span></p>`;

function frame({ title, dots, back = { href: '/#join', label: 'Back to the tour' }, alt = null, body, company = null, flow = null }) {
  return page({
    title,
    bare: true,
    noindex: true,
    styles: ['tour.css'],
    body: html`<div class="flow"${raw(flow ? ` data-flow="${flow}"` : '')}>
  <header class="tour-bar static">
    <a class="back" href="${back.href}">${raw(ICON.left)}${back.label}</a>
    ${dots ?? html`<span></span>`}
    <div class="tour-right">${alt ? html`<a class="quiet" href="${alt.href}">${alt.label}</a>` : ''}</div>
  </header>
  ${body}
  ${countsIn(company)}
</div>`,
  });
}

const tipChip = (label, tip) => html`<span class="chip ht" tabindex="0">${label}<span class="tip wide">${tip}</span></span>`;

// ---------- Just me ----------

// token: the wait's one-time code (site.js polls /api/wait/<token>).
// line: the sentence to paste. company: answering for a company page.
// profile: the owner of an existing page running it again. inviter: { name }
// of the person whose invitation link led here.
export function joinMePage({ token, line, company = null, profile = null, inviter = null }) {
  const from = company
    ? `People at ${companyName(company, { mid: true })} are comparing how they work with coding assistants. Results open at ${MIN_GROUP} people, and nobody there sees which answer is yours.`
    : inviter ? `${inviter.name || 'A friend'} took part and thinks you should too. ${SITE} shows how people work with coding assistants.`
      : profile ? 'Your new answer replaces the one on your page.' : '';
  return frame({
    title: company ? `Take part with ${companyName(company, { mid: true })}` : 'Take part',
    flow: 'me',
    company,
    back: company ? { href: '/', label: `What is ${SITE}?` } : { href: profile ? `/u/${profile.id}#join` : '/#join', label: 'Back to the tour' },
    alt: company || profile ? null : { href: '/contribute?for=company', label: 'With my company instead' },
    dots: stepDots(ME_STEPS, 1, { live: true }),
    body: html`<main class="flow-stage" data-wait="${token}">
  <section class="flow-step" data-flow-step="1">
    ${from ? html`<p class="flow-from">${from}</p>` : ''}
    <h1 class="flow-h">Paste this into your coding assistant</h1>
    <div class="flow-line"><code>${line}</code><button type="button" class="copy" data-copy="${line}">Copy</button></div>
    <span class="ask ht" tabindex="0">What will it look at?<span class="tip wide">${LOOKS_AT} <a href="/contribute.md">Read the prompt</a></span></span>
    <button type="button" class="quiet" data-flow-go="2" hidden data-js>I pasted it ${raw(ICON.arrow)}</button>
    <noscript><p class="flow-sub">When your assistant has sent its answer, open the link it gives you to see your results.</p></noscript>
  </section>
  <section class="flow-step" data-flow-step="2" hidden>
    <span class="pulse big" aria-hidden="true"></span>
    <h1 class="flow-h">Your assistant is looking around</h1>
    <p class="flow-sub">Usually two to four minutes. This page moves on by itself.</p>
    <div class="chips">
      ${tipChip('Your habits', 'It reads its last 30 days with you, secrets masked, and names the habits that repeat.')}
      ${tipChip('Your tools', 'Which coding agents, editors, terminals and multiplexers are installed and open now, and how often you use each: from the dates of their own session files and the first word of your shell history lines. Names from a fixed list only.')}
      ${tipChip('Your models', 'The models that did the work, and the model each coding agent’s settings name.')}
    </div>
    <button type="button" class="quiet" data-flow-go="3">It’s showing me what it found ${raw(ICON.arrow)}</button>
  </section>
  <section class="flow-step" data-flow-step="3" hidden>
    <h1 class="flow-h">Check it, then type yes</h1>
    <p class="flow-sub">Your assistant shows you exactly what it found. Nothing is sent until you say yes there. This page moves on when the answer arrives.</p>
    <div class="chips">
      ${tipChip('What is sent', 'Your habits, one sentence each. The tools you use and how often, and the models. Rough ranges, such as prompts a month.')}
      ${tipChip('What is never sent', 'Code, file names or paths. Project, client or people’s names. Links, passwords or keys.')}
    </div>
  </section>
  <section class="flow-step" data-flow-step="4" hidden>
    <h1 class="flow-h">${company ? `You’re on the radar, and in ${companyName(company, { mid: true })}` : 'You’re on the radar'}</h1>
    <p class="flow-sub">Your page shows your answer already. It joins everyone’s numbers once it has been reviewed.</p>
    <a class="go clay" href="/w/${token}" data-flow-results>See where you sit ${raw(ICON.arrow)}</a>
    <div class="flow-row">
      <span class="ask ht" tabindex="0" data-flow-keep hidden>Keep your page<span class="tip wide">Your editor’s code is <code data-flow-code></code>. It lets you rename, lock or delete your page from any browser. Store it somewhere safe: it is shown only once.</span></span>
      <a class="quiet" href="/contribute" data-flow-edit hidden>Name or lock your page</a>
      ${company ? '' : html`<a class="quiet" href="/contribute?for=company">Run it with my company too</a>`}
    </div>
  </section>
  <p class="flow-status" role="status" data-wait-text></p>
</main>`,
  });
}

// ---------- With my company ----------

const CO_ALT = { href: '/contribute', label: 'Just me instead' };

// Step 1: the page's name. Submitting it makes the page (POST /companies).
export function companyStartPage({ error = null }) {
  return frame({
    title: 'Take part with your company',
    alt: CO_ALT,
    company: {},
    dots: stepDots(CO_STEPS, 1),
    body: html`<main class="flow-stage">
  <form class="flow-step" method="post" action="/companies">
    <h1 class="flow-h"><label for="co">What should we call your company’s page?</label></h1>
    <input id="co" name="name" class="flow-field" type="text" maxlength="80" autocomplete="organization" placeholder="Example Inc">
    ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
    <span class="ask ht" tabindex="0">Who can see it?<span class="tip wide">Only people with the link: it is long, random and not listed anywhere. Results open at ${MIN_GROUP} people, so nobody can be picked out. You can add a password later.</span></span>
    <button type="submit" class="go">Continue ${raw(ICON.arrow)}</button>
  </form>
</main>`,
  });
}

const coLinks = (company) => [null, `/c/${company.id}/invite`, `/c/${company.id}`, null];

// Step 2, for the person who started the page: the link for colleagues, and
// their own line if they want to answer too (`token`, `line`).
export function companyInvitePage({ company, base, token, line, code = null }) {
  const link = `${base}/c/${company.id}/contribute`;
  return frame({
    title: `Invite colleagues · ${companyName(company)}`,
    company,
    back: { href: `/c/${company.id}`, label: companyName(company) },
    dots: stepDots(CO_STEPS, 2, { links: coLinks(company) }),
    body: html`<main class="flow-stage">
  <section class="flow-step">
    <h1 class="flow-h">Send this to your colleagues</h1>
    <div class="flow-line light"><code>${link}</code><button type="button" class="copy" data-copy="${link}">Copy link</button></div>
    <p class="flow-sub">Post it in your team channel. The page explains the survey and gives each of them a line to paste.${company.password_hash ? ' They also need the password you set.' : ''}</p>
    <div class="flow-line" id="own-line" hidden data-wait="${token}"><code>${line}</code><button type="button" class="copy" data-copy="${line}">Copy</button></div>
    <p class="flow-status" role="status" data-wait-text></p>
    <div class="flow-row">
      <button type="button" class="quiet" data-toggle aria-controls="own-line" aria-expanded="false">Add my own answer too</button>
      ${code ? html`<span class="ask ht" tabindex="0">Keep this page<span class="tip wide">Its editor’s code is <code>${code}</code>. It lets you rename, lock or delete the page from any browser. Store it somewhere safe: it is shown only for a few minutes.</span></span>` : ''}
      <a class="go" href="/c/${company.id}">Done ${raw(ICON.arrow)}</a>
    </div>
  </section>
</main>`,
  });
}

// Step 3: how many have answered, until there are enough. `seats`: one per
// answer so far, { status, mine }. `owner`: this browser started the page.
export function companyProgressPage({ company, base, seats, owner }) {
  // Reviewed answers first: they are the ones that count.
  const sorted = [...seats].sort((a, b) => (a.status === 'accepted' ? 0 : 1) - (b.status === 'accepted' ? 0 : 1));
  const answered = seats.length;
  const inReview = seats.filter((s) => s.status !== 'accepted').length;
  const shown = sorted.slice(0, Math.max(MIN_GROUP, answered));
  while (shown.length < MIN_GROUP) shown.push(null);
  const seatTip = (s) => (!s ? 'Waiting' : s.status === 'accepted' ? (s.mine ? 'Your answer' : 'A colleague’s answer') : s.mine ? 'Your answer, waiting for review' : 'A colleague’s answer, waiting for review');
  const link = `${base}/c/${company.id}/contribute`;
  const mineIn = seats.some((s) => s.mine);
  return frame({
    title: companyName(company),
    company,
    back: { href: '/', label: `What is ${SITE}?` },
    dots: owner ? stepDots(CO_STEPS, 3, { links: coLinks(company) }) : null,
    body: html`<main class="flow-stage">
  <section class="flow-step">
    <p class="flow-from">${companyName(company)}</p>
    <h1 class="flow-h">${answered} of ${MIN_GROUP} have answered</h1>
    <div class="seats" role="img" aria-label="${`${answered} of ${MIN_GROUP} people have answered${inReview ? `, ${inReview} waiting for review` : ''}`}">
      ${shown.map((s, i) => html`<span class="seat ht ${s ? (s.status === 'accepted' ? 'in' : 'review') : ''}" tabindex="0">${s?.mine ? 'You' : i + 1}<span class="tip">${seatTip(s)}</span></span>`)}
    </div>
    <p class="flow-sub">Results open at ${MIN_GROUP}, so nobody can be picked out.${inReview ? ` ${inReview === 1 ? 'One answer is' : `${inReview} answers are`} waiting for review: an answer counts once it has been reviewed.` : ''}</p>
    <div class="flow-row">
      ${owner ? html`<button type="button" class="quiet" data-copy="${link}">Copy the link for colleagues</button>` : ''}
      ${mineIn ? '' : html`<a class="go" href="/c/${company.id}/contribute">Add your answer ${raw(ICON.arrow)}</a>`}
    </div>
    ${owner ? html`<p class="muted small"><a href="/c/${company.id}/edit">Edit or delete this page</a></p>` : ''}
  </section>
</main>`,
  });
}

// Step 4, once: the results are open. `own`: this browser's page, if it has one.
export function companyOpenPage({ company, own = null }) {
  return frame({
    title: companyName(company),
    company,
    back: { href: `/c/${company.id}`, label: companyName(company) },
    dots: stepDots(CO_STEPS, 4, { links: coLinks(company) }),
    body: html`<main class="flow-stage">
  <section class="flow-step">
    <h1 class="flow-h">${companyName(company)}’s results are open</h1>
    <p class="flow-sub">Every slide in the tour now has a view for ${companyName(company, { mid: true })}${own ? ', and one for you' : ''}.</p>
    <a class="go clay" href="/c/${company.id}#habits">See ${companyName(company, { mid: true })} next to everyone ${raw(ICON.arrow)}</a>
    ${own ? html`<a class="quiet" href="/u/${own}#habits">See my own results</a>` : ''}
  </section>
</main>`,
  });
}
