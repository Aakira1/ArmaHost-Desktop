if (window.armaDesktop) {
  document.body.classList.add('desktop');
  document.title = 'ArmaHost Desktop';
  document.querySelector('.brand > span:last-child').firstChild.textContent = 'ARMAHOST';
  document.querySelector('.sidebar-bottom > small').textContent = 'DESKTOP EDITION · V1.3.0';
  document.querySelector('.form-footer > .muted').textContent = 'Settings are stored in your Windows user profile.';
  document.querySelector('#offline-banner span').textContent = 'The local manager is unavailable. Close and reopen ArmaHost.';
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
  const bar = document.getElementById('save-bar');
  new MutationObserver(() => window.armaDesktop.setDirty(!bar.hidden)).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!bar.hidden) document.querySelector('#save-bar .primary')?.click(); } });
}
