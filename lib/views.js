// The pages. Each function returns a full HTML document.
import { page, html, raw, MADE_BY, formatNumber, SITE } from './html.js';
import { MIN_GROUP } from './stats.js';

const promptLine = (url) => `Fetch ${url} and follow the instructions in it.`;
// A company's name is optional: a page without one shows as "This company".
export const companyLabel = (c) => c.name || 'This company';

// The header every slide after the first one starts with: a small label, the
// title and one line under it, always in the same place and the same size.
// `aside` sits on the right of it (a legend, a switch).
// `level: 1` makes the title the page's h1 (pages that are not a deck).
const slideHead = ({ eyebrow, cls = '', title, sub, aside = '', level = 2 }) => html`<header class="slide-head${aside ? ' row' : ''}">
      <div>
        <p class="eyebrow ${cls}">${eyebrow}</p>
        ${level === 1 ? html`<h1>${title}</h1>` : html`<h2>${title}</h2>`}
        <p class="sub">${sub}</p>
      </div>${aside}
    </header>`;

// A page's editor's code, shown to the browser that was just given it.
const CODE_ADVICE = 'Store it somewhere safe, such as a password manager. It is the only way to edit or delete this page from another browser, and it is shown only for the next few minutes.';
const codeBanner = (code) => (code ? html`<div class="banner code-banner">
      <span><b>Your editor’s code:</b> <code>${code}</code><br>${CODE_ADVICE}</span>
      <button type="button" class="btn outline small" data-copy="${code}">Copy the code</button>
    </div>` : '');

const BACK = html`<a class="page-action btn dark big" href="/">${raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>')} Back to the presentation</a>`;


// ---------- contribute ----------

// The prompt to copy, and a live line that waits for the answer and then moves
// the page to the results (site.js polls /api/wait/<token>).
// The line to paste, with its copy button beside it (so these pages have no
// pill at the bottom). `status` is what sits under the line (the live wait).
const promptCard = (line, title, status = '') => html`<section class="card prompt-card">
    <div>
      <h2 class="card-title">${title}</h2>
      <code>${line}</code>
      ${status}
      <p class="small">Works in Claude Code, Cursor, Codex CLI, ChatGPT and similar. Want to see what it asks your assistant to do first? <a href="/contribute.md">Read the instructions</a></p>
    </div>
    <button type="button" class="btn light big" data-copy="${line}">Copy the line</button>
  </section>`;
const waiting = (token) => html`<p class="waiting" role="status" data-wait="${token}"><span class="pulse" aria-hidden="true"></span><span data-wait-text>Waiting for your assistant. Keep this tab open.</span></p>`;
const promptAndWait = (url, token, title) => promptCard(promptLine(url), title, waiting(token));

// What an invited person needs before they will paste a line into their
// assistant: what to do, and what does and does not leave their computer.
// `assistant` names which one to use, `after` what happens at the end, and
// `note` who can see the answer.
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
const CROSS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const INVITE_TITLE = 'How do you work with AI assistants?';
const invitation = ({ assistant, after, note }) => html`<div class="invite">
    <section class="card">
      <h2 class="card-title">What you do</h2>
      <ol class="steps">
        <li><span><strong>Copy the line at the bottom of this page</strong><span class="muted">It is one sentence that tells an assistant where to find the survey.</span></span></li>
        <li><span><strong>Paste it into the assistant you use ${assistant}</strong><span class="muted">It reads its own history with you and names the habits it finds, such as “asks for a plan before any code”. You answer no questions.</span></span></li>
        <li><span><strong>Read what it found, then reply yes</strong><span class="muted">It shows you the exact answer before anything is sent. ${after}</span></span></li>
      </ol>
    </section>
    <section class="card">
      <h2 class="card-title">What leaves your computer</h2>
      <div><p class="label sent">${raw(CHECK)} Sent, after your yes</p>
        <ul class="plain-list"><li>Your habits, one sentence each</li><li>The tools and models you use</li><li>Rough ranges, such as prompts a month</li></ul></div>
      <div><p class="label never">${raw(CROSS)} Never sent</p>
        <ul class="plain-list"><li>Code, file names or paths</li><li>Project, client or people’s names</li><li>Links, passwords or keys</li></ul></div>
      <p class="banner">${note}</p>
    </section>
  </div>`;

// An optional name and password for the page the answer creates. Saved with
// the one-time code as you type (site.js); never sent to the assistant.
const detailsForm = (token) => html`<form class="details-form" method="post" action="/api/wait/${token}/details" data-details-form>
  <div class="field"><label for="dname">Your name <span class="muted">(optional)</span></label>
    <input id="dname" name="name" type="text" maxlength="60" autocomplete="name" placeholder="The first slide of your page"></div>
  <div class="field"><label for="dpass">Password <span class="muted">(optional)</span></label>
    <input id="dpass" name="password" type="password" maxlength="200" autocomplete="new-password" placeholder="Leave empty: anyone with the link can view"></div>
  <span class="small muted" data-details-status aria-live="polite"></span>
</form>`;

// The way to the presentation everyone can see, for someone who arrives on a
// contribute page from a link a colleague sent.
const PRESENTATION = html`<a href="/">See the presentation</a>`;
const ABOUT_SITE = `${SITE} is a shared picture of how people really work with assistants like Claude Code, Cursor and ChatGPT.`;

// `inviter`: the person whose invitation link led here ({ name }, the name may be empty).
export function contributePage({ mode, base, token, promptId = null, profile = null, error = null, inviter = null }) {
  const isCompany = mode === 'company';
  // A new person, invited or not: the page explains itself before it asks for anything.
  if (!isCompany && !profile) {
    const who = inviter ? inviter.name || 'A friend' : null;
    return page({
      title: 'Contribute',
      bare: true,
      noindex: true,
      body: html`
<div class="frame">
  ${slideHead({
    level: 1,
    eyebrow: who ? `An invitation from ${inviter.name || 'a friend'}` : 'Take part · for yourself',
    cls: 'q0',
    title: INVITE_TITLE,
    sub: who
      ? `${ABOUT_SITE} ${who} took part and thinks you should too: it takes about five minutes, and your assistant does the work.`
      : `${ABOUT_SITE} Add your habits and see how you compare: it takes about five minutes, and your assistant does the work.`,
    aside: who ? '' : html`<nav class="segmented" aria-label="Who is this for">
    <a href="/contribute" aria-current="page">For yourself</a>
    <a href="/contribute?for=company" class="clay">For your company</a>
  </nav>`,
  })}
  ${invitation({
    assistant: 'most',
    after: 'This page then moves to your results: your habits next to everyone’s.',
    note: `No account. Your results get a long, unlisted address that only you have.${who ? ` ${inviter.name || 'Your friend'} does not see your answer unless you share that address.` : ''}`,
  })}
  <section class="card"><h2 class="card-title">Optional: name your results page, or lock it</h2>${detailsForm(token)}</section>
  ${promptAndWait(`${base}/u/${promptId}/contribute.md`, token, 'The line to paste')}
  <p class="muted small"><a href="/">See what people have shared so far</a> · <a href="/privacy">Privacy</a>${who ? html` · <a href="/contribute?for=company">Start a page for your company instead</a>` : ''}</p>
</div>`,
    });
  }
  return page({
    title: 'Contribute',
    bare: true,
    noindex: true,
    body: html`
<div class="frame">
  ${slideHead({
    level: 1,
    eyebrow: `Take part · ${isCompany ? 'for your company' : 'for yourself'}`,
    cls: isCompany ? 'q1' : 'q0',
    title: isCompany ? 'Start a page for your company' : 'Paste this into your assistant',
    sub: isCompany
      ? 'You get a link for your team’s results, and a contribute link to send to colleagues. Results appear once five people have taken part.'
      : 'It reads its own history with you, shows you what it found, and sends it after your yes. This page moves to your results when it arrives.',
    aside: profile ? '' : html`<nav class="segmented" aria-label="Who is this for">
    <a href="/contribute"${raw(!isCompany ? ' aria-current="page"' : '')}>For yourself</a>
    <a href="/contribute?for=company" class="clay"${raw(isCompany ? ' aria-current="page"' : '')}>For your company</a>
  </nav>`,
  })}
  ${profile ? html`<p class="muted">Your new answer replaces the earlier one on <a href="/u/${profile.id}">your page</a>.</p>` : ''}
  ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
  ${isCompany
    ? html`<section class="card">
        <h2 class="card-title">Name the page, if you like</h2>
        <form method="post" action="/companies" class="details-form" id="company-form">
          <div class="field"><label for="cname">Company name <span class="muted">(optional)</span></label>
            <input id="cname" name="name" type="text" maxlength="80" placeholder="Colleagues see it when you invite them" autocomplete="organization"></div>
          <div class="field"><label for="cpass">Password <span class="muted">(optional)</span></label>
            <input id="cpass" name="password" type="password" maxlength="200" autocomplete="new-password" placeholder="Leave empty: anyone with the link can view"></div>
        </form>
        <p class="muted small">With a password, colleagues need it to open the page and to contribute. Without one, the link itself is the key: it is long and random, and not listed anywhere.</p>
      </section>
      <p class="muted small"><a href="/privacy">Privacy</a> · ${PRESENTATION}</p>
      <button class="page-action btn dark big" type="submit" form="company-form">Create the page ${raw(ARROW)}</button>`
    : html`${promptAndWait(`${base}/u/${promptId}/contribute.md`, token, 'The line to paste')}
      <p class="muted small">Nothing is sent without your yes. <a href="/privacy">Privacy</a> · ${PRESENTATION}</p>`}
</div>`,
  });
}

// ---------- company ----------

// A company page before ${MIN_GROUP} people have answered: how many have, and
// the link to send. From then on the page is the tour through its lens (lib/tour.js).
export function companyPage({ company, base, radar }) {
  const label = companyLabel(company);
  return page({
    title: label,
    bare: true,
    noindex: true,
    body: html`
<div class="frame">
${slideHead({ level: 1, eyebrow: 'Taking part so far', cls: 'clay', title: label, sub: `The radar, tools and experience appear once ${MIN_GROUP} people have taken part and their answers have been reviewed, so nobody can be picked out.` })}
<section class="card">
  <p class="figure-big">${radar.total} of ${MIN_GROUP}</p>
  <div class="progress big" role="progressbar" aria-valuemin="0" aria-valuemax="${MIN_GROUP}" aria-valuenow="${radar.total}"><span style="width:${(radar.total / MIN_GROUP) * 100}%"></span></div>
  <p class="muted small"><button type="button" class="linklike" data-copy="${base}/c/${company.id}/contribute">Copy the link for colleagues</button>${company.password_hash ? ' · They need this page’s password to open it or to contribute.' : ''}</p>
</section>
<p class="muted small"><a href="/c/${company.id}/edit">Edit or delete this page</a> · ${PRESENTATION}</p>
</div>
<a class="page-action btn dark big" href="/c/${company.id}/contribute">Add your habits ${raw(ARROW)}</a>`,
  });
}

// One centred screen, like a company page that is still collecting answers:
// the line to paste, and "Copy the line" where the slide navigation would be.
export function companyContributePage({ company, base, total, created, code = null }) {
  const enough = total >= MIN_GROUP;
  const line = promptLine(`${base}/c/${company.id}/contribute.md`);
  return page({
    title: `Contribute to ${companyLabel(company)}`,
    bare: true,
    noindex: true,
    body: html`
<div class="frame">
  ${slideHead({
    level: 1,
    eyebrow: company.name ? `${company.name} · an invitation from a colleague` : 'An invitation from a colleague',
    cls: 'clay',
    title: INVITE_TITLE,
    sub: `People at ${company.name || 'your company'} are comparing the habits and tools they use with assistants like Claude Code, Cursor and ChatGPT. Add yours: it takes about five minutes, and your assistant does the work.`,
  })}
  ${codeBanner(code)}
  ${invitation({
    assistant: 'for work',
    after: 'Afterwards you get a page of your own, with your habits next to everyone’s.',
    note: company.name
      ? `${company.name} sees totals only, once ${MIN_GROUP} people have taken part. Nobody at ${company.name} sees which answers are yours.`
      : `Your company sees totals only, once ${MIN_GROUP} people have taken part. Nobody there sees which answers are yours.`,
  })}
  ${promptCard(line, 'The line to paste')}
  <p class="muted small">${total ? html`<b>${total}</b> ${total === 1 ? 'colleague has' : 'colleagues have'} taken part so far.` : 'Be the first to take part.'} ${enough ? html`<a href="/c/${company.id}">See the results</a>` : html`<a href="/c/${company.id}">See the company page</a>`}${created ? html` · <button type="button" class="linklike" data-copy="${base}/c/${company.id}/contribute">Copy this page’s link for colleagues</button>${company.password_hash ? ' (they also need the password you set)' : ''}` : ''} · <a href="/">What is ${SITE}?</a> · <a href="/privacy">Privacy</a></p>
</div>`,
  });
}

// ---------- a person's page ----------

export const REVIEW_NOTE = {
  pending: 'This answer is waiting for review. It shows here already, and joins the shared numbers once it has been reviewed.',
  flagged: 'This answer is being looked at by a person before it joins the shared numbers.',
  rejected: 'This answer was not added to the shared numbers. It still shows here.',
};

// A person's page before its first answer. With an answer, the page is the
// tour through the You lens (lib/tour.js).
export function profilePage({ profile, companies, isOwner, code = null, invite = null }) {
  const again = isOwner ? `/u/${profile.id}/contribute` : '/contribute';
  return page({
    title: profile.name || 'Results',
    bare: true,
    noindex: true,
    body: html`
<div class="frame">
  ${slideHead({ level: 1, eyebrow: html`<a href="/">${SITE}</a>`, cls: 'q0', title: profile.name || 'No answer yet', sub: isOwner ? 'Paste the line from the contribute page into your assistant. Your results appear here once its answer arrives.' : 'This page has no answer yet.' })}
  ${codeBanner(code)}
  <div class="actions"><a class="btn dark big" href="${again}">${isOwner ? 'Take part' : 'Take part yourself'} ${raw(ARROW)}</a><a class="btn outline big" href="/contribute?for=company">Start a page for your company</a></div>
  ${invite ? html`<p class="muted"><button type="button" class="btn outline" data-copy="${invite}">Copy an invitation link for a friend</button></p>` : ''}
  ${companies.length ? html`<p class="muted">Company pages this page has contributed to: ${companies.map((c, i) => html`${i ? ', ' : ''}<a href="/c/${c.id}">${companyLabel(c)}</a>`)}</p>` : ''}
  <p class="muted small"><a href="/u/${profile.id}/edit">Edit or delete this page</a> · <a href="/">Everyone’s numbers</a> · ${MADE_BY}</p>
</div>`,
  });
}

// ---------- editing a page ----------

const pageLabel = (kind, row) => (kind === 'c' ? companyLabel(row) : row.name || 'This page');

// Asks for the editor's code before a page can be edited from this browser.
export function editGatePage({ kind, row, error }) {
  return page({
    title: 'Editor’s code needed',
    bare: true,
    noindex: true,
    body: html`<div class="frame">
  ${slideHead({ level: 1, eyebrow: html`Edit · /${kind}/${row.id}`, title: 'Enter the editor’s code', sub: 'It was shown when this page was made. With it you can rename the page, put a password on it, or delete it.' })}
  ${error ? html`<p class="error" role="alert">That code is not right.</p>` : ''}
  <section class="card">
    <form method="post" action="/${kind}/${row.id}/edit/unlock" class="details-form" id="code-form">
      <div class="field"><label for="code">Editor’s code</label><input id="code" name="code" type="text" required autofocus autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="60" placeholder="xxxxx-xxxxx-xxxxx-xxxxx"></div>
    </form>
    <p class="muted small">Lost it? On the browser that made this page you can still open this address and get a new code. Otherwise ask the site’s operator, giving the page’s address.</p>
  </section>
  <p class="muted small"><a href="/${kind}/${row.id}">Back to the page</a></p>
  <button class="page-action btn dark big" type="submit" form="code-form">Continue ${raw(ARROW)}</button>
</div>`,
  });
}

// Rename, protect or delete a page, and get a new editor's code.
export function editPage({ kind, row, code, saved, error, invite = null }) {
  const at = `/${kind}/${row.id}`;
  const isCompany = kind === 'c';
  return page({
    title: `Edit ${pageLabel(kind, row)}`,
    bare: true,
    noindex: true,
    body: html`<div class="frame">
  ${slideHead({ level: 1, eyebrow: html`Edit · ${at}`, title: pageLabel(kind, row), sub: 'Changes apply at once. Deleting cannot be undone.' })}
  ${saved ? html`<p class="banner" role="status"><span>Saved.</span></p>` : ''}
  ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
  ${codeBanner(code)}
  <div class="cards fit">
    <section class="card">
      <h2 class="card-title">Name</h2>
      <form method="post" action="${at}/settings" class="details-form">
        <div class="field"><label for="ename">${isCompany ? 'Company name' : 'Your name'} <span class="muted">(optional)</span></label>
          <input id="ename" name="name" type="text" maxlength="${isCompany ? 80 : 60}" value="${row.name ?? ''}" autocomplete="${isCompany ? 'organization' : 'name'}"></div>
        <button class="btn dark" type="submit">Save the name</button>
      </form>
      <p class="muted small">Shown on the first slide of the page. Leave it empty for no name.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Password</h2>
      <p>${row.password_hash
        ? (isCompany ? 'This page has a password: colleagues need it to open the page and to contribute.' : 'This page has a password: people need it to open the page.')
        : 'This page has no password: anyone with its link can open it.'}</p>
      <form method="post" action="${at}/settings" class="details-form">
        <div class="field"><label for="epass">${row.password_hash ? 'New password' : 'Password'}</label>
          <input id="epass" name="password" type="password" required maxlength="200" autocomplete="new-password"></div>
        <button class="btn dark" type="submit">${row.password_hash ? 'Change the password' : 'Set a password'}</button>
      </form>
      ${row.password_hash ? html`<form method="post" action="${at}/settings"><input type="hidden" name="remove_password" value="on"><button class="btn outline" type="submit">Remove the password</button></form>` : ''}
    </section>
    <section class="card">
      <h2 class="card-title">Editor’s code</h2>
      <p>${code ? 'Your code is shown above for a few more minutes.' : row.editor_code_hash ? 'The code is not kept in a readable form, so it cannot be shown again.' : 'This page was made before editor’s codes existed, so it has none yet.'} A new code replaces the old one, which stops working.</p>
      <form method="post" action="${at}/code" data-confirm="${row.editor_code_hash ? 'Make a new editor’s code? The current one stops working.' : ''}"><button class="btn outline" type="submit">${row.editor_code_hash ? 'Get a new code' : 'Get a code'}</button></form>
    </section>
    ${invite ? html`<section class="card">
      <h2 class="card-title">Invite a friend</h2>
      <p>A link to a page that explains what this is and how to take part${row.name ? `, as an invitation from ${row.name}` : ''}. It does not reveal this page’s address.</p>
      <div class="actions"><button type="button" class="btn outline" data-copy="${invite}">Copy the invitation link</button></div>
    </section>` : ''}
    ${isCompany ? '' : html`<section class="card">
      <h2 class="card-title">Your answers</h2>
      <p>Run the survey again to replace the answer on this page, or keep a copy of everything stored for it.</p>
      <div class="actions"><a class="btn outline" href="${at}/contribute">Run it again</a><a class="btn outline" href="${at}/export.json">Download as JSON</a></div>
    </section>`}
    <section class="card">
      <h2 class="card-title">This browser</h2>
      <p>Stop editing from this browser. You will need the editor’s code to come back.</p>
      <form method="post" action="${at}/forget"><button class="btn outline" type="submit">Forget this page here</button></form>
    </section>
    <section class="card">
      <h2 class="card-title">Delete</h2>
      <p>${isCompany ? 'Removes the company page. The answers colleagues sent stay on their own pages and in the shared numbers.' : 'Removes this page and every answer on it, from the shared numbers too.'}</p>
      <form method="post" action="${at}/delete" data-confirm="${isCompany ? 'Delete this company page? This cannot be undone.' : 'Delete this page and every answer on it? This cannot be undone.'}"><button class="btn danger" type="submit">Delete this page</button></form>
    </section>
  </div>
</div>
<a class="page-action btn dark big" href="${at}">Back to the page</a>`,
  });
}

// ---------- small pages ----------

// The password form in front of a protected page.
export function unlockPage({ kind, id, error }) {
  return page({
    title: 'Password needed',
    bare: true,
    noindex: true,
    body: html`<div class="frame">
  ${slideHead({ level: 1, eyebrow: 'Password needed', title: 'This page is protected', sub: kind === 'c' ? 'Ask the colleague who sent you this link for the password.' : 'Enter the password its owner set.' })}
  ${error ? html`<p class="error" role="alert">That password is not right.</p>` : ''}
  <section class="card">
    <form method="post" action="/${kind}/${id}/unlock" class="details-form" id="unlock-form">
      <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" required autofocus autocomplete="current-password"></div>
    </form>
  </section>
  <p class="muted small">${PRESENTATION}</p>
  <button class="page-action btn dark big" type="submit" form="unlock-form">Open the page ${raw(ARROW)}</button>
</div>`,
  });
}

export function privacyPage() {
  return page({
    title: 'Privacy',
    bare: true,
    body: html`<div class="frame">
  ${slideHead({ level: 1, eyebrow: 'Privacy', cls: 'q2', title: 'What is sent, stored and shown?', sub: 'Contributions describe how people work with assistants, never what they work on.' })}
  <div class="cards fit">
    <section class="card"><h2 class="card-title">What is sent</h2>
      <p>The <a href="/contribute.md">prompt</a> tells the assistant to remove names, code, paths, URLs and anything that looks like a secret, and to show you the exact payload before it sends anything. The server removes URLs, emails, file paths and token-like strings again on arrival.</p></section>
    <section class="card"><h2 class="card-title">No accounts</h2>
      <p>There is no sign-up. Each answer gets a page with a long random address (/u/…), and company pages work the same way (/c/…). The browser that created a page is remembered with a cookie, so it can open the page without its password, edit it and run the survey again. That cookie is the only one the site sets.</p></section>
    <section class="card"><h2 class="card-title">What is stored</h2>
      <ul class="plain-list"><li>Each contribution: the habits, tools, purposes, role and experience ranges it contains, and when it arrived.</li><li>The optional name and password of a page, and its editor’s code. Passwords and codes are stored only as hashes.</li><li>If it came through a company page: that page's code.</li></ul></section>
    <section class="card"><h2 class="card-title">Who can see what</h2>
      <ul class="plain-list"><li>The shared pages show totals and shares only, from answers that have been reviewed.</li><li>A company page shows totals only once ${MIN_GROUP} people have contributed, to people with its link (and its password, if it has one).</li><li>A personal page shows one person's answer to people with its link (and its password, if it has one).</li></ul></section>
    <section class="card"><h2 class="card-title">How answers are handled</h2>
      <p>What an assistant sends is treated as text to count, never as instructions. It is checked against a fixed list of fields and values, and reviewed before it is added to the shared numbers.</p></section>
    <section class="card"><h2 class="card-title">Deleting</h2>
      <p>Each page gets an editor’s code when it is made. With it you can rename, protect or delete the page yourself: open the page and choose “Edit or delete this page”. Deleting a personal page removes every answer on it. If you lost the code, ask the site’s operator, giving the page’s address.</p></section>
  </div>
  <p class="muted small">${MADE_BY}</p>
</div>
${BACK}`,
  });
}

export const notFoundPage = () => page({
  title: 'Not found',
  bare: true,
  body: html`<div class="frame">
  ${slideHead({ level: 1, eyebrow: 'Not found', title: 'There is nothing at this address', sub: 'Personal and company links stop working when their owner deletes the page.' })}
</div>
${BACK}`,
});

// ---------- icons ----------
const ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
