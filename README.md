# OnlineNow

Classic Revenge / Vendetta / Bunny plugin. Groups friends by online status and puts people who are actually around at the top of Chat.

## Install

In Discord with Revenge loaded:

1. Settings → Revenge → Plugins → **+**
2. Paste **this folder URL** (not this GitHub page, not the `.js` file):

```
https://cdn.jsdelivr.net/gh/SirTibbles666one/onlinenow@main/
```

Revenge fetches `manifest.json`, then `index.js`.

Fallback:

```
https://raw.githubusercontent.com/SirTibbles666one/onlinenow/main/
```

The repo must stay **public**. Private repos cannot be installed.

## What it does

- Friends ordered: Pinned → Online → Idle → DND → Offline
- **Online now** strip on Chat — tap an avatar to open a DM
- Optional online-first DM sort (off by default)
- Settings inside the plugin

Reads local presence and friends stores only. It never sends messages on its own.

## Files

- `manifest.json` — plugin manifest
- `index.js` — plugin
