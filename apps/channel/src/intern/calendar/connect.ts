import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { CalendarError, readOAuthClient, calendarTokenFile, scopes, googleAccessToken, calendarInfoSchema } from "./google";

async function listCalendars() {
  const token = await googleAccessToken();
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new CalendarError(`Calendar listing failed (HTTP ${response.status}).`);
    const page = z.object({ items: z.array(calendarInfoSchema), nextPageToken: z.string().optional() }).parse(await response.json());
    for (const calendar of page.items.filter(item => !item.primary && ["writer", "owner"].includes(item.accessRole))) {
      console.log(JSON.stringify({ name: calendar.summary, id: calendar.id, timeZone: calendar.timeZone }));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  console.log("Set GOOGLE_CALENDAR_ID in root .env to the chosen shared calendar ID, then restart Intern Bot.");
}

async function connect() {
  const client = readOAuthClient();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  let redirectUri = "";
  let processing = false;
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "GET" || url.pathname !== "/oauth2callback" || url.searchParams.get("state") !== state) {
      res.writeHead(400).end("Invalid authorization callback."); return;
    }
    if (processing) { res.writeHead(409).end("Authorization already processing."); return; }
    processing = true;
    try {
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.has("error")) throw new CalendarError("Google authorization was declined. No credentials were saved.");
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({ ...client, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
      });
      if (!response.ok) throw new CalendarError(`Google token exchange failed (HTTP ${response.status}).`);
      const tokens = z.object({ refresh_token: z.string().min(1), scope: z.string() }).parse(await response.json());
      if (!scopes.every(scope => tokens.scope.split(" ").includes(scope))) throw new CalendarError("Both requested Calendar permissions are needed. Run the connection command again and grant them.");
      const path = calendarTokenFile();
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
      writeFileSync(temporary, JSON.stringify({ refresh_token: tokens.refresh_token }) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
      chmodSync(path, 0o600);
      res.end("Google Calendar connected to Intern Bot. You can close this tab.");
      finish();
    } catch (error) {
      res.writeHead(400).end("Calendar connection failed. Check the terminal and retry.");
      fail(error);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new CalendarError("Could not start the local authorization callback.");
  redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(" "),
    access_type: "offline", prompt: "consent", state, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  console.log("Open this URL in your browser on this computer and choose the Google account that can edit the shared calendar:");
  console.log(url.toString());
  const timeout = setTimeout(() => fail(new CalendarError("Authorization timed out after 10 minutes. Run npm run calendar:connect again.")), 10 * 60_000);
  try {
    await done;
    console.log("Connected. Refresh token saved in ignored .data with owner-only permissions.");
  } finally {
    clearTimeout(timeout);
    server.close();
  }
  await listCalendars();
}

try {
  if (process.argv.includes("--list")) await listCalendars();
  else await connect();
} catch (error) {
  console.error(error instanceof CalendarError ? error.message : "Google Calendar setup failed. Check the client file, granted scopes, and network access. No secret values are logged.");
  process.exitCode = 1;
}
