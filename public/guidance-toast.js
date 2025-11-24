// Simple toast utility for guidance pages
(function () {
  function ensureContainer() {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function makeToast(message, type) {
    const container = ensureContainer();
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');

    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    if (type === 'success') icon.textContent = '✓';
    else if (type === 'error') icon.textContent = '⚠️';
    else if (type === 'warn') icon.textContent = '⚠️';
    else icon.textContent = 'ℹ️';

    const text = document.createElement('div');
    text.className = 'toast-text';
    text.textContent = message;

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = 'OK';
    close.onclick = () => { hideToast(toast); };

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(close);
    container.appendChild(toast);

    // show
    requestAnimationFrame(() => { toast.classList.add('show'); });

    // auto dismiss
    const timeout = setTimeout(() => { hideToast(toast); }, 4500);

    // clear timer if manually closed
    function hideToast(node) {
      if (!node) return;
      node.classList.remove('show');
      node.style.transition = 'opacity .22s, transform .22s';
      setTimeout(() => { try { node.remove(); } catch (e) {} }, 250);
      clearTimeout(timeout);
    }

    return { hide: () => hideToast(toast) };
  }

  // Expose globally
  window.showToast = function (message, type) {
    try { return makeToast(String(message || ''), type || 'info'); }
    catch (e) { console.error('showToast error', e); }
  };
})();
