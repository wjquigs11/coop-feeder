# Coop Feeder HTTP API

This document describes the HTTP endpoints exposed by the coop feeder's
ESP32 web server that an external client (for example a phone app) can use to
read feeder state and change configuration. It is intended for clients that are
not the built-in browser UI.

## Base URL

The device serves HTTP on port `80`. Reach it by IP address or by mDNS
hostname:

```
http://<device-ip>/
http://coopfeeder.local/          # default mDNS name (hostname is configurable)
```

- The mDNS name is derived from the configured hostname (see `/config`), lower
  cased and sanitized to `a-z`, `0-9` and `-`. The default hostname is
  `coopfeederBETA`.
- In AP (access point) mode the device is reachable at its soft-AP IP instead.

## CORS

`GET` endpoints send permissive CORS headers (`Access-Control-Allow-Origin: *`),
and `OPTIONS` preflight requests are answered with `204`. A native phone app
making direct HTTP calls does not need CORS, but a browser-based or hybrid app
will work cross-origin.

---

## Getting feeder state

### GET `/readings`

Primary endpoint for reading current feeder state. Returns the full state
object as JSON.

**Response** `200 application/json`

```json
{
  "loadcell": "72",
  "units": "%",
  "lastUpdate": "1740000000000"
}
```

| Field        | Type              | Description                                                                                 |
|--------------|-------------------|---------------------------------------------------------------------------------------------|
| `loadcell`   | string (integer)  | Current feed level, `0`–`100`. Mapped from the raw load cell reading between the empty and full calibration offsets. |
| `units`      | string            | Unit for `loadcell`. Currently `"%"`.                                                       |
| `lastUpdate` | string (integer)  | Timestamp of the last reading, in **milliseconds since the Unix epoch**. See note below.    |

Notes:
- All values are serialized as JSON **strings**, not numbers. Parse them
  client-side (e.g. `parseInt`).
- Fields only appear once the device has taken at least one reading. Before the
  first reading the object may be empty (`{}`).
- `lastUpdate` is only a true Unix timestamp if a client has posted the current
  time via `POST /browsertime` (see below). The ESP32 has no real-time clock, so
  until then it falls back to the device uptime (`millis()`), which is **not** a
  wall-clock time.

### GET `/weight`

Lightweight endpoint returning just the current feed level as plain text.

**Response** `200 text/plain`

```
72
```

The value is the same `loadcell` figure (`0`–`100`) returned by `/readings`,
without units or timestamp. Useful for a quick poll when you only need the level.

### GET `/host`

Returns device identity information as human-readable plain text (not JSON).

**Response** `200 text/plain`

```
hostname: coopfeederBETA, ESP local MAC addr: AA:BB:CC:DD:EE:FF
```

Contains the current hostname and the ESP32's Wi-Fi MAC address. Handy for
device discovery / identification. The format is a plain string, so parse it
loosely.

---

## Live updates (Server-Sent Events)

### GET `/events`

A Server-Sent Events (SSE) stream. Instead of polling `/readings`, a client can
subscribe once and receive pushes whenever the device takes a new reading.

- Event name: `new_readings`
- Event data: the same JSON payload as `GET /readings`
- On connect, the device immediately sends one `new_readings` event so the
  client is populated right away.
- The push cadence is governed by the device's timer delay (see the `webtimer`
  parameter of `/config`).

Example (browser `EventSource`):

```js
const es = new EventSource("http://coopfeeder.local/events");
es.addEventListener("new_readings", (e) => {
  const state = JSON.parse(e.data);
  console.log(state.loadcell, state.units, state.lastUpdate);
});
```

For a native phone app, use any SSE-capable HTTP client, or fall back to polling
`/readings` on an interval if SSE is inconvenient.

---

## Configuration and calibration

### GET `/config`

Changes device settings. Despite modifying state, it uses `GET` with query
parameters. Send exactly one parameter per request; the first recognized one is
applied. Returns a plain-text confirmation message.

**Response** `200 text/plain` (e.g. `"change web timer to 2000"`, or `"none"`
if no recognized parameter was supplied).

| Parameter  | Example                        | Effect                                                                                          |
|------------|--------------------------------|-------------------------------------------------------------------------------------------------|
| `hostname` | `/config?hostname=henhouse`    | Sets the device hostname (also affects the mDNS name). Persisted to flash.                      |
| `webtimer` | `/config?webtimer=2000`        | Sets the reading/update interval in **milliseconds**. Clamped to `0`–`10000`; `<0` resets to the default (`1000`). Persisted. |
| `empty`    | `/config?empty=1`              | Runs the "empty feeder" calibration (captures the current raw load cell reading as the empty offset). Persisted. |
| `full`     | `/config?full=1`               | Runs the "full feeder" calibration (averages several raw readings as the full offset). Persisted. |

The `empty` / `full` parameter values are ignored — only presence matters.
Confirmation messages include the resulting offset values, for example
`"empty calibration successful, empty raw offset is 12345"`.

### POST `/browsertime`

Supplies the device with a wall-clock time reference so that `lastUpdate` in
`/readings` becomes a real Unix timestamp. The ESP32 has no RTC, so a client
should send this once after connecting (and periodically if desired).

**Request body** `application/json`

```json
{
  "localTime": "2026-08-24T10:00:00",
  "timezone": "America/New_York",
  "offset": -240,
  "timestamp": 1740000000000
}
```

| Field       | Type            | Description                                              |
|-------------|-----------------|----------------------------------------------------------|
| `timestamp` | number          | Current time in **milliseconds since the Unix epoch**. This is the value the device actually uses as its clock base. |
| `localTime` | string          | Human-readable local time (logged only).                 |
| `timezone`  | string          | IANA timezone name (logged only).                        |
| `offset`    | number          | UTC offset in minutes (logged only).                     |

**Response** `200 text/plain` — body `"Time received"`.

Only `timestamp` affects behavior; the other fields are logged for diagnostics.

---

## Endpoint summary

| Method | Path           | Response type      | Purpose                                   |
|--------|----------------|--------------------|-------------------------------------------|
| GET    | `/readings`    | `application/json` | Full feeder state (level, units, time)    |
| GET    | `/weight`      | `text/plain`       | Current feed level only (`0`–`100`)       |
| GET    | `/host`        | `text/plain`       | Hostname + MAC address                    |
| GET    | `/events`      | SSE stream         | Push updates (`new_readings` events)      |
| GET    | `/config`      | `text/plain`       | Change hostname / timer / run calibration |
| POST   | `/browsertime` | `text/plain`       | Provide a wall-clock time reference        |

## Recommended client flow

1. Discover the device (mDNS `coopfeeder.local` or a known IP).
2. Optionally `GET /host` to confirm identity (MAC address).
3. `POST /browsertime` with the current epoch milliseconds so `lastUpdate`
   reflects real time.
4. Either subscribe to `GET /events` for live `new_readings`, or poll
   `GET /readings` (or `GET /weight`) on an interval.
5. Use `GET /config` as needed to adjust the update interval or run calibration.
