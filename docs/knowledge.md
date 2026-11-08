# Knowledge

`#/knowledge?product=<id>`, opened from a card on [Products](products.md): what a
run engine knows about a product. Read-only.

One card per item, with filters for kind and status:

| Kind | Shows |
| --- | --- |
| requirement | title, status, its sections, the claims it stands on |
| question | the question, status, what it blocks, what answered it |
| claim | the statement, confidence, the sources it cites |
| source | kind, date, the engine's summary |

Each id is a link to that item, and a card lists what is **used by** it, so you
can follow a link and come back. A reason on a product card opens its item here.

**Never raw sources.** The engine sends source headers and summaries only, and
laneboard drops a `ref` or a body if one arrives. This page also leaves out
evidence quotes and who a source came from.

**Not for shared screens.** The Wall has no link here. laneboard has no kiosk
token yet, so nothing can refuse one: whoever can open the board can open this
page. Keep a kiosk on `/galaxy.html` and behind its own login.

`{ "engines": [{ "id": "main", "kind": "fake" }] }` shows an invented shop.
