// Polyfill to intercept deprecated DOM mutation event listeners
// and emulate them using MutationObserver. This avoids the
// browser warning for 'DOMNodeInsertedIntoDocument' etc.
(function () {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;

  const legacyEvents = new Set([
    'DOMNodeInserted',
    'DOMNodeInsertedIntoDocument',
    'DOMNodeRemoved',
    'DOMSubtreeModified'
  ]);

  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;

  // Map: target -> { observer, handlers: Map<type, Set<wrapperFn>> }
  const targetRegistry = new WeakMap();

  function ensureRegistry(target) {
    let entry = targetRegistry.get(target);
    if (!entry) {
      entry = { observer: null, handlers: new Map() };
      targetRegistry.set(target, entry);
    }
    return entry;
  }

  function dispatchLegacyEvent(target, type, relatedNode) {
    try {
      const ev = new Event(type, { bubbles: false, cancelable: true });
      try { Object.defineProperty(ev, 'relatedNode', { value: relatedNode, enumerable: false }); } catch(e) {}
      // Call all registered wrappers for this target/type
      const entry = targetRegistry.get(target);
      if (!entry) return;
      const set = entry.handlers.get(type);
      if (!set) return;
      set.forEach(fn => {
        try { fn.call(target, ev); } catch (e) { console.error('legacy event handler error', e); }
      });
    } catch (e) {
      // Swallow polyfill errors
      console.error('legacy event dispatch error', e);
    }
  }

  function setupObserverFor(target) {
    const entry = ensureRegistry(target);
    if (entry.observer) return entry.observer;

    const root = (target === document || target === document.documentElement) ? document : target;
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            // Fire both DOMNodeInserted and DOMNodeInsertedIntoDocument variations
            dispatchLegacyEvent(target, 'DOMNodeInserted', n);
            dispatchLegacyEvent(target, 'DOMNodeInsertedIntoDocument', n);
            // Also notify subtree modified
            dispatchLegacyEvent(target, 'DOMSubtreeModified', n);
          }
        }
        if (m.removedNodes && m.removedNodes.length) {
          for (const n of m.removedNodes) {
            dispatchLegacyEvent(target, 'DOMNodeRemoved', n);
            dispatchLegacyEvent(target, 'DOMSubtreeModified', n);
          }
        }
      }
    });

    try {
      obs.observe(root, { childList: true, subtree: true });
      entry.observer = obs;
    } catch (e) {
      // Ignore observe errors
      console.warn('Failed to observe target for legacy DOM events', e);
    }
    return obs;
  }

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (legacyEvents.has(type) && typeof listener === 'function') {
      const entry = ensureRegistry(this);
      let set = entry.handlers.get(type);
      if (!set) {
        set = new Set();
        entry.handlers.set(type, set);
      }
      // store wrapper (we use the original listener directly since we call it ourselves)
      set.add(listener);
      // Ensure observer is running
      setupObserverFor(this);
      // Do not register the deprecated event with browser (avoid duplicate behavior)
      return;
    }
    return originalAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (legacyEvents.has(type) && typeof listener === 'function') {
      const entry = targetRegistry.get(this);
      if (!entry) return;
      const set = entry.handlers.get(type);
      if (!set) return;
      set.delete(listener);
      // if no handlers and observer exists, disconnect
      const anyLeft = Array.from(entry.handlers.values()).some(s => s.size > 0);
      if (!anyLeft && entry.observer) {
        try { entry.observer.disconnect(); } catch (e) {}
        entry.observer = null;
      }
      return;
    }
    return originalRemove.call(this, type, listener, options);
  };

  // Expose for debugging
  window.__legacyDOMEventPolyfill = { enabled: true };
})();
