# Event Hub: in-store TCG event runner

A carde.io-style app for running your own events over the store Wi-Fi. One laptop runs the server, staff use it from any browser, and players open it on their phones.

- **Any TCG.** Best-of-1/3/5, 3/1/0 match points, and the standard OMW% / GW% / OGW% tiebreakers with a 33% floor.
- **Registration and check-in.** Capacity with an automatic waitlist, walk-ins added at the desk, and no-shows left out of pairing.
- **Swiss pairings.** Players are paired within point groups (pairing down when a group is odd), with **no rematches** and the bye going to the lowest-ranked player who hasn't had one. Drops are handled. The round count is picked from attendance, and staff can override it.
- **Top cut.** Top 2/4/8/16/32 single elimination seeded 1vN, with byes if fewer players are eligible than the cut size.
- **Players self-report.** One player reports, the opponent confirms or disputes, and staff can override any result.
- **Live everywhere.** Pairings, results and the round timer update instantly on phones and the projector view (Server-Sent Events).
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

**Backups:** stop the server and copy `data/events.db`.

## Running an event

1. **Staff → New event.** Set the game, format, match length, round time, capacity and top cut.
2. **Open registration.** Players log in with a name and 4-digit PIN (no email needed) and tap **Register**.
3. **Check-in.** As players arrive, tap **Check in**. Walk-ins: type their name under *Add walk-in*.
4. **Start event.** This pairs round 1. Press **Start round** to start the timer, then show `/display/<id>` on a TV.
5. Players see their table on their phone, report the result and their opponent confirms. Disputes show up in red for a judge. **Enter / Edit** lets staff set any result.
6. When every result is in, press **Pair round N**. After the last Swiss round the button becomes **Start top N**, and then **Finish event**.

Players can drop from their phone. Staff can drop players, re-pair a round before it starts, add time, reset forgotten PINs (*Staff → Players*), and fix earlier Swiss results while Swiss is still running.

## Develop

```bash
npm run dev        # API with reload on :3000 + Vite on :5173 (proxying /api)
npm test           # engine + full-event API tests
npm run typecheck
```

```
server/engine/        pure pairing, standings, top cut and timer logic (unit-tested)
server/tournament.ts  event state machine on top of SQLite
server/routes/        Fastify HTTP API
server/live.ts        SSE broadcast
web/src/              React + Tailwind UI (pages/, components/)
scripts/              demo event walker used by `npm run seed` and the API test
```

Security model: this is meant for a trusted local network. Staff share one password. Player PINs are hashed, and repeated wrong guesses are locked out for 5 minutes. Don't expose the port to the internet without putting HTTPS and a stronger auth layer in front of it.
