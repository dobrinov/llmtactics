// The pages. Each function returns a full HTML document.
import { page, html, raw, MADE_BY, SITE, companyName } from './html.js';
import { MIN_GROUP } from './stats.js';
import { ICON } from './icons.js';

// A company's name is optional: a page without one shows as "This company".

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

const BACK = html`<a class="page-action btn dark big" href="/">${raw(ICON.back)} Back to the presentation</a>`;


// ---------- a person's page ----------

export const REVIEW_NOTE = {
  pending: 'This answer is waiting for review. Here, for you, it is counted in already; it joins everyone’s numbers once it has been reviewed.',
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
  <div class="actions"><a class="btn dark big" href="${again}">${isOwner ? 'Take part' : 'Take part yourself'} ${raw(ICON.arrow)}</a><a class="btn outline big" href="/contribute?for=company">Start a page for your company</a></div>
  ${invite ? html`<p class="muted"><button type="button" class="btn outline" data-copy="${invite}">Copy an invitation link for a friend</button></p>` : ''}
  ${companies.length ? html`<p class="muted">Company pages this page has contributed to: ${companies.map((c, i) => html`${i ? ', ' : ''}<a href="/c/${c.id}">${companyName(c)}</a>`)}</p>` : ''}
  <p class="muted small"><a href="/u/${profile.id}/edit">Edit or delete this page</a> · <a href="/">Everyone’s numbers</a> · ${MADE_BY}</p>
</div>`,
  });
}

// ---------- editing a page ----------

const pageLabel = (kind, row) => (kind === 'c' ? companyName(row) : row.name || 'This page');

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
  <button class="page-action btn dark big" type="submit" form="code-form">Continue ${raw(ICON.arrow)}</button>
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
// `next`: the path that asked for the password, opened once it is right.
export function unlockPage({ kind, id, error, next = null }) {
  return page({
    title: 'Password needed',
    bare: true,
    noindex: true,
    body: html`<div class="frame">
  ${slideHead({ level: 1, eyebrow: 'Password needed', title: 'This page is protected', sub: kind === 'c' ? 'Ask the colleague who sent you this link for the password.' : 'Enter the password its owner set.' })}
  ${error ? html`<p class="error" role="alert">That password is not right.</p>` : ''}
  <section class="card">
    <form method="post" action="/${kind}/${id}/unlock" class="details-form" id="unlock-form">
      ${next ? html`<input type="hidden" name="next" value="${next}">` : ''}
      <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" required autofocus autocomplete="current-password"></div>
    </form>
  </section>
  <p class="muted small"><a href="/">See the presentation</a></p>
  <button class="page-action btn dark big" type="submit" form="unlock-form">Open the page ${raw(ICON.arrow)}</button>
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
    <section class="card"><h2 class="card-title">Who runs this</h2>
      <p>A personal, non-commercial project by one person, not run by or for any employer. Answers are used for nothing but the shared numbers and each person's own page: never sold, shared or used for marketing.</p></section>
    <section class="card"><h2 class="card-title">What stays on your machine</h2>
      <p>Your prompts, transcripts, code, file names and project or company names. The assistant reads them locally, asks you first, and can skip any project you name. Only the summary you approve leaves.</p></section>
    <section class="card"><h2 class="card-title">What is sent</h2>
      <p>The <a href="/contribute.md">prompt</a> tells the assistant to remove names, code, paths, URLs and anything that looks like a secret, and to show you the exact payload before it sends anything. The server removes URLs, emails, file paths and token-like strings again on arrival.</p></section>
    <section class="card"><h2 class="card-title">No accounts</h2>
      <p>There is no sign-up. Each answer gets a page with a long random address (/u/…), and company pages work the same way (/c/…). The browser that created a page is remembered with a cookie, so it can open the page without its password, edit it and run the survey again. That cookie is the only one the site sets.</p></section>
    <section class="card"><h2 class="card-title">What is stored</h2>
      <ul class="plain-list"><li>Each contribution: its habits (a name and a few sentences each), the tools and models it names with what each is used for and how often, its purposes, role and country, rough ranges (experience, prompts, cost, tokens) and how the token cost splits, and when it arrived.</li><li>The optional name and password of a page, and its editor’s code. Passwords and codes are stored only as hashes.</li><li>If it came through a company page: that page's code.</li></ul></section>
    <section class="card"><h2 class="card-title">Who can see what</h2>
      <ul class="plain-list"><li>The shared pages show totals and shares only, from answers that have been reviewed.</li><li>A company page shows totals only once ${MIN_GROUP} people have contributed, to people with its link (and its password, if it has one).</li><li>A personal page shows one person's answer to people with its link (and its password, if it has one).</li></ul></section>
    <section class="card"><h2 class="card-title">How answers are handled</h2>
      <p>What an assistant sends is treated as text to count, never as instructions. It is checked against a fixed list of fields and values, and reviewed before it is added to the shared numbers.</p>
      <p>The review is helped by a model: the habit names and descriptions, the tool names with what each is used for, and the assistant's short note on what it counted are sent to Anthropic's Claude API. Role, country and the numbers are not sent. The model gets no tools, and checks only whether the answer is about working habits and free of personal or confidential details, and which known habits they match. Only its verdict with a one-line reason, and those matches, are stored. Anything it is unsure of goes to a person.</p></section>
    <section class="card"><h2 class="card-title">Deleting</h2>
      <p>Each page gets an editor’s code when it is made. With it you can rename, protect or delete the page yourself: open the page and choose “Edit or delete” at its foot. Deleting a personal page removes every answer on it. If you lost the code, ask the site’s operator, giving the page’s address.</p></section>
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
