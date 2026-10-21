# GMAIL-Agent

A one-page home screen with three parts:

- **Usage %**: a line chart of Claude plan usage, with Daily (last 30 days) and Monthly (average per month, last 12 months) views.
- **Articles worth reading**: picked from newsletters and links in Gmail.
- **Calendar / reminders**: the next 7 days from Google Calendar, plus reminders found in email (bills, deadlines, RSVPs).

It uses no API key. The page reads a Google Sheet, [Gmail Agent Dashboard](https://docs.google.com/spreadsheets/d/1j5NDEfWrDHkOFrRSn90czZ-s3VXo5XYqwFcHdV1qBoE/edit), as CSV. Claude fills in the sheet when you ask, using the Gmail, Calendar and Sheets connectors.

## Setup

1. **Share the sheet.** Open the sheet and choose **Share → General access → Anyone with the link → Viewer**. The page can't read the sheet until you do this.
   - Anyone with the link can see the sheet's contents. Keep sensitive email details out of it.
2. **Turn on GitHub Pages.** Merge this branch into `main`. Then go to **Settings → Pages → Build and deployment**, pick **Deploy from a branch**, and choose `main` / `/ (root)`. The site will be at `https://hudsonmazzanti-ui.github.io/GMAIL-Agent/`.
3. Open the site. If a card says *"can't reach the sheet"*, the sharing setting from step 1 hasn't been applied.

To point the page at a different sheet, change `SHEET_ID` at the top of `app.js`.

## Sheet layout

| Tab | Columns |
|---|---|
| `usage` | `date` (YYYY-MM-DD), `percent` (0–100), `note` |
| `articles` | `added` (YYYY-MM-DD), `title`, `source`, `url`, `why`, `read` (TRUE/FALSE) |
| `calendar` | `when` (YYYY-MM-DD for all day, or YYYY-MM-DDTHH:MM), `title`, `type` (`event` or `reminder`), `details` |
| `meta` | `key`, `value`. The `last_updated` row sets the "Data as of" footer. |

Column A of each tab is formatted as plain text, so Sheets doesn't turn the dates into numbers.

You can edit the sheet by hand too. For example, set `read` to `TRUE` to hide an article.

## Updating the data

Ask Claude in a session that has the Gmail, Google Calendar and Google Sheets connectors turned on:

> Update my Gmail Agent dashboard (sheet `1j5NDEfWrDHkOFrRSn90czZ-s3VXo5XYqwFcHdV1qBoE`):
> 1. Search Gmail for newsletters and article links from the last 3 days. Add the ones worth reading to `articles`, with a one-line reason each, and skip any URL that's already there.
> 2. Replace the rows in `calendar` with my Google Calendar events for the next 7 days. Add reminders for bills, deadlines and RSVPs found in recent email.
> 3. My Claude usage today is __%. Add it to `usage`.
> 4. Set `meta` `last_updated` to now.

No connector can read Claude plan usage, so you provide that number. You'll find it under Settings → Usage on claude.ai. Leave step 3 out when you don't have it.

The same prompt can run as a daily scheduled task, so the articles and calendar refresh on their own.

## Local testing

```sh
python3 -m http.server 8000
# http://localhost:8000/?data=sample  uses the CSVs in sample/
# http://localhost:8000/              uses the live sheet
```

## Files

- `index.html`, `style.css`, `app.js`: the page. There is no build step. Chart.js loads from cdnjs.
- `sample/`: example CSVs for `?data=sample`.
