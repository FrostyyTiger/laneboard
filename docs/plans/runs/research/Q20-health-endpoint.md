# Q20 — What a small read-only health endpoint returns, and what it must not leak

## Answer

- The one field everyone agrees on is `status`. Machines read the HTTP status code (200 healthy, 503 not), the body is for humans.
- The IETF draft (`application/health+json`) requires only `status` (`pass`/`fail`/`warn`, with `ok`/`up` and `error`/`down` as aliases). `version`, `releaseId`, `checks`, `links`, `notes`, `output` are optional. The draft expired in April 2022 and was never a standard.
- A stranger-facing endpoint should say `ok` and little else. Spring Boot's actuator hides details by default (`show-details=never`). Kubernetes keeps component names in `?verbose`, which is for operators.
- For laneboard's `{ok, version, mode}`: `ok` and `mode` are fine. `version` is the only borderline field. A package version is public here (the repo is public), but it still tells a stranger which bugs to try. Never add paths, hostnames, state dir, config path, lane or run names, or error text.

## Details

### IETF draft (draft-inadarei-api-health-check-06)
- Media type `application/health+json`.
- `status` required, case-insensitive: `pass` (aliases `ok`, `up`), `fail` (`error`, `down`), `warn`.
- Status code: pass and warn need 2xx/3xx, fail needs 4xx/5xx. The code applies to the whole component, so load balancers can use it without parsing.
- Optional top level: `version` (public version), `releaseId`, `notes` (array), `output` (raw error text for fail/warn, omit for pass), `checks` (map `component:measurement` to an array of objects), `links`, `serviceId`, `description`.
- Security section: health data can help an attacker plan, so the endpoint may need authentication and role-based access. It prescribes no mechanism.
- Status: individual Internet-Draft, published 2021-10-16, expired 2022-04-19, "Informational". Not endorsed by the IETF.

### Kubernetes API server
- `/livez` (restart me?), `/readyz` (send traffic?), `/healthz` deprecated since v1.16.
- Machines rely on the status code: 200 is ok, 500 means failed.
- `?verbose` lists `[+]name ok` per check and ends `healthz check passed`. The page says this is for humans, not machines.
- The page says nothing on exposure. Not confirmed from the page: the plain-request body is the single word `ok` (widely known, not shown on the page).
- Split worth copying: liveness is "the process answers", readiness is "dependencies are ok". Laneboard's endpoint is liveness only.

### Spring Boot actuator `/actuator/health`
- Status to HTTP: `UP` and `UNKNOWN` give 200, `DOWN` and `OUT_OF_SERVICE` give 503.
- `show-details` default `never`, other values `when-authorized` and `always`. Spring Security leaves `/health` open and secures the other endpoints.
- Body: the page has no sample. From general knowledge, not confirmed on the page: with details hidden it is `{"status":"UP"}`.
- Guidance: keep external-dependency checks out of liveness, so a failing dependency does not cause restarts.

## What others do, and what laneboard can take

- Take: `status` as the primary signal, status code as the machine contract, details off by default, no error text on the open endpoint.
- Suggested for T8 (the builder decides):
  - 200 `{"ok":true,"version":"<package version>","mode":"<mode>"}`, `content-type: application/json` (plain JSON is fine, the draft is expired).
  - `ok:false` with 503 only if the board can tell it is unhealthy. If it cannot, always answer 200 (the process answering is the proof).
  - GET and HEAD only. Other methods should get the normal JSON 404 or 405.
  - `Cache-Control: no-store`.
  - Test that the body keys are exactly `ok`, `version`, `mode`. Test that it contains no `/` path separators and no home or state directory.
- Optional: do not rename `ok` to `status`. Compatibility with the draft is not worth it, since no tool consumes it here. One line in the docs saying "not `application/health+json`" is enough.
- Not confirmed: whether `mode` could reveal anything sensitive. Check what values it takes in `server/boot/builder.mjs`. If it is one of a few fixed words, it is fine.

## Sources

- https://datatracker.ietf.org/doc/html/draft-inadarei-api-health-check (read 2026-10-21)
- https://kubernetes.io/docs/reference/using-api/health-checks/ (read 2026-10-21)
- https://docs.spring.io/spring-boot/reference/actuator/endpoints.html (read 2026-10-21; the last ~19k characters of the page were not read)
