'use client';
import { useEffect } from 'react';

/**
 * pwa-1: handle the case where a new service worker takes control
 * mid-session.
 *
 * Background: sw.js calls skipWaiting() + clients.claim() so a fresh
 * deploy activates immediately. Without a controllerchange handler,
 * tabs that were open before the deploy keep running the OLD JS
 * bundles — but the NEW SW is intercepting fetches with the new
 * cache version. On the next client-side route transition (Next.js
 * fetching a new RSC payload or chunk), the old client requests
 * fresh chunks that may have been renamed; result is a blank screen
 * or a runtime error.
 *
 * Fix: when the SW that controls the page changes, hard-reload once.
 * The reload boots the page on the new SW's cache + new bundles
 * cleanly. We guard with `reloadedRef` so we don't infinite-loop
 * across multiple controllerchange events from the same activation.
 */
export function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(console.error);

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      // Brief microtask delay so any pending reload-from-the-OTHER-side
      // (browser back/forward, devtools "update on reload") settles
      // first. window.location.reload is cheap; the small delay is
      // to avoid a double-reload race in dev with HMR.
      window.setTimeout(() => window.location.reload(), 0);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);
  return null;
}
