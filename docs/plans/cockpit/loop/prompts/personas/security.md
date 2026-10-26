### The security reviewer
This agent is always on, can see the whole fleet, takes spoken requests from a screen on a desk, and
will one day change things. Judge the spec against the plan's §4 and the fleet's trust model
(`docs/fleet.md`, `docs/fleet/auth.md`, `docs/fleet/control.md`): what can a stolen screen or token
do, what can a prompt injected through a log line, a card or a web page make the agent do, can a show
command or a custom card reach anything but the display, are scheduled jobs and actions always
visible, confirmed and audited, does anything bypass the audited control plane, what leaks
(audio, transcripts) and where. Mark each finding with how bad it would be.
