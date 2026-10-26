/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real session/auth/action/proxy modules with local request cookies. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalTs = Module._extensions[".ts"];
const originalPassword = process.env.APP_PASSWORD;
const originalNodeEnv = process.env.NODE_ENV;
const password = "test-session-password-Ž";
process.env.APP_PASSWORD = password;
const cookieValues = new Map([["daily-statistics-access", "ok"]]);
const writes = [];
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._load = function (request, parent, isMain) {
  if (request === "next/navigation") return { redirect: (location) => { throw Object.assign(new Error("Redirect"), { location }); } };
  if (request === "next/headers") return { cookies: async () => ({
    get: (name) => cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
    set: (name, value, options) => { cookieValues.set(name, value); writes.push({ name, value, options }); },
    delete: (name) => { cookieValues.delete(name); },
  }) };
  return originalLoad.call(this, request, parent, isMain);
};

const session = require("../src/lib/session.ts");
const auth = require("../src/lib/auth.ts");
const actions = require("../src/app/actions/auth.ts");
const { proxy } = require("../src/proxy.ts");
function form(value) {
  const body = new FormData();
  if (value !== undefined) body.set("password", value);
  return body;
}
function route(pathname, token) {
  return proxy(new NextRequest(`https://admin.example.invalid${pathname}`, {
    headers: token === undefined ? {} : { Cookie: `${session.AUTH_COOKIE}=${token}` },
  }));
}
async function expectRedirect(run, location) {
  await assert.rejects(run, (error) => error.location === location);
}

(async () => {
  const issued = Date.now();
  const token = session.createSession(issued);
  assert.notEqual(token, "ok");
  assert.equal(session.verifySession(token, issued), true);
  assert.notEqual(session.createSession(issued), token, "separate logins must get independently randomized tokens");
  assert.doesNotMatch(token, /test-session-password/);
  assert.equal(session.verifySession(token, issued + session.SESSION_MAX_AGE_SECONDS * 1000), false, "expiry is enforced by the server, not only cookie maxAge");
  assert.equal(session.verifySession(token, issued - 1000), false, "future-issued sessions are rejected");
  assert.equal(session.verifySession(token, NaN), false);
  for (const forged of [undefined, null, 123, "", "ok", "true", "v1.1.2.nonce.signature", "x".repeat(5000), token + ".extra", token.replace(/^v1/, "v2")]) {
    assert.equal(session.verifySession(forged, issued), false);
  }
  const parts = token.split(".");
  const tamperedExpiry = [...parts];
  tamperedExpiry[2] = String(Number(tamperedExpiry[2]) + 1);
  assert.equal(session.verifySession(tamperedExpiry.join("."), issued), false);
  const tamperedIssued = [...parts];
  tamperedIssued[1] = String(Number(tamperedIssued[1]) - 60);
  tamperedIssued[2] = String(Number(tamperedIssued[2]) - 60);
  assert.equal(session.verifySession(tamperedIssued.join("."), issued), false);
  const tamperedNonce = [...parts];
  tamperedNonce[3] = `${tamperedNonce[3][0] === "A" ? "B" : "A"}${tamperedNonce[3].slice(1)}`;
  assert.equal(session.verifySession(tamperedNonce.join("."), issued), false);
  const invalidSignature = [...parts];
  invalidSignature[4] = "A".repeat(43);
  assert.equal(session.verifySession(invalidSignature.join("."), issued), false);
  assert.equal(session.verifyAppPassword(password), true);
  for (const wrong of ["", "change-me", "wrong", password + " ", "é".repeat(password.length)]) assert.equal(session.verifyAppPassword(wrong), false);

  process.env.APP_PASSWORD = "different-password";
  assert.equal(session.verifySession(token, issued), false, "password changes revoke old sessions");
  delete process.env.APP_PASSWORD;
  assert.equal(session.verifySession(token, issued), false);
  assert.equal(session.verifyAppPassword("change-me"), false, "there is no fallback admin password");
  assert.throws(() => session.createSession(), /not configured/);
  await expectRedirect(() => actions.loginAction(form("change-me")), "/login?error=1");
  assert.equal(writes.length, 0, "a missing configured password must never issue a session");
  process.env.APP_PASSWORD = "";
  assert.equal(session.verifyAppPassword(""), false);
  process.env.APP_PASSWORD = password;

  for (const forged of ["ok", "v1.1.2.nonce.signature", invalidSignature.join(".")]) {
    cookieValues.set(session.AUTH_COOKIE, forged);
    assert.equal(await auth.isAuthenticated(), false);
    const response = route("/reklame", forged);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://admin.example.invalid/login");
  }
  cookieValues.set(session.AUTH_COOKIE, token);
  assert.equal(await auth.isAuthenticated(), true);
  assert.equal(await auth.requireAuth(), true);
  assert.equal(route("/reklame", token).headers.get("x-middleware-next"), "1");
  assert.equal(route("/orders", undefined).status, 307);
  for (const pathname of ["/login", "/favicon.ico", "/_next/static/example.js", "/r/public-label.pdf"]) {
    assert.equal(route(pathname).headers.get("x-middleware-next"), "1", "existing public route exceptions stay accessible");
  }
  for (const pathname of ["/galago-reklamacije.html", "/galago-reklamacije-privatnost.html", "/galago-reklamacije-uslovi.html", "/galago-reklamacije.css"]) {
    assert.equal(route(pathname).headers.get("x-middleware-next"), "1", "OAuth information pages are public");
    assert.ok(fs.existsSync(path.join(root, "public", pathname.slice(1))));
  }
  for (const pathname of ["/reklamacije", "/reklamacije/povezivanje", "/galago-reklamacije.html/private", "/galago-reklamacije-secret.json"]) {
    assert.equal(route(pathname).status, 307, "public information must not expose admin or similarly named private paths");
  }
  cookieValues.delete(session.AUTH_COOKIE);
  assert.equal(await auth.isAuthenticated(), false);
  await expectRedirect(() => actions.loginAction(form("wrong")), "/login?error=1");
  assert.equal(writes.length, 0);
  process.env.NODE_ENV = "production";
  await expectRedirect(() => actions.loginAction(form(password)), "/");
  const login = writes.at(-1);
  assert.equal(login.name, session.AUTH_COOKIE);
  assert.equal(session.verifySession(login.value), true);
  assert.deepEqual(login.options, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: session.SESSION_MAX_AGE_SECONDS });
  assert.equal(await auth.isAuthenticated(), true);
  await expectRedirect(() => actions.logoutAction(), "/login");
  assert.equal(await auth.isAuthenticated(), false);
  assert.equal(cookieValues.get("daily-statistics-access"), "ok", "the separate statistics gate is unchanged");
  process.env.NODE_ENV = "development";
  await expectRedirect(() => actions.loginAction(form(password)), "/");
  assert.equal(writes.at(-1).options.secure, false, "local HTTP development remains supported");
  console.log("Signed session tests passed: forgery, tampering, expiry, rotation, fail-closed password configuration, login/logout, auth and proxy. No live data accessed.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  if (originalTs) Module._extensions[".ts"] = originalTs;
  else delete Module._extensions[".ts"];
  if (originalPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalPassword;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});
