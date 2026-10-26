# Product direction

**Status: standing guidance.** Every plan, every loop night and every PR reads this first. It
does not replace the plans in `docs/plans/`; it says how to choose between them and how to build
whatever gets chosen.

## 1. The one-liner

**laneboard is mission control for agents that work while you sleep, and the machines they run
on.**

The agents come first. Plenty of dashboards show servers (Homepage, Homarr, Glance, Grafana,
Uptime Kuma); almost nothing answers "what did my agents do overnight, what did it cost, and where
are they stuck?" The Map, the feeders and the Wall are the setting that makes those answers
legible, not a second product.

## 2. Who it is for

Roughly **70 % the owner, 30 % everyone else.**

- **Use decides what gets built.** If the owner would not use a feature on the board, on the Wall
  or in the morning, it does not get built, however good it would look in a feature table.
- **The product side decides how it gets built.** Built the right way, a feature for one homelab
  is also a feature for strangers, at little extra cost. Section 3 is that way.

## 3. The working rule: built for one, never tied to one

1. **Nothing about one fleet in the code.** Hosts, rooms, sites and topology live in config and
   feeds, never in source. When a change touches something that assumes one setup, it moves that
   assumption into config in the same PR. `test/hygiene.test.mjs` stays green.
2. **Every feature ships with demo data.** The demo (`npm run demo`, later a static page) shows
   each view populated. A feature without demo data is not done, because the demo is how a
   stranger meets it and the public demo must never show a real fleet.
3. **New sources are feeds, even with one user.** A new thing on the Map (a printer, a home
   automation hub, a UPS, a CI provider) comes in through the generic feed fields (`glow`, `ring`
   and the snapshot format), not through a special case in core. The feed API grows from real
   feeds instead of being designed up front.
4. **Every feature lands with its doc page** in `docs/`, short, in the style of `docs/map.md`.
   Docs accumulate; they never become a project of their own.
5. **Safe by default.** Read-only display modes (the Wall, a hub before review) stay read-only
   unless config says otherwise. Anything reachable beyond `127.0.0.1` needs authentication in
   front of it. The trust model in `docs/plans/runs/README.md` §2 is unchanged.
6. **Never an empty screen.** A view with nothing to show says what it would show and how to feed
   it, or falls back to demo data clearly labelled as such.

## 4. What to do, in what order

### Now (cheap, helps both sides)

| Item | Done when |
| --- | --- |
| **Public-repo hygiene pass** | Tree and history checked for hosts, addresses, names and tokens beyond what the hygiene test catches; findings fixed or listed. Before any public post. |
| **Hosted demo** | `galaxy.html?demo=1` (the Wall) and the main views served as a static page from demo data only. |
| **Tour video / GIF** | 20 seconds of the Wall touring a demo fleet, finding a crit and flying to it. Top of the README. |
| **README around the agents story** | Opens with the one-liner and the GIF; a short "why not Grafana / Homepage" section; the views table stays below. |

### Folded into the owner's own work

These get built because the owner wants them, following section 3:

- Feeds the owner actually uses (home automation, 3D printer, UPS), each as a feed with a doc page
  and demo data.
- Morning and Stuck that answer "what happened overnight?" in one glance, plus an optional push
  when something needs a human.
- The Wall on a spare tablet: kiosk guide (`docs/wall.md`) and read-only mode.

### Deferred until people ask

Signals that it is time: issues, stars, people asking how to install it, someone writing their own
feed.

- One-command install (`npx laneboard`, a Docker image) with auto-discovery of Tailscale, Proxmox
  and Docker.
- A run-protocol SDK so loops other than ours can report runs.
- A documented, versioned feed API with examples beyond our own feeds.
- Proxmox helper script, Unraid template, awesome-selfhosted listing.
- Versioned releases with Docker images (the CHANGELOG already exists).

### Not now

- Themes for the Wall effects.
- A hosted relay or any paid tier.

## 5. Distribution

One post once the "Now" table is done: the video on r/selfhosted or r/homelab, or a Show HN. Then
watch what comes back before investing in the deferred list. No second post until something new
is worth showing.

## 6. For loop nights

A loop night that picks its own tasks prefers, in order: an unfinished "Now" item, then whatever
the current part plan says, then a "folded in" item. It never starts a "deferred" or "not now"
item; those go on the "for the owner" list.
