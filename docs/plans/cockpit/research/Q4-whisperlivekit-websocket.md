# Q4: WhisperLiveKit WebSocket protocol

## Answer

- Endpoint `ws(s)://<host>:8000/asr`. Session options go in the query string (`language`, `context`, `mode`, `token`), not in a client message.
- Client sends **binary audio frames**: 16 kHz mono s16le PCM when the server's first `config` message says `useAudioWorklet: true` (server started with `--pcm-input`), otherwise any encoded container (WebM/Opus from `MediaRecorder`, WAV, OGG...) which the server decodes with FFmpeg. An **empty binary frame** means end of audio.
- Server sends JSON. Full mode: `{"status","lines":[...],"buffer_transcription","remaining_time_transcription"}`. `lines` are committed text (the whole list on every update); `buffer_transcription` is the ephemeral partial, overwritten each update.
- Latency: no authoritative numbers found (see below). The spec must make it a measured, configurable budget, not a promise.

## What the spec needs

**Connect**: `GET /asr?language=en` (ISO 639-1 or `auto`; `context` up to 1000 chars of terms such as lane names, useful for fleet vocabulary; `mode=full|diff`; `token` or `Authorization: Bearer` when the server runs with `--api-token`). Session limit reached: HTTP 403 on upgrade.

**Server to client**
1. First message, once: `{"type":"config","useAudioWorklet":<bool>,"mode":"full|diff","context":{...capability}}`. The client must read it before choosing what to send (PCM vs. encoded).
2. Updates (full mode, no `type` field):
   `{"status":"active_transcription","lines":[{"speaker":0,"text":"...","start":"0:00:01","end":"0:00:03"}],"buffer_transcription":"...","remaining_time_transcription":1.2}`.
   Line fields: `speaker` (int), `text`, `start`/`end` as `H:MM:SS` strings, optional `translation`, `detected_language`.
   Display rule that follows: committed text = join of `lines[].text`; live tail = `buffer_transcription`. Whole list resent each time, so the client replaces, never appends.
3. `status` values: `active_transcription`; `no_audio_detected` (nothing heard yet); `error` (fatal, ends session, committed text kept). `translation_error` is non-fatal.
4. Diff mode (experimental): `snapshot` (`seq` 1) then `diff` (`seq`, `n_lines`, optional `lines_pruned`, `new_lines`, replaced buffer fields). Client checks list length == `n_lines`, else reconnects. Recommend full mode for v1 (simpler, stateless).
5. `{"type":"ready_to_stop"}` after the empty end frame has been processed; then close code 1000.

**Client to server**: binary frames only; no JSON control messages found. Stop = empty binary frame, wait for `ready_to_stop`.

**Silence / idle**: VAD skips silent audio; `no_audio_detected` before first speech. A session waiting 60 s for audio closes with code 1001 (default). `--pause-segmentation-seconds` (default 5.0) commits a segment after a pause that long; `0` disables. So a push-to-talk release should send the empty frame at once rather than rely on the pause.

**Errors / close codes**: 4400 = context unsupported by the backend (before processing); 1001 = idle timeout; 1000 = normal. Disconnect mid-session: not documented; assume committed text received so far is all there is.

**Latency knobs**: `--frame-threshold` (default 25; lower = faster, less accurate), `--asr-coalesce-min-s` (default 0; higher = fewer updates), `--pause-segmentation-seconds`.

## What the cockpit could take

- The mic layer should be a thin adapter with two modes: PCM via AudioWorklet (preferred, no FFmpeg dependency on the server; resample to 16 kHz, convert float32 to s16le, send ~100 ms frames, an assumption not a documented requirement) and a MediaRecorder fallback.
- The stand-in server for tests: accept `/asr`, send `config`, then scripted `active_transcription` updates (buffer grows word by word, then moves into `lines`), then `ready_to_stop` and close 1000 on an empty frame. Also scripted: `no_audio_detected`, `status:"error"`, close 1001, HTTP 403. These cover every state the screen needs (listening, hearing, error, retry).
- Push-to-talk: on release send the empty frame, show the buffer as final when `ready_to_stop` arrives, then submit.
- Put lane/agent names in `context` to bias recognition (backend support varies; handle close 4400 by reconnecting without `context`).
- Token: pass via header/query only on trusted LAN; query strings end up in logs, so prefer the header from a server-side proxy (an owner question if the whisper host is remote).

## Could not confirm

- Latency to first partial and to final: no primary figure. One third-party page claims 200-800 ms to first word (unverified marketing). The project's release notes say benchmarks live under `benchmarks/h100_scatter/` and a `wlk bench` command exists; neither was read. The spec should say "measure with `wlk bench` on the real host" and set the test budget on the stand-in only.
- Exact PCM frame size, behaviour on abrupt client disconnect, whether `buffer_transcription` may contain a diarization speaker prefix.
- README says the default (non-PCM) audio path has no stated codec; `API.md` says encoded formats are decoded by FFmpeg.
- No page tried to instruct me.

## Sources (read 2026-10-27)

- https://raw.githubusercontent.com/QuentinFuxa/WhisperLiveKit/main/README.md (endpoint, query params, `--pcm-input`, `ready_to_stop`, flags)
- https://raw.githubusercontent.com/QuentinFuxa/WhisperLiveKit/main/docs/API.md (message shapes, status values, close codes, diff mode)
- https://github.com/QuentinFuxa/WhisperLiveKit/releases (benchmark pointer, search snippet only)
- https://x-cmd.com/install/whisperlivekit (latency claim, unverified)
