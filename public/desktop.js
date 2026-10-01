if (window.armaDesktop) {
  document.body.classList.add('desktop');
  document.title = 'ArmaHost Desktop';
  document.querySelector('.brand > span:last-child').firstChild.textContent = 'ARMAHOST';
  document.querySelector('.sidebar-bottom > small').textContent = 'DESKTOP EDITION · V1.6.2';
  document.querySelector('.form-footer > .muted').textContent = 'Settings are stored in your Windows user profile.';
  document.querySelector('#offline-banner span').textContent = 'The local manager is unavailable. Close and reopen ArmaHost.';
  for (const paragraph of document.querySelectorAll('#help-dialog p')) {
    paragraph.textContent = paragraph.textContent.replace('Use Windows, Node.js 22 or newer, and', 'Use Windows and').replace('Direct launch may prompt a BattlEye restart.', 'Join uses the official BattlEye bootstrap when enabled.').replace('Quit stops that process and closes the manager.', 'Closing the desktop keeps the server running. Reopen it to reconnect; use Stop server to stop it.');
  }
  for (const [id, kind, title] of [['gameExe', 'game', 'Browse executable'], ['serverExe', 'server', 'Browse executable'], ['new-mod-path', 'mod', 'Browse folder'], ['modRoots', 'root', 'Add scan folder']]) {
    const input = document.getElementById(id);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button subtle native-browse'; button.textContent = title + '…';
    input.insertAdjacentElement('afterend', button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const selected = await window.armaDesktop.pick(kind);
        if (selected) {
          input.value = id === 'modRoots' ? [input.value.trim(), selected].filter(Boolean).join('\n') : selected;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (error) { document.getElementById('toast').textContent = error.message; document.getElementById('toast').hidden = false; }
      finally { button.disabled = false; }
    });
  }
  const data = document.createElement('button'); data.className = 'text-button'; data.textContent = 'Open data folder ↗';
  data.addEventListener('click', () => { void window.armaDesktop.openData().catch(console.error); });
  document.getElementById('help-button').after(data);
  // Automatic updates: the main process checks, downloads and verifies; this only shows state and asks to restart.
  const api = window.armaDesktop.updates;
  const panel = document.createElement('details'); panel.className = 'update-panel';
  panel.innerHTML = '<summary>Updates <span data-update-dot hidden>●</span></summary><p class="help-text" data-update-status>Checking…</p><div class="update-progress" data-update-progress hidden><i></i></div><button class="button subtle" data-update-check>Check now</button><button class="button primary" data-update-install hidden>Restart &amp; update</button><button class="text-button" data-update-skip hidden>Skip this version</button><label class="update-auto"><input type="checkbox" data-update-auto> Check automatically</label><button class="text-button" data-update-releases>All releases ↗</button><details class="update-advanced"><summary>Advanced</summary><input type="password" autocomplete="off" placeholder="GitHub token (private forks only)" aria-label="GitHub update token" data-update-token></details>';
  data.after(panel);
  const banner = document.createElement('div'); banner.id = 'update-banner'; banner.className = 'notice update-banner'; banner.hidden = true;
  banner.innerHTML = '<strong data-banner-title>Update ready.</strong><span>Restart ArmaHost to install it. Your server keeps running.</span><button class="button primary" data-banner-install>Restart &amp; update</button><button class="button subtle" data-banner-notes>What\'s new</button><button class="button subtle" data-banner-later>Later</button>';
  document.getElementById('main').prepend(banner);
  const notes = document.createElement('dialog'); notes.id = 'update-notes';
  notes.innerHTML = '<div class="dialog-top"><h2 data-notes-title>What\'s new</h2><button class="icon-button" data-notes-close aria-label="Close">×</button></div><pre class="update-notes-text" data-notes-text></pre><div class="dialog-actions"><button class="button subtle" data-notes-close>Close</button><button class="button primary" data-notes-install>Restart &amp; update</button></div>';
  document.body.append(notes);
  const q = (root, sel) => root.querySelector(sel);
  let dismissed = '';
  const time = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  function render(s) {
    const ready = s.status === 'ready';
    const percent = s.total ? Math.floor((s.received || 0) / s.total * 100) : 0;
    const text = {
      idle: `Version ${s.version}.`, checking: 'Checking for updates…',
      upToDate: `Version ${s.version} is up to date${s.checkedAt ? ` · checked ${time(s.checkedAt)}` : ''}.`,
      downloading: `Downloading ${s.available}… ${percent}%`,
      ready: `Version ${s.available} is downloaded and verified. Restart to install.`,
      skipped: `Version ${s.available} is available (skipped). Press Check now to get it anyway.`,
      error: `Couldn't update: ${s.error || 'unknown error'}`
    }[s.status] || '';
    q(panel, '[data-update-status]').textContent = text;
    q(panel, '[data-update-progress]').hidden = s.status !== 'downloading';
    q(panel, '[data-update-progress] i').style.width = `${percent}%`;
    q(panel, '[data-update-install]').hidden = !ready;
    q(panel, '[data-update-skip]').hidden = !ready;
    q(panel, '[data-update-dot]').hidden = !ready;
    q(panel, '[data-update-check]').disabled = s.status === 'checking' || s.status === 'downloading';
    q(panel, '[data-update-auto]').checked = s.autoCheck !== false;
    banner.hidden = !ready || dismissed === s.available;
    q(banner, '[data-banner-title]').textContent = `ArmaHost ${s.available} is ready.`;
    q(notes, '[data-notes-title]').textContent = `What's new in ${s.available || 'this update'}`;
    q(notes, '[data-notes-text]').textContent = s.notes || 'No release notes.';
    q(notes, '[data-notes-install]').hidden = !ready;
  }
  const toast = message => { const el = document.getElementById('toast'); el.textContent = message; el.hidden = false; };
  const install = async () => { try { await api.install(); } catch (error) { toast(error.message); } };
  q(panel, '[data-update-check]').onclick = async () => { const token = q(panel, '[data-update-token]'); render(await api.checkNow(token.value)); token.value = ''; };
  q(panel, '[data-update-install]').onclick = install; q(banner, '[data-banner-install]').onclick = install; q(notes, '[data-notes-install]').onclick = install;
  q(panel, '[data-update-skip]').onclick = async () => render(await api.skip());
  q(panel, '[data-update-auto]').onchange = async event => render(await api.setAuto(event.target.checked));
  q(panel, '[data-update-releases]').onclick = () => api.openReleases();
  q(banner, '[data-banner-notes]').onclick = () => notes.showModal();
  q(banner, '[data-banner-later]').onclick = async () => { dismissed = (await api.state()).available; banner.hidden = true; };
  for (const close of notes.querySelectorAll('[data-notes-close]')) close.onclick = () => notes.close();
  api.onState(render);
  void api.state().then(render);
  const bar = document.getElementById('save-bar');
  new MutationObserver(() => window.armaDesktop.setDirty(!bar.hidden)).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!bar.hidden) document.querySelector('#save-bar .primary')?.click(); } });
}
