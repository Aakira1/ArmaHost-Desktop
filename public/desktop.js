if (window.armaDesktop) {
  document.body.classList.add('desktop');
  document.title = 'ArmaHost Desktop';
  document.querySelector('.brand > span:last-child').firstChild.textContent = 'ARMAHOST';
  document.querySelector('.sidebar-bottom > small').textContent = 'DESKTOP EDITION · V1.4.0';
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
  const updates = document.createElement('details');
  updates.innerHTML = '<summary>App updates</summary><p class="help-text">For this private repository, use a GitHub token with Contents read access. It is kept only for this session.</p><input type="password" autocomplete="off" placeholder="GitHub token (optional)" aria-label="GitHub update token"><button class="button subtle" data-check>Check for updates</button><button class="button subtle" data-download hidden>Download update</button><button class="button subtle" data-install hidden>Install update</button><button class="text-button" data-releases>Open GitHub Releases ↗</button><p class="help-text" data-status></p>';
  data.after(updates);
  const status = updates.querySelector('[data-status]');
  const check = updates.querySelector('[data-check]'), download = updates.querySelector('[data-download]'), install = updates.querySelector('[data-install]');
  check.onclick = async () => { check.disabled = true; download.hidden = true; install.hidden = true; status.textContent = 'Checking…'; try { const result = await window.armaDesktop.checkUpdate(updates.querySelector('input').value); updates.querySelector('input').value = ''; status.textContent = result.message; download.hidden = !result.available; } catch (error) { status.textContent = error.message; } finally { check.disabled = false; } };
  download.onclick = async () => { download.disabled = true; check.disabled = true; status.textContent = 'Downloading and verifying…'; try { status.textContent = (await window.armaDesktop.downloadUpdate()).message; install.hidden = false; download.hidden = true; } catch (error) { status.textContent = error.message; } finally { download.disabled = false; check.disabled = false; } };
  install.onclick = async () => { try { await window.armaDesktop.installUpdate(); } catch (error) { status.textContent = error.message; } };
  updates.querySelector('[data-releases]').onclick = () => window.armaDesktop.openReleases();
  const bar = document.getElementById('save-bar');
  new MutationObserver(() => window.armaDesktop.setDirty(!bar.hidden)).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!bar.hidden) document.querySelector('#save-bar .primary')?.click(); } });
}
