(function () {
    // Create toast container if not present
    function ensureContainer() {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-atomic', 'true');
            container.style.pointerEvents = 'none';
            container.style.position = 'fixed';
            container.style.top = '20px';
            container.style.right = '20px';
            container.style.zIndex = '99999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '12px';
            document.body.appendChild(container);
        }
        return container;
    }

    // Inject minimal styles once
    function injectStyles() {
        if (document.getElementById('toast-styles')) return;
        const css = `
            .toast { pointer-events: auto; display: flex; align-items: center; gap: 12px; min-width: 260px; max-width: 420px; padding: 12px 16px; border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); color: #fff; font-weight: 600; }
            .toast-success { background: #059669; }
            .toast-error { background: #DC2626; }
            .toast-info { background: #111827; }
            .toast-close { background: transparent; border: none; color: rgba(255,255,255,0.95); font-size: 18px; cursor: pointer; }
        `;
        const s = document.createElement('style');
        s.id = 'toast-styles';
        s.appendChild(document.createTextNode(css));
        document.head.appendChild(s);
    }

    function showToast(message, type = 'success', timeout = 4500) {
        try {
            injectStyles();
            const container = ensureContainer();
            const toast = document.createElement('div');
            toast.className = 'toast toast-' + (type || 'info');

            const content = document.createElement('div');
            content.style.flex = '1';
            content.style.wordBreak = 'break-word';
            content.textContent = message;

            const closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.innerHTML = '\u00D7';
            closeBtn.onclick = () => {
                if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
            };

            toast.appendChild(content);
            toast.appendChild(closeBtn);
            container.appendChild(toast);

            setTimeout(() => {
                if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
            }, timeout);
        } catch (e) {
            try { window.alert(message); } catch (e) { /* ignore */ }
        }
    }

    // Expose globally
    window.showToast = showToast;

    // Override alert
    (function () {
        const nativeAlert = window.alert && window.alert.bind(window);
        window.alert = function (msg) {
            const asString = String(msg || '');
            const lowered = asString.toLowerCase();
            if (lowered.startsWith('error') || lowered.includes('failed') || lowered.includes('an error')) {
                showToast(asString, 'error');
            } else {
                showToast(asString, 'success');
            }
            // If native alert is needed for debugging, uncomment the next line
            // if (nativeAlert) nativeAlert(msg);
        };
    })();

})();
