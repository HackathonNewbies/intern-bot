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
   Calendar event, calendar-list, and free/busy permissions. Tokens are stored locally in
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
event cancellation, or per-user Google account connections.

## Schedule when a guest is free

> @intern-bot create a calendar invite titled Discussion for today, at a time
> when agarwalrahul1008@gmail.com is free, and invite him to the meeting.

`propose_available_calendar_invite` checks Google Free/Busy for each explicit
guest email (their primary calendar) and the configured shared calendar. It
proposes the earliest common free slot. Defaults shown on the review are 30
minutes within 09:00–18:00 Asia/Singapore, with quarter-hour starts at least five
minutes from now. Specify a duration, timezone, or search window to override
these defaults. An exhausted day is never silently moved forward.

Existing installations must rerun `npm run calendar:connect` once to grant
`calendar.events.freebusy`. This reads availability on calendars the connected
account can access. Other guests must share free/busy access with that account;
knowing an email address does not grant access. Missing/denied/incomplete results
stop the proposal; they never mean the person is free. Busy intervals stay inside
the lookup; private event details are not requested or posted to Slack.

The requester still approves the exact proposed time. Availability is rechecked
before the first creation attempt. A new conflict stops the write and allows
cancellation. After an uncertain write, retries recover the same event ID without
mistaking that event for a new conflict. This is a snapshot, not a reservation;
Google offers no atomic free/busy-and-create operation here. Additional personal
calendars and calendars not accessible to the connected account are not checked.

Verified September 12, 2026: after granting the free/busy scope, the live Slack
request for “Discussion” today selected 16:00–16:30 Asia/Singapore and delivered
the native approval card. Google availability lookup and Slack proposal delivery
were verified; creation for this availability-based test was left for the
requester to approve. Offline checks passed 112 tests, including conflict
rechecks, denied access, DST, no available slot, and uncertain-write recovery.
Keep only one runtime using the `intern-bot` Channel running across the team;
competing runtimes caused one live test request to miss this implementation.

Any human who can talk to the bot can request a reviewed event on the team
calendar. Restrict bot membership to trusted team channels for this demo.

References: [Google event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[desktop OAuth with PKCE](https://developers.google.com/identity/protocols/oauth2/native-app).
