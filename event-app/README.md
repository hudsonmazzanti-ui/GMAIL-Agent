# Event Hub: in-store TCG event runner

A carde.io-style app for running your own events over the store Wi-Fi. One laptop runs the server, staff use it from any browser, and players open it on their phones.

- **Any TCG.** Best-of-1/3/5, 3/1/0 match points, and the standard OMW% / GW% / OGW% tiebreakers with a 33% floor.
- **Registration and check-in.** Capacity with an automatic waitlist, walk-ins added at the desk, and no-shows left out of pairing.
- **Swiss pairings.** Players are paired within point groups (pairing down when a group is odd), with **no rematches** and the bye going to the lowest-ranked player who hasn't had one. Drops are handled. The round count is picked from attendance, and staff can override it.
- **Top cut.** Top 2/4/8/16/32 single elimination seeded 1vN, with byes if fewer players are eligible than the cut size.
- **Players self-report.** One player reports, the opponent confirms or disputes, and staff can override any result.
- **Live everywhere.** Pairings, results and the round timer update instantly on phones and the projector view (Server-Sent Events).
- **Entry fees through your PayPal POS.** Ring the entry up on the POS and the player is marked paid automatically (see below).
- **Projector view, printable match slips, CSV standings export.**

## Run it

Requires Node 20+.

```bash
cd event-app
npm install
npm start          # builds the web app and starts the server on port 3000
```

The console prints the Wi-Fi address and a QR code to put on the counter. Open `/staff` on the store computer. On first run it asks you to choose the staff password.

Want to see it with data first?

```bash
npm run seed       # 1 finished demo event + 1 open event. Staff password "changeme", player PIN 1234
```

The seed script uses `STAFF_PASSWORD` if set. Run it on an empty database, or set the same password you already use.

| Env var   | Default          | Meaning                                  |
| --------- | ---------------- | ---------------------------------------- |
| `PORT`    | `3000`           | Port to listen on (all interfaces)       |
| `DB_PATH` | `data/events.db` | SQLite file holding all events & players |
| `PUBLIC_URL` | this computer's Wi-Fi address | Address encoded in event QR codes |
| `POS_OAUTH_URL`, `POS_PRODUCTS_URL`, `POS_PURCHASES_URL` | PayPal POS APIs | Override to point at the fake POS |

**Backups:** stop the server and copy `data/events.db`.

## Running an event

Each screen shows one step and one main button. Everything else is under **☰ Tools**, which you only open when something unusual happens.

**Staff**

1. **New event:** type a name, the date and the entry fee (leave the fee blank for a free event), then press **Create event**.
   - The event takes sign-ups straight away.
   - A paid event goes onto your PayPal POS by itself if the POS is connected.
2. **Check in:**
   - Players scan the QR code on the screen, or you type their name into *Add a player*.
   - Each player gets one button:
     - **Check in** for a free event.
     - **Collect $X** with PayPal POS: ring the entry up on the POS and the player is checked in when the sale arrives.
     - **Paid $X · Check in** without a POS.
   - When everyone's here, press **Start event**.
3. **Play:**
   - Pairings go up and the round clock starts.
   - Players report on their phones and the list fills in.
   - A table only needs you if nobody reported (**Enter result**) or a player flagged the result (**Fix**).
   - When every result is in, the main button moves on: **Start round 2**, …, **Start top 4**, **Finish event**.
4. **Results:** the champion, the bracket and the final standings.

**Players**
1. Scan the QR code or open the event.
2. Type their name and tap **Join**. There's no sign-up; a new name is a new profile.
3. Their phone then shows their table, opponent and the clock, plus buttons like **I won 2-1** or **I lost 0-2**.
4. One player's report counts right away. If it's wrong, the opponent taps **That's wrong** and staff fix it.

**Defaults** (all changeable in *Tools → Event settings*):
- Best of 3, 50-minute rounds.
- The number of Swiss rounds comes from attendance.
- The top cut always happens: a final under 6 players, a top 4 for 6–15, and a top 8 for 16 or more.

**Tools** (the side bar):
- **Timer:** pause and add time.
- **Rounds:** re-pair, fix earlier results, print slips.
- **Players:** drop, remove, late entries.
- **Payments:** POS sales without a player, refunds, mark paid or comp, CSV.
- **Projector & standings**, **Event settings**, and delete.
- On the staff home: player PINs, the PayPal POS connection and the staff password.

**QR codes:** the QR points at this computer's Wi-Fi address even if you opened the app as `localhost`. If the store uses a fixed name or address, set `PUBLIC_URL` (e.g. `PUBLIC_URL=http://events.local:3000 npm start`).

**PINs:** players can add a 4-digit PIN from their profile (tap their name in the header) so nobody else can use their name.

## Entry fees with PayPal POS

Nobody pays inside Event Hub. Entry fees are rung up on your **PayPal POS** (formerly Zettle) like any other item, and Event Hub reads the sales back to mark players paid.

1. **Connect once.** Go to *Staff → Settings → PayPal POS* and click **Create an API key**. Do this while logged in to my.zettle.com as the account owner; the needed permissions (`READ:PURCHASE READ:PRODUCT WRITE:PRODUCT`) are pre-filled. Paste the key, then **Test & connect**. The key stays on the store computer and only sales made after connecting are imported.
2. **Per event.** Give the event an entry fee and it is added to the POS as an "Entry · <event> · <date>" product automatically. If the POS wasn't connected yet, use *Tools → Payments → Add to PayPal POS*.
3. **At the desk:**
   - Press **Collect $X** next to the player and ring the entry up on the POS. The next sale of that product, within 3 minutes, is credited to them and checks them in.
   - A sale of quantity 2 covers the next two waiting players.
   - A sale rung up without pressing Collect shows an alert; *Tools → Payments* lets you pick who paid.
   - *Tools → Payments* also has **Paid at desk** (cash or another terminal) and **Comp**, which work even when the internet is down.
4. **Refunds** are done on the POS as usual. The next sync marks that player *Refunded*.
5. **Payments CSV** lists every entry with its POS purchase number, for reconciling against PayPal POS reports.

Event Hub checks the POS every 20 seconds while an event is open or running; **Sync now** checks right away. The poll goes out over the internet, so players' phones still only need the store Wi-Fi.

**Trying it without a real account.** PayPal POS has no sandbox, so a fake one is included:

```bash
npm run fake-pos              # fake POS + "ring up a sale" page on http://localhost:4545
npm run build && npm run serve:fake-pos   # Event Hub pointed at the fake POS
```

Connect with API key `fake-api-key` and client ID `fake-client`, then ring up sales at `http://localhost:4545`.
For a real check, ring up one entry on your POS, refund it, and confirm both show up.

## Develop

```bash
npm run dev        # API with reload on :3000 + Vite on :5173 (proxying /api)
npm test           # engine + full-event API tests
npm run typecheck
npm run build:demo # web/dist-demo/demo.html: the whole app in one file, running in the browser
```

The demo build runs the real server routes in the page, with SQLite compiled to WebAssembly and the fake PayPal POS. It has a bar for switching between staff and players, and saves to the browser's local storage. It's handy for showing the app to staff without setting anything up.

```
server/engine/        pure pairing, standings, top cut and timer logic (unit-tested)
server/tournament.ts  event state machine on top of SQLite
server/routes/        Fastify HTTP API
server/live.ts        SSE broadcast
server/pos/           PayPal POS client, sale matching/polling, desk payment actions
web/src/              React + Tailwind UI (pages/, components/)
scripts/              demo event walker (`npm run seed`, API test) and the fake PayPal POS
```

Security model: this is meant for a trusted local network. Staff share one password. Player PINs are optional. Without one, anyone on the store Wi-Fi could log in as that player and report results, so staff confirm disputes and can correct any result. PINs are hashed, and repeated wrong guesses are locked out for 5 minutes. Don't expose the port to the internet without putting HTTPS and a stronger auth layer in front of it.
