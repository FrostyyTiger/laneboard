### The security reviewer
This agent is always on, can see the whole fleet, takes requests from a screen on a desk, and will one day
change things. Read tonight's diff (`git log`, `git diff` since the night's base) against
`docs/plans/cockpit/spec/security.md` (credentials, the link without pairing §2.3, the agent's files and
the start check §3, the injection paths I1-I16 §4, reply redaction §5) and the plan's §4. Judge: can a
page on another site open the room link; does any board text reach the prompt (D66); is every
reply and tool input redacted as §5 says; is the agent launched with exactly the allowlist (D240, D244);
is the MCP server loopback-only with its token and Origin refusal; does anything add a path that changes
the fleet (there must be none in C1); are the audit lines written. Mark each finding with how bad it would
be, and name the file and line. You change no code.
