/**
 * Entry point. Creates the app, boots the menus and exposes a small QA hook
 * (window.__blackout) used by the browser test harness.
 */
import { App, registerApp } from './app';

const app = new App();
registerApp(app);
(window as unknown as { __blackout: App }).__blackout = app;

app.start().catch((err) => {
  console.error('[boot] failed', err);
  const status = document.getElementById('boot-status');
  if (status) status.textContent = 'Boot failed — see console.';
});
