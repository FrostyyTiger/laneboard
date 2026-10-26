# Cockpit: input for the spec night

What the owner said and decided in the conversation that produced this plan (2026-10-26), written
down so the spec night starts from it and nothing lives only in a chat. The plan
(`README.md`) is the structure; this file is the detail and the intent behind it. Where the two
disagree, ask the owner.

## 1. Where the owner is coming from

- A touch screen sits on the desk, slightly below the main monitor and slightly slanted. It is
  **the one place** to see how the infrastructure, the projects and the agent loops are doing.
- The owner struggles to keep an overview. In a terminal they can ask an agent anything and get it
  done fast, but **cannot see** anything. "If there's no visual overview, it's hard for me to come
  up with new ideas."
- Today, for almost everything except turning a light on, the owner just asks an agent, because
  that is fastest. The cockpit should keep that speed and add the picture.
- Expectation for the future: many more VMs and machines, especially for agent loops, in the cloud
  and at home. Big clouds do not serve this well. Keep the design ready for many machines and
  mixed cloud/local fleets.

## 2. The screens

- **Screen 1, tour and explore.** Idles on the Wall: it tours the fleet, flies to trouble, shows
  status ("a cool screensaver that jumps around"). A tap leaves the tour and lets the owner
  navigate around the infrastructure.
- **Screen 2, canvas.** Where the owner talks to the agent and the agent shows things: timers,
  charts, logs, whatever helps. "Almost like a sandbox screen world where you can show me things."
- More screens will come. Every screen is a window only. Any screen can be tour, explore or
  canvas. A user with one screen gets both, split or switching.
- The owner **uses laneboard to watch**, not to start agents. Agent loops are started from a laptop
  or another computer, as today. The cockpit shows them and answers questions about them.

## 3. The agent: an infrastructure coworker

- Lives on its own always-on machine (a VM in the owner's case), **not** on a screen, **not** on the
  laptop (which is not always on), **not** inside the hub.
- For other users: everything (board plus agent) must also run on **one machine**. The split is an
  option, not a requirement.
- It can see everything: what is running, what is not, how things are going.
- It answers ("how is it going?", "is the stuff working?"), it manages (stop and start things, e.g.
  over SSH), and it can **set up scripts and timers on its own machine** ("shut this off in 3
  hours" → it schedules that itself).
- It **speaks up** on its own when something needs the owner, not only when asked.
- The laptop keeps its own full access, as today. Two agents, each able to see everything; they
  share knowledge through what is written down, not one conversation.

## 4. Talking to it

The owner's reference experience is the terminal's hold-to-talk today: hold a key, watch the words
appear live as they speak, release, and the agent gets the prompt and answers in text. "In the
terminal it works really well."

- On the screen there is no key, so a **button**: tap to start and tap to send, or hold and release.
  Both should work.
- Later, a **physical button** on the desk does the same.
- Words appear **live** while speaking. On release (or the second tap) the text is sent.
- Answers: **always shown as text.** Speaking the answer aloud would be nice, as an extra.
- **Typing must always work too**: many users will prefer it.
- Languages: English and German. A DE/EN choice in the UI beats auto-detect on short clips
  (research finding). Swiss German speakers are fine with Standard German text.
- Speech-to-text runs in the owner's always-on inference room (not on the gaming GPU, which is not
  always available). Research pick: WhisperLiveKit (faster-whisper, large-v3-turbo, int8);
  fallback: an NVIDIA streaming model. A hands-on test is running; see the owner's homelab docs.

## 5. The canvas

- The agent has "the entire world's toolbox" and can code anything, but **it must be fast**: a
  timer must not take 5 minutes. It does not have to be instant, but close.
- Answer: a kit of ready-made blocks (seconds), custom sandboxed cards for the rest (about a
  minute), and promotion of useful custom cards into the kit.
- A timer the agent sets ("in 3 hours") is a live countdown bound to the real job, with cancel.

## 6. Rules the owner agreed to

- **Look freely, change only with a yes.** Anything that changes state shows a confirm on the
  screen; every action is logged.
- **Scheduled jobs are visible**: on the board and on the canvas, cancellable. No hidden timers.
- **The infrastructure repo is the source of truth.** The agent's machine pulls it automatically
  (read-only key) so it always knows the intended state. Comparing intended with running (drift)
  is one of its standing jobs. Whoever changes something writes it down in the same place; the
  agent's own changes arrive as a branch or a small PR the owner merges.
- Not tied to one VPN: a tailnet is the owner's way; auth in front, device tokens or LAN-only are
  others.

## 7. Questions the spec night must answer or put to the owner

1. What exactly happens when Talk is pressed while the agent is still answering? (Interrupt,
   queue, or ignore?)
2. One conversation forever, daily fresh starts, or a "new" button only? What carries over?
3. Which kit blocks are in version 1? (Proposed: timer, countdown, chart, table, live log,
   checklist, status tile, map focus.)
4. How do canvas cards leave: dismissed by hand, expire, or both? How many fit at once?
5. When the agent speaks up, how loud: a line in the conversation, a card, a sound, a spoken
   sentence? Quiet hours?
6. What does each screen show when the agent's machine is down?
7. Which actions are in the first "act" list, and which always need a confirm? (After the
   control-plane review.)
8. Does the physical button target one screen, the last-used screen, or all?
9. Screen sizes and orientation to design for (the owner's tablet is landscape, touch only).

## 8. Order agreed for the whole product

Wall finishes → Wall PRs merge → demo mode revived (all current views) → public-repo hygiene pass
→ hosted demo, video, README → cockpit: spec night, owner Q&A, then C1 Talk and C2 Voice in.
