# Shared Google Calendar invitations

Intern Bot can propose invitations on one configured secondary/shared calendar.
The Slack requester reviews the title, times, timezone, guest emails, description,
and location, then clicks **Create & send invites**. A verified Google event link
replaces the card. Cancel creates nothing. Other Slack users cannot approve it.

## Connect one Google account

1. In Google Calendar, create a secondary calendar named **HackathonNewbies**.
   Set its timezone to **Asia/Singapore**. Use **Share with specific people** to
   give your teammates access if they need to browse the calendar; event guests
   receive invitations even without calendar-wide access.
2. In your Google Cloud project, enable **Google Calendar API** and configure the
   OAuth consent screen. While the app is in Testing, add the Google account that
   will authorize the bot as a test user.
3. Create an OAuth client with application type **Desktop app**. Download its
   client JSON into the ignored `.data/google-oauth-client.json` file. Do not
   commit it or paste credentials into Slack or chat.
4. From the repository root, run `npm run calendar:connect`. Open its URL on the
   same computer, choose the calendar's owner/editor account, and authorize the
   Calendar event and calendar-list permissions. Tokens are stored locally in
   `.data/google-calendar-token.json` with file mode `0600`.
5. The command lists writable secondary calendars. Copy the chosen ID into
   `GOOGLE_CALENDAR_ID` in root `.env`. You can list again with
   `npm run calendar:list`. The bot rejects primary calendars and calendars it
   cannot edit. Its tool cannot select a different calendar.
6. Restart the one live Slack runtime: `npm run dev:slack`.

Google's Calendar event permission covers calendars accessible to that Google
account; the application restricts writes to the configured ID. A dedicated
Google account with access only to the team calendar further limits exposure.
Google testing-mode authorizations may need reconnecting after seven days.

## Try it

In Slack, use a future date and real guest emails:

> @intern-bot create a calendar invite for Demo review on 15 September 2026,
> 3–3:30 pm Singapore time. Invite person@example.com.

The bot asks for missing details; it must never guess guest email addresses.
Inspect the card before clicking **Create & send invites**. The API uses
`sendUpdates=all`, which asks Google to notify every guest. Notification delivery
and guest acceptance are not confirmed by event creation.

## Runtime and retry limits

Approval cards expire after 20 minutes and do not survive a runtime restart.
Keep one listener running. Repeated clicks on the same card use the same event
ID, including after an uncertain network failure; successful creation is read
back before it is reported. If a creation attempt fails, retry **the same card**.
If the process restarted after an uncertain write, check Google Calendar before
making a new request. This implementation does not add recurrence, Google Meet,
free/busy checks, event cancellation, or per-user Google account connections.

Any human who can talk to the bot can request a reviewed event on the team
calendar. Restrict bot membership to trusted team channels for this demo.

References: [Google event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[desktop OAuth with PKCE](https://developers.google.com/identity/protocols/oauth2/native-app).
