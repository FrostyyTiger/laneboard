# The Wall: node action UI, a Stellaris-inspired brief (2026-10-27)

Scope: the front end only. The first slice ships **display and navigation**. Actions that change the fleet are drawn in the layout
but marked **later (C6)**. Touch targets are **at least 48 px**.

## 1. What makes Stellaris's UI feel organised (paraphrased)
- **The map is home and the panels are guests.** Nearly everything can be reached from the galaxy map. Panels open over its edges
  and close back to it, and the map never gets replaced. You always know where "home" is.
- **Fixed regions, each with one job.** Resources and the clock sit along the top. The alerts for "things that need you" sit just under
  them. The outliner lists everything you own down the right edge. A narrow sidebar on the left holds the big screens. The selected object's panel opens on the left.
  Because each thing always appears in the same region, your eye learns where to look.
- **Summary first, detail on demand.** A top-bar number shows a total and its monthly change, and hovering it shows the breakdown. Nested
  tooltips (since 3.8) let a highlighted term open its own tooltip, which can be pinned. The first layer stays short, and the depth is there if you go looking.
- **Every list item is also a way to get there.** Clicking an outliner row, an alert or a log entry selects the object and moves the
  camera to it. Lists and the map are two views of the same objects.
- **Severity drives the visuals.** Alerts are icons with a coloured frame, and they fade or can be dismissed with a right-click. Routine
  events stay quiet and only problems come forward. Reviewers' main complaint was the opposite case: popups for routine events.
- **Context decides the verbs.** Right-clicking a system offers different orders depending on what is selected (move, survey, build
  outpost, attack). You only see the actions that make sense for that pair.
- **Grouping and collapsing for scale.** The outliner groups by kind (planets by sector, fleets, construction ships), and each
  group folds away. The 4.x situation log redesign adds collapsible categories, merges related entries, and lets you pin an entry
  into a priority group.
- **The zoom level sets the detail (LOD).** Zoomed out, you see borders, empire colours and aggregate fleet icons. Zoomed in, you
  see hyperlanes, system names and individual icons. Map modes repaint the same map by one attribute.
- **Calm materials.** Thin frames, a dark translucent backing, a small set of consistent icons, and colour used sparingly. Endless Space 2 shows
  the same restraint with thin lines and dense but uncrowded panels.

## 2. Proposal: the node action panel ("the dossier")
**Where it appears: an anchored card next to the tapped node, which docks to a side panel when space is tight.**
- On the Surface (touch), the card opens beside the node, on the side facing away from the screen edge, with a thin leader line
  to the node. The camera eases so that the node and the card are both in view. If the card would cover more than about 35% of the
  viewport or overlap the node, it docks as a side panel on the right (Stellaris's selection-panel habit) and the leader line stays.
- On desktop (mouse), the card works the same way. Hover shows a one-line tooltip (name and status) and click opens the card.
  Right-click opens the same card with focus on the action row, the Stellaris "context verbs" habit.
- **No radial menu.** Radials suit 4 to 6 verbs with no data. This panel is mainly a readout (header plus stats) with a short verb row. A radial
  would hide the stats, and its labels get covered by your finger on touch.
- All tappable elements are at least 48x48 px with 8 px gaps. The action row is a single row of icon-and-label buttons, at most 4
  visible, and the rest go under a "..." button.

**Layout, the same for every type.** The header holds a status pip, name, type chip and its parent ("hv1 › room"). Below it are 3 or 4 key
stats with a sparkline where useful. Then a "Below" strip shows the children as small chips, and tapping one drills down. The action row
comes last.

| Node | Key stats | Actions (ranked) | Confirm? |
|---|---|---|---|
| **Site / star** (main host, HV1/HV2, cloud, home, remote) | rooms up/total, CPU/RAM, pool health, last backup | 1 Open site (fly in) · 2 What's below (rooms list) · 3 Open in board · 4 Pin to screen | none |
| **Room / planet** (VM/CT) | state, CPU/RAM/disk, uptime, backup age, open alerts | 1 View logs · 2 Open in board · 3 What's below (services) · 4 Pin · 5 Open terminal (deep link) · *later (C6):* Restart a service (on its moon) · *"Restart room": not on the Wall* | Terminal: none (it only opens a link) |
| **Builder** (agent runner) | active lanes, current run, last commit, round/cap | 1 View run log · 2 What's below (lanes) · 3 Open in board · 4 Pin · *later (C6):* Pause all lanes | Pause all: **confirm** |
| **Service / moon** | active/failed, restarts 24h, last log line | 1 View logs · 2 Open in board · 3 Pin · *later (C6):* Restart service | Restart: **confirm** (hold to confirm) |
| **Lane / moon** | phase, elapsed, tests green/red, PR | 1 View log · 2 Open PR/board · 3 Pin · *later (C6):* Pause/Resume lane | Pause: light confirm (undo toast); Resume: none |
| **Alert (on any node)** | severity, since, source | 1 Fly to source · 2 View logs · *later (C6):* Snooze 1h/4h · Acknowledge | Snooze/Ack: none, with a 10 s undo toast |

How the C6 buttons look in this slice: they are drawn in the action row as outlined, disabled ghosts labelled "C6". They take up their
real slot so the layout does not shift later. Tapping one shows a tooltip, "coming with cockpit C6". **Heavy actions** (restarting or
stopping a whole room, anything on a host) are **never on the Wall**. At most there is a "Open in Proxmox ›" deep link.

**Confirm patterns for C6.** A *hold-to-confirm* button (a ring fills over 1.2 s) works for touch and mouse and cannot be fired by a stray tap. It
covers restarting a service and pausing a whole builder. *Undo toast* (10 s, bottom centre) covers snooze, ack, and pausing a single lane. There are
no modal dialogs on an ambient wall.

**How it closes.** Tap empty space, tap the same node again, swipe the card away (touch), press Esc (mouse), use the "×" in the header (48 px), or let it idle for
**60 s**, after which the card fades and the camera drifts back to the ambient orbit. Pinned nodes are the exception and keep a mini chip on screen (see 3).

**How it stays calm.**
- The card uses the grey glass of the calm palette, and the per-site tint appears only as a 2 px header edge. Status colour shows only on the pip and on the stat
  that is off (crit red, warn amber, low blue), never as a filled panel.
- It opens with a 150 ms fade and scale and plays no sound. Sparklines are grey unless out of range. The action row is quiet outline buttons,
  and only the top-ranked action is filled (e.g. "View logs" when the node is red).
- Opening a card dims the rest of the galaxy by about 20% instead of adding chrome.

## 3. Other ideas worth stealing
1. **Alert tray (Stellaris alert row).** A thin strip of severity-framed icons at the top edge that is empty when everything is fine. Tapping one flies to the node
   and opens its card. *Gamification that fits:* when the tray stays empty the strip shows a small "clear for 3 d 4 h" streak, which is
   a reward for calm rather than for clicks.
2. **Outliner drawer.** A collapsible right-edge list grouped by site → rooms/builders, each row with a status pip. Tapping a row flies the
   camera there, and groups fold. *Gamification:* a per-site "all green" seal on the group header.
3. **Situation log.** A journal drawer of recent events (deploys, merged PRs, alerts resolved, backups done) grouped into
   Urgent / Ongoing / Done, with related entries merged and pinnable. *Gamification:* finished agent nights read as completed
   "projects" with a short outcome line, the way Stellaris logs a finished special project.
4. **Top resource bar.** A slim strip with 5 or 6 fleet totals (rooms up, lanes running, alerts, PBS last-good age, tailnet nodes), each with
   a trend arrow, and tapping one shows the breakdown, like nested tooltips. *Gamification:* "empire" numbers that are real ops health.
5. **Map modes and zoom LOD.** A small mode switcher (Status · Backups · Load · Agents) that repaints the same galaxy. Labels appear only
   past a zoom threshold, and at galaxy zoom clusters aggregate into a single worst-status pip. *Comparables:* the Homeworld 3 sensors manager
   is a flat 2D tactical map you toggle into, which would make a good "flat map" mode for quick picking. EVE's overview plus its selected-item
   window shows that a sortable list next to a single-selection action box scales to hundreds of objects. Endless Space 2 shows that thin
   lines keep dense panels calm.

## 4. Mockup (anchored card, room selected, 48 px buttons)
```
            ●  <- node (planet "web")
             \
  ┌───────────\──────────────────────────────── × ┐
  │ ● web        ROOM · VM 104     hv1 › rooms │
  ├─────────────────────────────────────────────── ┤
  │ CPU 12% ▁▂▁▃▂   RAM 6.1/8 G   up 9 d          │
  │ backup 6 h ago  ·  alerts 1 warn (disk 82%)   │  <- only "82%" amber
  ├─────────────────────────────────────────────── ┤
  │ Below: [nginx ●] [api ●] [worker ▲] [+3]      │  <- chips 48 px tall
  ├─────────────────────────────────────────────── ┤
  │ [▣ View logs] [⇱ Board] [📌 Pin] [ ⋯ ]         │
  │ ┆ ↻ Restart svc  C6 ┆  ┆ ⌛ Snooze  C6 ┆       │  <- ghost, disabled
  └─────────────────────────────────────────────── ┘
     Terminal ›  Proxmox ›  (deep links in "⋯")
```

## 5. Sources
- Stellaris wiki, Beginner's guide (top bar, outliner, alerts, sidebar): https://stellaris.paradoxwikis.com/Beginner%27s_guide
- Dev Diary #154, UX design in Stellaris: https://forum.paradoxplaza.com/forum/developer-diary/stellaris-dev-diary-154-ux-design-in-stellaris.1244013/
- Dev Diary #292, Concepts / nested tooltips: https://forum.paradoxplaza.com/forum/developer-diary/stellaris-dev-diary-292-3-7-4-released-and-concepts.1576269/
- Console Edition Dev Diary #78, outliner tabs: https://forum.paradoxplaza.com/forum/developer-diary/stellaris-console-edition-development-diary-78-outliner-improvements.1803094/
- Dev Diary #417, situation log redesign (summary): https://patched.gg/games/stellaris/stellaris-dev-diary-417-situation-log-updated
- Nested tooltips in 3.8: https://www.gamewatcher.com/stellaris-3-8-update-release-date
- PC Gamer, "Why I love Stellaris' slick interface": https://www.pcgamer.com/why-i-love-stellaris-slick-interface/
- CGM review (galaxy map, zoom): https://www.cgmagonline.com/review/game/stellaris-pc-review/
- TheSixthAxis console review (notification overload): https://thesixthaxis.com/2019/02/22/stellaris-console-edition-review
- Steam thread, outliner split debate: https://steamcommunity.com/app/281990/discussions/0/3975051032845761844
- Steam thread, log "go to" / "track on map": https://steamcommunity.com/app/281990/discussions/0/3423311880030940666
- Homeworld 3 sensors manager: https://www.cogconnected.com/review/homeworld-3-review/ and https://store.epicgames.com/news/homeworld-3-guide-15-tips-to-help-you-succeed-in-the-campaign
- EVE overview: https://wiki.eveuniversity.org/User:Paul_knuth/New_Overview and https://massivelyop.com/?p=415174
- Endless Space 2 UI: hudsandguis.com (Endless Space 2 article) and https://gamingtrend.com/feature/reviews/should-have-sent-a-poet-endless-space-2-review/

Caveats: the Paradox forum pages were behind a browser check and could not be fetched. Those points come from search
summaries and general familiarity with the game. The descriptions of the galaxy-map right-click verbs, map modes and zoom LOD
come from general knowledge of the game, not from a fetched page. The 4.4 situation log was a planned design when written up.
