import { escapeHtml, pageHead, themeControl } from "./ui.js";

export function loginPage(error = ""): string {
  return `<!doctype html><html lang="en-AU"><head>${pageHead}<title>Sign In · Actual Up</title></head><body><header><div class="app-title"><a href="/">Actual Up</a>${themeControl}</div></header><main class="login"><section class="panel wa-stack"><h1>Sign In</h1><p>Your accounts, kept in sync.</p>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form action="/login" method="post" class="wa-stack"><label>Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="wa-brand">Sign In</button></form></section></main></body></html>`;
}
