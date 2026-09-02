(plugin = (function () {
  "use strict";

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var bunnyApi =
    (typeof bunny !== "undefined" && bunny) ||
    (root && root.bunny) ||
    null;
  var definePlug = typeof definePlugin === "function" ? definePlugin : null;
  var vdGlobal = null;
  try {
    vdGlobal = vendetta;
  } catch (_) {}
  if (!vdGlobal && root) vdGlobal = root.vendetta;

  function vdRequire(id) {
    var vd = vdGlobal || {};
    try {
      if (typeof require === "function") {
        var got = require(id);
        if (got) return got;
      }
    } catch (_) {}
    if (vd && id.indexOf("@vendetta") === 0) {
      if (id === "@vendetta/metro") return vd.metro;
      if (id === "@vendetta/metro/common") return vd.metro && vd.metro.common;
      if (id === "@vendetta/patcher") return vd.patcher;
      if (id === "@vendetta/plugin") return vd.plugin;
      if (id === "@vendetta/storage") return vd.storage;
      if (id === "@vendetta/ui/toasts") return vd.ui && vd.ui.toasts;
      if (id === "@vendetta/ui/components") return vd.ui && vd.ui.components;
      if (id === "@vendetta") return vd;
    }
    if (bunnyApi) {
      if (id === "@vendetta/metro") return bunnyApi.metro || (bunnyApi.api && bunnyApi.api.metro) || vd.metro;
      if (id === "@vendetta/metro/common")
        return (bunnyApi.metro && bunnyApi.metro.common) || (vd.metro && vd.metro.common);
      if (id === "@vendetta/patcher")
        return (bunnyApi.api && bunnyApi.api.patcher) || bunnyApi.patcher || vd.patcher;
      if (id === "@vendetta/plugin") return bunnyApi.plugin || vd.plugin;
      if (id === "@vendetta/storage") return bunnyApi.storage || vd.storage;
      if (id === "@vendetta/ui/toasts")
        return (bunnyApi.ui && bunnyApi.ui.toasts) || (vd.ui && vd.ui.toasts);
      if (id === "@vendetta/ui/components")
        return (bunnyApi.ui && bunnyApi.ui.components) || (vd.ui && vd.ui.components);
    }
    var path = String(id)
      .replace(/^@vendetta\/?/, "")
      .split("/")
      .filter(Boolean);
    var cur = vd;
    for (var i = 0; i < path.length; i++) cur = cur && cur[path[i]];
    return cur || null;
  }

  var metro = vdRequire("@vendetta/metro") || {};
  if (!metro.findByProps && !metro.find) {
    metro =
      (bunnyApi && (bunnyApi.metro || (bunnyApi.api && bunnyApi.api.metro))) ||
      (root && root.bunny && root.bunny.metro) ||
      (root && root.vendetta && root.vendetta.metro) ||
      metro;
  }
  var findByProps = metro.findByProps;
  var findByStoreName = metro.findByStoreName || (metro.filters && metro.find
    ? function (n) {
        return metro.find(metro.filters.byStoreName ? metro.filters.byStoreName(n) : function (m) {
          return m && m.getName && m.getName() === n;
        });
      }
    : null);
  var findByName = metro.findByName;
  var findByDisplayName = metro.findByDisplayName;
  var common = vdRequire("@vendetta/metro/common") || (metro.common) || {};
  var React = common.React || (root && root.React);
  var ReactNative = common.ReactNative || (root && root.ReactNative);
  var patcher =
    (bunnyApi && bunnyApi.api && bunnyApi.api.patcher) ||
    (bunnyApi && bunnyApi.patcher) ||
    vdRequire("@vendetta/patcher") ||
    (root && root.bunny && root.bunny.api && root.bunny.api.patcher) ||
    {};
  var after = patcher.after;
  var instead = patcher.instead;
  var pluginApi = (bunnyApi && bunnyApi.plugin) || vdRequire("@vendetta/plugin") || {};
  var storage = pluginApi.storage;
  if (!storage && pluginApi && typeof pluginApi.createStorage === "function") {
    try {
      storage = pluginApi.createStorage();
    } catch (_) {
      storage = null;
    }
  }
  if (!storage) storage = {};
  var useProxy = (vdRequire("@vendetta/storage") || {}).useProxy;
  var Forms = (vdRequire("@vendetta/ui/components") || {}).Forms || {};
  var toasts = vdRequire("@vendetta/ui/toasts") || (bunnyApi && bunnyApi.ui && bunnyApi.ui.toasts) || {};

  var e = React && React.createElement;
  var View = ReactNative && ReactNative.View;
  var Text = ReactNative && ReactNative.Text;
  var ScrollView = ReactNative && ReactNative.ScrollView;
  var Pressable = ReactNative && ReactNative.Pressable;
  var StyleSheet = ReactNative && ReactNative.StyleSheet;
  var TextInput = ReactNative && ReactNative.TextInput;

  var debugLog = [];
  function note(msg) {
    debugLog.push(String(msg));
    try {
      storage._debug = debugLog.slice(-40);
    } catch (_) {}
    try {
      console.log("[OnlineNow]", msg);
    } catch (_) {}
  }

  var VERSION = "1.3.1";

  var DEFAULTS = {
    friendsGrouping: true,
    hideOffline: false,
    splitIdle: true,
    splitDnd: true,
    dmOnlineFirst: true,
    dmStrip: true,
    patchDiscordLists: false,
    showNowTray: true,
  };

  for (var k in DEFAULTS) {
    if (storage[k] === undefined) storage[k] = DEFAULTS[k];
  }
  storage._v = 7;
  storage.patchDiscordLists = false;
  storage.showNowTray = storage.showNowTray !== false;
  storage.dmOnlineFirst = true;
  storage.friendsGrouping = storage.friendsGrouping !== false;
  if (!Array.isArray(storage.pinnedIds)) storage.pinnedIds = [];

  var unpatches = [];
  var hooks = [];
  var hookedPairs = [];
  var inFriend = false;
  var inDm = false;
  var presenceGen = 0;
  var presenceTimer = null;

  function toast(msg) {
    try {
      if (typeof toasts.showToast === "function") toasts.showToast(msg);
    } catch (_) {}
    try {
      var Alert = ReactNative && ReactNative.Alert;
      if (Alert && Alert.alert) Alert.alert("OnlineNow", String(msg));
    } catch (_) {}
  }

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      try {
        var v = arguments[i];
        if (typeof v === "function") v = v();
        if (v) return v;
      } catch (_) {}
    }
    return null;
  }

  function byStore(name) {
    try {
      return findByStoreName && findByStoreName(name);
    } catch (_) {
      return null;
    }
  }

  function byProps() {
    var props = [].slice.call(arguments);
    try {
      if (findByProps) return findByProps.apply(null, props);
    } catch (_) {}
    try {
      if (metro.find) {
        return metro.find(function (m) {
          if (!m) return false;
          for (var i = 0; i < props.length; i++) {
            if (m[props[i]] === undefined) return false;
          }
          return true;
        });
      }
    } catch (_) {}
    return null;
  }

  function findFn() {
    var props = [].slice.call(arguments);
    var m = byProps.apply(null, props);
    if (m) return m;
    try {
      if (typeof metro.find === "function") {
        return metro.find(function (mod) {
          if (!mod) return false;
          for (var i = 0; i < props.length; i++) {
            if (typeof mod[props[i]] !== "function" && mod[props[i]] === undefined) return false;
          }
          return true;
        });
      }
    } catch (err) {
      note("findFn " + props.join(",") + " " + err);
    }
    return null;
  }

  function PresenceStore() {
    return pick(function () {
      return byStore("PresenceStore");
    }, function () {
      return findFn("getStatus", "getActivities");
    }, function () {
      return findFn("getStatus", "isMobileOnline");
    });
  }

  function RelationshipStore() {
    return pick(function () {
      return byStore("RelationshipStore");
    }, function () {
      return findFn("getFriendIDs", "isFriend");
    }, function () {
      return findFn("getFriendIDs");
    }, function () {
      return findFn("getFriendIds");
    });
  }

  function ChannelStore() {
    return pick(function () {
      return byStore("ChannelStore");
    }, function () {
      return findFn("getChannel", "getDMFromUserId");
    }, function () {
      return findFn("getDMFromUserId");
    }, function () {
      return byProps("getDMFromUserId");
    }, function () {
      return byStore("PrivateChannelStore");
    });
  }

  function UserStore() {
    return pick(function () {
      return byStore("UserStore");
    }, function () {
      return findFn("getUser", "getCurrentUser");
    }, function () {
      return byProps("getUser", "getCurrentUser");
    });
  }

  function asArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    try {
      if (typeof x.toArray === "function") return x.toArray();
    } catch (_) {}
    try {
      if (typeof x.length === "number") return Array.prototype.slice.call(x);
    } catch (_) {}
    return [];
  }

  function friendId(x) {
    if (x == null) return "";
    if (typeof x === "object") return String(x.id || x.userId || x.user_id || "");
    return String(x);
  }

  function statusOf(id) {
    try {
      var p = PresenceStore();
      var s = p && p.getStatus && p.getStatus(String(id));
      if (s === "online" || s === "idle" || s === "dnd") return s;
    } catch (_) {}
    return "offline";
  }

  function rank(status) {
    if (status === "online") return 0;
    if (status === "idle" && storage.splitIdle) return 1;
    if (status === "dnd" && storage.splitDnd) return 2;
    if (status === "idle" || status === "dnd") return 0;
    return 3;
  }

  function rankUser(id) {
    return rank(statusOf(id));
  }

  function isPinned(id) {
    return (storage.pinnedIds || []).indexOf(String(id)) !== -1;
  }

  function isPinnedChannel(id) {
    if (isPinned(id)) return true;
    try {
      var cs = ChannelStore();
      var ch = cs && cs.getChannel && cs.getChannel(String(id));
      if (ch && (ch.isPinned || ch.pinned || ch.is_pinned)) return true;
    } catch (_) {}
    try {
      var pin = byProps("isPrivateChannelPinned") || byProps("getPinnedPrivateChannelIds");
      if (pin && typeof pin.isPrivateChannelPinned === "function" && pin.isPrivateChannelPinned(String(id))) {
        return true;
      }
      if (pin && typeof pin.getPinnedPrivateChannelIds === "function") {
        var pins = pin.getPinnedPrivateChannelIds();
        if (pins && pins.indexOf && pins.indexOf(String(id)) >= 0) return true;
      }
    } catch (_) {}
    return false;
  }

  function togglePin(id) {
    id = String(id);
    var cur = (storage.pinnedIds || []).slice();
    var i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1);
    else cur.unshift(id);
    storage.pinnedIds = cur;
  }

  function orderFriendIds(ids) {
    ids = asArray(ids);
    if (!ids.length || !storage.friendsGrouping) return ids;
    var copy = ids.slice();
    copy.sort(function (a, b) {
      var pa = isPinned(a) ? 0 : 1;
      var pb = isPinned(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return rankUser(a) - rankUser(b);
    });
    if (!storage.hideOffline) return copy;
    return copy.filter(function (id) {
      return isPinned(id) || rankUser(id) < 3;
    });
  }

  function recipients(ch) {
    if (!ch) return [];
    if (Array.isArray(ch.recipients) && ch.recipients.length) return ch.recipients;
    return [];
  }

  function rankChannel(idOrCh) {
    var ch = idOrCh;
    if (typeof idOrCh !== "object") {
      var cs = ChannelStore();
      ch = cs && cs.getChannel && cs.getChannel(idOrCh);
    }
    if (!ch) return 3;
    var recips = recipients(ch);
    if (!recips.length) return 3;
    var best = 3;
    for (var i = 0; i < recips.length; i++) {
      var r = recips[i];
      var id = r && (r.id || r);
      var sc = rankUser(id);
      if (sc < best) best = sc;
    }
    return best;
  }

  function sortIds(ids) {
    ids = asArray(ids);
    if (!ids.length || !storage.dmOnlineFirst) return ids;
    return ids.slice().sort(function (a, b) {
      var pa = isPinnedChannel(a) ? 0 : 1;
      var pb = isPinnedChannel(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      var ra = rankChannel(a) - rankChannel(b);
      if (ra !== 0) return ra;
      return 0;
    });
  }

  function sortChannels(list) {
    if (!Array.isArray(list) || !storage.dmOnlineFirst) return list;
    if (!list.length) return list;
    if (typeof list[0] !== "object") return sortIds(list);
    return list.slice().sort(function (a, b) {
      return rankChannel(a) - rankChannel(b);
    });
  }

  function sortChannelMap(map) {
    if (!map || Array.isArray(map) || typeof map !== "object" || !storage.dmOnlineFirst) return map;
    var ids = Object.keys(map);
    if (!ids.length) return map;
    ids.sort(function (a, b) {
      return rankChannel(map[a]) - rankChannel(map[b]);
    });
    var out = {};
    for (var i = 0; i < ids.length; i++) out[ids[i]] = map[ids[i]];
    return out;
  }

  function hook(host, method, wrap) {
    if (!host || typeof host[method] !== "function") return false;
    for (var h = 0; h < hookedPairs.length; h++) {
      if (hookedPairs[h][0] === host && hookedPairs[h][1] === method) return false;
    }
    hookedPairs.push([host, method]);
    function run(args, res) {
      var next;
      try {
        next = wrap(args, res);
      } catch (err) {
        note("wrap err " + method + " " + err);
        return res;
      }
      if (next === undefined) return res;
      try {
        if (Array.isArray(res) && Array.isArray(next) && res !== next && !Object.isFrozen(res)) {
          res.length = 0;
          for (var i = 0; i < next.length; i++) res.push(next[i]);
          return res;
        }
      } catch (_) {}
      return next;
    }
    try {
      if (typeof after === "function") {
        unpatches.push(
          after(method, host, function (args, res) {
            return run(args, res);
          }),
        );
        hooks.push(method);
        note("after:" + method);
        return true;
      }
      if (typeof instead === "function") {
        unpatches.push(
          instead(method, host, function (args, orig) {
            var res = orig.apply(host, args);
            return run(args, res);
          }),
        );
        hooks.push(method + "/instead");
        note("instead:" + method);
        return true;
      }
      note("no patcher for " + method);
      return false;
    } catch (err) {
      note("hook fail " + method + " " + err);
      return false;
    }
  }

  function hookAll(host, method, wrap) {
    if (!host) return;
    hook(host, method, wrap);
    try {
      var proto = Object.getPrototypeOf(host);
      if (proto && proto !== Object.prototype) hook(proto, method, wrap);
    } catch (_) {}
  }

  function patchFriends() {
    if (!storage.patchDiscordLists) return;
    var store = RelationshipStore();
    hookAll(store, "getFriendIDs", function (_a, ids) {
      if (inFriend) return ids;
      inFriend = true;
      try {
        return orderFriendIds(ids);
      } catch (_) {
        return ids;
      } finally {
        inFriend = false;
      }
    });
    hookAll(store, "getFriendIds", function (_a, ids) {
      if (inFriend) return ids;
      inFriend = true;
      try {
        return orderFriendIds(ids);
      } catch (_) {
        return ids;
      } finally {
        inFriend = false;
      }
    });
  }

  function fnNames(obj) {
    if (!obj) return "none";
    var out = [];
    try {
      var seen = {};
      function walk(o) {
        if (!o || seen[o]) return;
        try { seen[o] = 1; } catch (_) { return; }
        for (var k in o) {
          try {
            if (typeof o[k] === "function") out.push(k);
          } catch (_) {}
        }
      }
      walk(obj);
      if (obj.prototype) walk(obj.prototype);
      if (Object.getPrototypeOf) walk(Object.getPrototypeOf(obj));
    } catch (_) {}
    return out.slice(0, 50).join(",") || "no-fns";
  }

  function looksLikeIdList(res) {
    if (!res) return false;
    var arr = asArray(res);
    if (arr.length < 2) return false;
    var a = arr[0];
    if (typeof a === "string" || typeof a === "number") return true;
    if (a && typeof a === "object" && (a.id || a.recipients || a.lastMessageId != null)) return true;
    return false;
  }

  function sortUnknown(res) {
    var arr = asArray(res);
    if (!arr.length) return res;
    if (typeof arr[0] === "object") return sortChannels(arr);
    return sortIds(arr);
  }

  function wrapCompare(host, method) {
    if (!host || typeof host[method] !== "function" || !instead) return false;
    for (var h = 0; h < hookedPairs.length; h++) {
      if (hookedPairs[h][0] === host && hookedPairs[h][1] === method) return false;
    }
    hookedPairs.push([host, method]);
    try {
      unpatches.push(
        instead(method, host, function (args, orig) {
          try {
            if (!storage.dmOnlineFirst || !args || args.length < 2) return orig.apply(host, args);
            var ra = rankChannel(args[0]);
            var rb = rankChannel(args[1]);
            if (ra !== rb) return ra - rb;
          } catch (_) {}
          return orig.apply(host, args);
        }),
      );
      hooks.push("instead:" + method);
      note("instead:" + method);
      return true;
    } catch (err) {
      note("instead fail " + method + " " + err);
      return false;
    }
  }

  function hookArrayGetters(store, label) {
    if (!store) return;
    note(label + " " + fnNames(store));
    var names = [];
    try {
      for (var k in store) {
        try {
          if (typeof store[k] === "function") names.push(k);
        } catch (_) {}
      }
    } catch (_) {}
    for (var i = 0; i < names.length; i++) {
      var method = names[i];
      if (/compare|sortChannels|sortPrivate/i.test(method)) {
        wrapCompare(store, method);
        continue;
      }
      if (!/get|list|ids|channels|preview|inbox|rows|items|sections|snapshot|private|dm/i.test(method)) continue;
      if (/getStatus|getUser|getChannel$|getDMFromUserId|getCurrentUser|addChange|removeChange|emit|dispatch/.test(method)) continue;
      hookAll(store, method, function (_a, res) {
        if (inDm) return res;
        if (!looksLikeIdList(res)) return res;
        inDm = true;
        try {
          return sortUnknown(res);
        } catch (_) {
          return res;
        } finally {
          inDm = false;
        }
      });
    }
    try {
      if (typeof store.getState === "function") {
        hookAll(store, "getState", function (_a, state) {
          if (!state || inDm) return state;
          var keys = ["channelIds", "privateChannelIds", "dmIds", "ids", "channels"];
          var changed = false;
          var next = state;
          for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (looksLikeIdList(state[key])) {
              if (!changed) {
                next = {};
                for (var sk in state) next[sk] = state[sk];
                changed = true;
              }
              next[key] = sortUnknown(state[key]);
            }
          }
          return changed ? next : state;
        });
      }
    } catch (_) {}
  }

  function patchDms() {
    if (!storage.patchDiscordLists) return;
    var wrapIds = function (_a, res) {
      if (inDm) return res;
      inDm = true;
      try {
        return sortIds(res);
      } catch (_) {
        return res;
      } finally {
        inDm = false;
      }
    };
    var wrapList = function (_a, res) {
      if (inDm) return res;
      inDm = true;
      try {
        return sortChannels(res);
      } catch (_) {
        return res;
      } finally {
        inDm = false;
      }
    };

    var wrapMap = function (_a, res) {
      if (inDm) return res;
      inDm = true;
      try {
        return sortChannelMap(res);
      } catch (_) {
        return res;
      } finally {
        inDm = false;
      }
    };

    var mods = [
      ChannelStore(),
      byStore("PrivateChannelSortStore"),
      byStore("PrivateChannelPreviewsStore"),
      byStore("PrivateChannelListStore"),
      byStore("InboxStore"),
      byStore("ChannelListStore"),
      byStore("MessagePreviewStore"),
      byProps("getPrivateChannelIds"),
      byProps("getSortedPrivateChannels"),
      byProps("getPrivateChannelList"),
      byProps("getMutablePrivateChannels"),
      byProps("getChannelPreviews"),
    ];
    try {
      if (typeof metro.findAll === "function") {
        var extra = metro.findAll(function (m) {
          return (
            m &&
            (typeof m.getPrivateChannelIds === "function" ||
              typeof m.getSortedPrivateChannels === "function" ||
              typeof m.getChannelPreviews === "function")
          );
        });
        if (extra && extra.length) {
          for (var xi = 0; xi < extra.length; xi++) mods.push(extra[xi]);
        }
      }
    } catch (_) {}
    var seen = [];
    for (var i = 0; i < mods.length; i++) {
      var m = mods[i];
      if (!m || seen.indexOf(m) >= 0) continue;
      seen.push(m);
      hookAll(m, "getPrivateChannelIds", wrapIds);
      hookAll(m, "getSortedPrivateChannelIds", wrapIds);
      hookAll(m, "getSortedPrivateChannels", wrapList);
      hookAll(m, "getPrivateChannelList", wrapList);
      hookAll(m, "getChannelPreviews", wrapList);
      hookAll(m, "getMutablePrivateChannels", wrapMap);
      hookAll(m, "getPrivateChannels", wrapMap);
      hookArrayGetters(m, "dmStore" + i);
    }
  }

  function bumpLists() {
    var stores = [
      byStore("PrivateChannelSortStore"),
      byStore("RelationshipStore"),
      ChannelStore(),
    ];
    for (var i = 0; i < stores.length; i++) {
      var s = stores[i];
      try {
        if (s && typeof s.emitChange === "function") s.emitChange();
      } catch (_) {}
    }
  }

  function watchPresence() {
    var p = PresenceStore();
    if (!p || typeof p.addChangeListener !== "function") return;
    var onChange = function () {
      if (presenceTimer) clearTimeout(presenceTimer);
      presenceTimer = setTimeout(function () {
        presenceGen++;
        bumpLists();
      }, 200);
    };
    p.addChangeListener(onChange);
    unpatches.push(function () {
      try {
        p.removeChangeListener && p.removeChangeListener(onChange);
      } catch (_) {}
    });
    hooks.push("PresenceStore");
  }

  function findComp(names) {
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var c = null;
      try {
        c = findByName && findByName(n);
      } catch (_) {}
      if (!c) {
        try {
          c = findByDisplayName && findByDisplayName(n);
        } catch (_) {}
      }
      if (c) return { name: n, Comp: c.default || c.type || c };
    }
    return null;
  }

  function patchAfterRender(comp, fn, tag) {
    if (!comp || !after || !e) return;
    var inst = comp.Comp;
    if (!inst) return;
    var method = inst.render ? "render" : inst.type ? "type" : null;
    if (!method) return;
    var host = inst.render ? inst : { type: inst };
    try {
      unpatches.push(after(method, host, fn));
      hooks.push(tag + ":" + comp.name);
    } catch (_) {}
  }

  function OnlineStrip() {
    if (!e || !storage.dmStrip) return null;
    var rel = RelationshipStore();
    var ids = [];
    try {
      ids = (rel && rel.getFriendIDs && rel.getFriendIDs()) || [];
    } catch (_) {}
    var online = [];
    for (var i = 0; i < ids.length && online.length < 24; i++) {
      if (rankUser(ids[i]) < 3) online.push(ids[i]);
    }
    if (!online.length) return null;
    var UserStore = pick(function () {
      return byStore("UserStore");
    }, function () {
      return byProps("getUser", "getCurrentUser");
    });
    function nameOf(id) {
      try {
        var u = UserStore && UserStore.getUser && UserStore.getUser(id);
        return (u && (u.globalName || u.displayName || u.username)) || "?";
      } catch (_) {
        return "?";
      }
    }
    var open = pick(function () {
      var m = byProps("openPrivateChannel");
      return m && m.openPrivateChannel;
    }, function () {
      var m = byProps("ensurePrivateChannel");
      return m && m.ensurePrivateChannel;
    });
    return e(
      View,
      { style: { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#2a2d33" } },
      e(
        Text,
        {
          style: {
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 8,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.2,
            color: "#3ba55c",
          },
        },
        "ONLINE NOW · " + online.length,
      ),
      e(
        ScrollView,
        { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: { paddingHorizontal: 12, flexDirection: "row" } },
        online.map(function (id) {
          var nm = nameOf(id);
          return e(
            Pressable,
            {
              key: String(id),
              style: { width: 64, alignItems: "center", marginHorizontal: 4 },
              onPress: function () {
                openDM(id);
              },
            },
            e(
              View,
              {
                style: {
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#2f5d46",
                  borderWidth: 2,
                  borderColor: "#3ba55c",
                },
              },
              e(Text, { style: { color: "#f2f3f5", fontWeight: "700", fontSize: 16 } }, String(nm).slice(0, 1).toUpperCase()),
            ),
            e(
              Text,
              { style: { fontSize: 11, color: "#8b8f98", marginTop: 6, width: 64, textAlign: "center" }, numberOfLines: 1 },
              String(nm).split(" ")[0],
            ),
          );
        }),
      ),
    );
  }

  function typeName(el) {
    if (!el) return "";
    var t = el.type;
    if (typeof t === "string") return t;
    return (t && (t.displayName || t.name)) || "";
  }

  function isFastestEl(el) {
    return /FastestList|FastList|FlashList|Recycler/i.test(typeName(el));
  }

  function collectNowPeople() {
    var ids = friendIds();
    var online = [];
    var idle = [];
    for (var i = 0; i < ids.length; i++) {
      var st = statusOf(ids[i]);
      if (st === "online") online.push({ id: ids[i], name: userName(ids[i]), status: st });
      else if (st === "idle") idle.push({ id: ids[i], name: userName(ids[i]), status: st });
    }
    return online.concat(idle).slice(0, 16);
  }

  function NowTray() {
    if (!e || storage.showNowTray === false) return null;
    var people = [];
    try {
      people = collectNowPeople();
    } catch (_) {
      return null;
    }
    if (!people.length) return null;
    var ring = { online: "#3ba55c", idle: "#faa61a" };
    return e(
      View,
      {
        style: {
          borderBottomWidth: 1,
          borderBottomColor: "#2a2d33",
          paddingBottom: 8,
          backgroundColor: "#1e1f22",
        },
      },
      e(
        View,
        {
          style: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 8,
          },
        },
        e(
          Text,
          { style: { color: "#3ba55c", fontSize: 11, fontWeight: "700", letterSpacing: 1.2 } },
          "NOW · " + people.length,
        ),
        e(
          Pressable,
          {
            onPress: function () {
              openOnlineNowPage();
            },
            hitSlop: 8,
          },
          e(Text, { style: { color: "#8b8f98", fontSize: 13, fontWeight: "600" } }, "See all"),
        ),
      ),
      e(
        ScrollView,
        {
          horizontal: true,
          showsHorizontalScrollIndicator: false,
          contentContainerStyle: { paddingHorizontal: 12, flexDirection: "row" },
        },
        people.map(function (p) {
          var initial = (p.name || "?").slice(0, 1).toUpperCase();
          var color = ring[p.status] || "#3ba55c";
          return e(
            Pressable,
            {
              key: p.id,
              onPress: function () {
                openDM(p.id);
              },
              style: { width: 64, alignItems: "center", marginHorizontal: 4 },
            },
            e(
              View,
              {
                style: {
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#2b2d31",
                  borderWidth: 2,
                  borderColor: color,
                },
              },
              e(Text, { style: { color: "#f2f3f5", fontWeight: "700", fontSize: 16 } }, initial),
            ),
            e(
              Text,
              {
                style: { fontSize: 11, color: "#8b8f98", marginTop: 6, width: 64, textAlign: "center" },
                numberOfLines: 1,
              },
              String(p.name).split(" ")[0],
            ),
          );
        }),
      ),
    );
  }

  function childHasText(el, needle) {
    if (!el || !needle) return false;
    if (typeof el === "string") return el.indexOf(needle) >= 0;
    if (typeof el !== "object") return false;
    try {
      var kids = el.props && el.props.children;
      if (typeof kids === "string") return kids.indexOf(needle) >= 0;
      if (Array.isArray(kids)) {
        for (var i = 0; i < kids.length; i++) {
          if (childHasText(kids[i], needle)) return true;
        }
      } else if (kids && typeof kids === "object") {
        return childHasText(kids, needle);
      }
    } catch (_) {}
    return false;
  }

  function MessagesNowBar() {
    if (!e) return null;
    var n = 0;
    try {
      n = aroundCount();
    } catch (_) {}
    return e(
      Pressable,
      {
        onPress: openOnlineNowPage,
        style: {
          marginHorizontal: 16,
          marginTop: 8,
          marginBottom: 6,
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderRadius: 12,
          backgroundColor: "#1e2b24",
          borderWidth: 1,
          borderColor: "#2f5d46",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
      },
      e(
        Text,
        { style: { color: "#3ba55c", fontWeight: "700", fontSize: 14 } },
        n ? "NOW · " + n + " around" : "NOW",
      ),
      e(Text, { style: { color: "#8b8f98", fontSize: 13 } }, "Online friends  →"),
    );
  }

  function NowPicker() {
    var tray = null;
    try {
      tray = NowTray();
    } catch (_) {}
    if (tray) return tray;
    return MessagesNowBar();
  }

  function injectNowTray(ret) {
    if (!ret || !e || storage.showNowTray === false) return ret;
    if (isFastestEl(ret)) return ret;
    if (!React || !React.cloneElement) return ret;
    try {
      var bar = null;
      var kids = ret.props && ret.props.children;
      if (kids == null) return ret;
      var arr = Array.isArray(kids) ? kids.slice() : [kids];
      for (var i = 0; i < arr.length; i++) {
        var key = arr[i] && arr[i].key;
        if (key === "onlinenow-msgbar" || key === "onlinenow-tray" || key === "onlinenow-picker") return ret;
      }
      var at = -1;
      var kind = "bar";
      for (var j = 0; j < arr.length; j++) {
        if (isFastestEl(arr[j])) {
          at = j;
          kind = "bar";
          break;
        }
        if (childHasText(arr[j], "New Group") || childHasText(arr[j], "New group")) {
          at = j;
          kind = "picker";
          break;
        }
        if (
          childHasText(arr[j], "Add Friends") ||
          childHasText(arr[j], "Add friends") ||
          childHasText(arr[j], "Add a Friend") ||
          childHasText(arr[j], "Add a friend")
        ) {
          at = j + 1;
          kind = "bar";
          break;
        }
      }
      if (at < 0) {
        for (var k = 0; k < arr.length && k < 8; k++) {
          if (!arr[k] || !arr[k].props || isFastestEl(arr[k])) continue;
          var nested = injectNowTray(arr[k]);
          if (nested !== arr[k]) {
            arr[k] = nested;
            return React.cloneElement(ret, { children: arr });
          }
        }
        return ret;
      }
      bar =
        kind === "picker"
          ? e(NowPicker, { key: "onlinenow-picker" })
          : e(MessagesNowBar, { key: "onlinenow-msgbar" });
      arr.splice(at, 0, bar);
      if (kind === "picker") note("pickerHost=New Group");
      return React.cloneElement(ret, { children: arr });
    } catch (err) {
      note("tray inject " + err);
      return ret;
    }
  }

  function patchNowTray() {
    if (storage.showNowTray === false) return;
    var names = [
      "InstantPrivateChannels",
      "ConnectedPrivateChannels",
      "PrivateChannels",
      "PrivateChannelList",
      "MessagesScreen",
      "Messages",
      "MessagesTab",
      "TabMessages",
      "ConversationList",
      "Conversations",
      "Recents",
      "RecentConversations",
      "DMList",
      "UserChannels",
      "PrivateChannelPreviews",
      "ChannelPreviews",
      "SearchablePrivateChannels",
      "ConnectedPrivateChannelsTab",
      "NewMessage",
      "NewMessages",
      "CreateDM",
      "CreatePrivateChannel",
      "StartPrivateChannel",
      "FriendPicker",
      "UserSearch",
      "RecipientsSelect",
    ];
    var hit = false;
    for (var i = 0; i < names.length; i++) {
      var found = findComp([names[i]]);
      if (!found) continue;
      hit = true;
      note("nowHost=" + found.name);
      patchAfterRender(
        found,
        function (_args, ret) {
          if (!ret) return ret;
          try {
            return injectNowTray(ret);
          } catch (err) {
            note("now wrap " + err);
            return ret;
          }
        },
        "now",
      );
    }
    if (!hit) note("nowHost=none");
    patchNowJsx();
  }

  function patchNowJsx() {
    var jsxMod = null;
    try {
      jsxMod = byProps("jsx", "jsxs") || (React && React.createElement && null);
    } catch (_) {}
    if (!jsxMod || !after) {
      note("nowJsx=no");
      return;
    }
    function wrap(args, ret) {
      if (!ret || storage.showNowTray === false) return ret;
      var type = args && args[0];
      var name = "";
      try {
        name = (typeof type === "string" && type) || (type && (type.displayName || type.name)) || "";
      } catch (_) {}
      if (!name || isFastestEl(ret)) return ret;
      if (!/PrivateChannel|MessagesScreen|^Messages$|Conversation|Recents|DMList|UserChannels|NewMessage|CreateDM|FriendPicker|StartPrivate|UserSearch|Recipients/i.test(name)) return ret;
      try {
        return injectNowTray(ret);
      } catch (_) {
        return ret;
      }
    }
    try {
      unpatches.push(after("jsx", jsxMod, wrap));
      unpatches.push(after("jsxs", jsxMod, wrap));
      note("nowJsx=ok");
    } catch (err) {
      note("nowJsx err " + err);
    }
  }

  function patchFriendHeaders() {
    if (!storage.patchDiscordLists) return;
    var found = findComp(["FriendRow", "FriendsRow", "PeopleListItem", "FriendsListItem", "UserListItem"]);
    if (!found) return;
    var lastStatus = { id: null };
    patchAfterRender(
      found,
      function (args, ret) {
        if (!storage.friendsGrouping || !ret) return ret;
        var props = (args && args[0]) || {};
        var userId = props.userId || (props.user && props.user.id) || props.user;
        if (!userId) return ret;
        var st = isPinned(userId) ? "pinned" : statusOf(userId);
        if (lastStatus.id === st) return ret;
        lastStatus.id = st;
        var label =
          st === "pinned" ? "PINNED" : st === "online" ? "ONLINE" : st === "idle" ? "IDLE" : st === "dnd" ? "DO NOT DISTURB" : "OFFLINE";
        var color = st === "online" ? "#3ba55c" : st === "idle" ? "#c9a227" : st === "dnd" ? "#d44548" : "#8b8f98";
        return e(
          View,
          null,
          e(
            Text,
            {
              style: {
                paddingHorizontal: 16,
                paddingTop: 10,
                paddingBottom: 4,
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 1.2,
                color: color,
              },
            },
            label,
          ),
          ret,
        );
      },
      "header",
    );
  }

  var styles =
    StyleSheet &&
    StyleSheet.create({
      page: { flex: 1, backgroundColor: "#1e1f22" },
      pad: { paddingVertical: 8, paddingHorizontal: 16 },
      title: { color: "#f2f3f5", fontSize: 20, fontWeight: "700", marginBottom: 4 },
      hint: { color: "#8b8f98", fontSize: 12, marginBottom: 12, lineHeight: 18 },
      search: {
        backgroundColor: "#2b2d31",
        color: "#f2f3f5",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        marginBottom: 12,
      },
      section: {
        color: "#3ba55c",
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.2,
        paddingTop: 14,
        paddingBottom: 6,
      },
      friend: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
      },
      avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: "#2b2d31",
        alignItems: "center",
        justifyContent: "center",
        marginRight: 12,
      },
      avatarText: { color: "#f2f3f5", fontWeight: "700", fontSize: 13 },
      name: { color: "#f2f3f5", fontSize: 16, fontWeight: "600" },
      sub: { color: "#8b8f98", fontSize: 12, marginTop: 2 },
      msg: {
        backgroundColor: "#3ba55c",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
      },
      msgText: { color: "#fff", fontSize: 13, fontWeight: "700" },
      row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
      },
      label: { color: "#f2f3f5", fontSize: 16, fontWeight: "600", maxWidth: 240 },
      debugBtn: { color: "#8b8f98", fontSize: 13, paddingVertical: 12 },
    });

  var TOGGLES = [
    ["showNowTray", "Now tray on Messages", "Faces of people who are around, above the list"],
    [
      "patchDiscordLists",
      "Also sort Discord Friends/Messages",
      "Off = safe. On can crash FastestList.",
    ],
    ["friendsGrouping", "Group this page by status", "Pinned, Online, Idle, DND, Offline"],
    ["splitIdle", "Keep Idle separate", "Otherwise Idle counts as online"],
    ["splitDnd", "Keep DND separate", "Otherwise DND counts as online"],
    ["hideOffline", "Hide Offline on this page", "Drop Offline from the list"],
  ];

  function Switch(props) {
    if (Forms.FormSwitch) {
      return e(Forms.FormSwitch, { value: props.value, onValueChange: props.onChange });
    }
    if (!e) return null;
    return e(
      Pressable,
      {
        onPress: function () {
          props.onChange(!props.value);
        },
        style: {
          width: 48,
          height: 28,
          borderRadius: 14,
          backgroundColor: props.value ? "#3ba55c" : "#2a2d33",
          justifyContent: "center",
          paddingHorizontal: 3,
        },
      },
      e(View, {
        style: {
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: "#f2f3f5",
          alignSelf: props.value ? "flex-end" : "flex-start",
        },
      }),
    );
  }

  function userName(id) {
    id = friendId(id);
    try {
      var us = UserStore();
      var u = us && us.getUser && (us.getUser(id) || us.getUser(String(id)));
      if (!u) return id ? id.slice(-4) : "?";
      return u.globalName || u.displayName || u.username || u.tag || id.slice(-4);
    } catch (_) {
      return id ? id.slice(-4) : "?";
    }
  }

  function friendIds() {
    var rel = RelationshipStore();
    var raw = [];
    try {
      if (rel && rel.getFriendIDs) raw = asArray(rel.getFriendIDs());
      if (!raw.length && rel && rel.getFriendIds) raw = asArray(rel.getFriendIds());
    } catch (_) {}
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var id = friendId(raw[i]);
      if (id && /^\d{5,}$/.test(id)) out.push(id);
    }
    return out;
  }

  function listFriends(query) {
    var ids = friendIds();
    var q = String(query || "").trim().toLowerCase();
    var rows = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var name = userName(id);
      if (q && name.toLowerCase().indexOf(q) < 0 && id.indexOf(q) < 0) continue;
      var st = statusOf(id);
      if (storage.hideOffline && st !== "online" && st !== "idle" && st !== "dnd" && !isPinned(id)) continue;
      rows.push({
        id: id,
        name: name,
        status: isPinned(id) ? "pinned" : st,
        rank: isPinned(id) ? -1 : rankUser(id),
      });
    }
    rows.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return String(a.name).localeCompare(String(b.name));
    });
    return rows;
  }

  function navRoot() {
    try {
      var refApi = byProps("getRootNavigationRef");
      var nav = refApi && refApi.getRootNavigationRef && refApi.getRootNavigationRef();
      if (nav) return nav;
    } catch (_) {}
    try {
      var NN = common.NavigationNative;
      if (NN && typeof NN.getNavigationRef === "function") return NN.getNavigationRef();
    } catch (_) {}
    return null;
  }

  function selectChannel(channelId) {
    if (channelId == null) return false;
    if (typeof channelId === "object") channelId = channelId.id || channelId.channelId || channelId.channel_id;
    channelId = String(channelId);
    if (!channelId || channelId === "undefined" || !/^\d{5,}$/.test(channelId)) return false;
    try {
      var nav = navRoot();
      if (nav && typeof nav.navigate === "function") {
        try {
          nav.navigate("CHANNEL", { channelId: channelId, guildId: null });
          return true;
        } catch (_) {}
        try {
          nav.navigate("Chat", { channelId: channelId });
          return true;
        } catch (_) {}
      }
    } catch (_) {}
    try {
      var sel = byProps("selectPrivateChannel") || byProps("selectChannel");
      if (sel && typeof sel.selectPrivateChannel === "function") {
        sel.selectPrivateChannel(channelId);
        return true;
      }
      if (sel && typeof sel.selectChannel === "function") {
        sel.selectChannel({ channelId: channelId, guildId: null });
        return true;
      }
    } catch (_) {}
    try {
      var t = byProps("transitionTo");
      if (t && typeof t.transitionTo === "function") {
        t.transitionTo("/channels/@me/" + channelId);
        return true;
      }
    } catch (_) {}
    try {
      var flux = (common && common.FluxDispatcher) || byProps("dispatch", "subscribe");
      if (flux && typeof flux.dispatch === "function") {
        flux.dispatch({ type: "CHANNEL_SELECT", channelId: channelId, guildId: null });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function jumpToUserDM(userId) {
    try {
      var cs = ChannelStore();
      var existing = cs && cs.getDMFromUserId && cs.getDMFromUserId(userId);
      if (existing && selectChannel(existing)) return true;
    } catch (_) {}
    return false;
  }

  function openDM(userId) {
    userId = friendId(userId);
    note("dmOpen id=" + userId);
    if (!/^\d{5,}$/.test(userId)) {
      note("dmOpen bad id");
      toast("Couldn't open DM");
      return;
    }
    if (jumpToUserDM(userId)) {
      note("dmOpen=existing");
      return;
    }
    function afterEnsure(id) {
      try {
        if (id && typeof id === "object") id = id.id || id.channelId || id.channel_id;
        setTimeout(function () {
          if (jumpToUserDM(userId)) {
            note("dmOpen=after existing");
            return;
          }
          if (id) selectChannel(id);
        }, 80);
      } catch (_) {}
    }
    try {
      var ens = byProps("ensurePrivateChannel") || byProps("getOrCreatePrivateChannel") || byProps("getOrCreateDM");
      var efn = ens && (ens.ensurePrivateChannel || ens.getOrCreatePrivateChannel || ens.getOrCreateDM);
      if (typeof efn === "function") {
        var res = null;
        try {
          res = efn.call(ens, userId);
          note("dmOpen=ensure string");
        } catch (_) {
          res = efn.call(ens, [userId]);
          note("dmOpen=ensure array");
        }
        if (res && typeof res.then === "function") {
          res.then(afterEnsure);
          return;
        }
        if (res) {
          afterEnsure(res);
          return;
        }
      }
    } catch (err) {
      note("dmOpen ensure " + err);
    }
    try {
      var opener = byProps("openPrivateChannel");
      var ofn = opener && opener.openPrivateChannel;
      if (typeof ofn === "function") {
        try {
          ofn.call(opener, { recipientId: userId });
          note("dmOpen=recipientId");
          return;
        } catch (_) {}
        try {
          ofn.call(opener, [userId]);
          note("dmOpen=array1");
          return;
        } catch (_) {}
      }
    } catch (err) {
      note("dmOpen open " + err);
    }
    toast("Couldn't open DM");
  }

  function st() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      for (var k in s) out[k] = s[k];
    }
    return out;
  }

  var STATUS_META = {
    pinned: { label: "PINNED", color: "#f2f3f5" },
    online: { label: "ONLINE", color: "#3ba55c" },
    idle: { label: "IDLE", color: "#faa61a" },
    dnd: { label: "DO NOT DISTURB", color: "#ed4245" },
    offline: { label: "OFFLINE", color: "#8b8f98" },
  };

  function Settings() {
    var useState = React && React.useState;
    var useEffect = React && React.useEffect;
    var qState = useState ? useState("") : ["", function () {}];
    var query = qState[0];
    var setQuery = qState[1];
    var tickState = useState ? useState(0) : [0, function () {}];
    var setTick = tickState[1];
    var dbgState = useState ? useState(false) : [false, function () {}];
    var dbg = dbgState[0];
    var setDbg = dbgState[1];
    try {
      if (useProxy) useProxy(storage);
    } catch (_) {}
    if (useEffect) {
      useEffect(function () {
        var p = PresenceStore();
        if (!p || typeof p.addChangeListener !== "function") return;
        var on = function () {
          setTick(function (n) {
            return n + 1;
          });
        };
        p.addChangeListener(on);
        return function () {
          try {
            p.removeChangeListener && p.removeChangeListener(on);
          } catch (_) {}
        };
      }, []);
    }
    if (!e) return null;
    try {
    var rows = listFriends(query);
    var counts = { online: 0, idle: 0, dnd: 0, offline: 0, pinned: 0 };
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].status;
      if (counts[k] == null) counts[k] = 0;
      counts[k]++;
    }
    var log = (storage._debug && storage._debug.length ? storage._debug : debugLog) || [];
    var sections = ["pinned", "online", "idle", "dnd", "offline"];
    var kids = [
      e(Text, { key: "t", style: styles && styles.title }, "OnlineNow"),
      e(
        Text,
        { key: "h", style: styles && styles.hint },
        counts.online +
          " online · " +
          counts.idle +
          " idle · tap Message to open a DM",
      ),
    ];
    if (TextInput) {
      kids.push(
        e(TextInput, {
          key: "s",
          style: styles && styles.search,
          placeholder: "Search friends",
          placeholderTextColor: "#8b8f98",
          value: query,
          onChangeText: setQuery,
        }),
      );
    }
    if (!rows.length) {
      kids.push(
        e(
          Text,
          { key: "empty", style: styles && styles.hint },
          "No friends loaded yet. Enable the plugin, wait a few seconds, reopen this page.",
        ),
      );
    }
    var lastSec = "";
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var sec = row.status;
      if (sections.indexOf(sec) < 0) sec = "offline";
      if (sec !== lastSec) {
        lastSec = sec;
        var meta = STATUS_META[sec] || STATUS_META.offline;
        kids.push(
          e(
            Text,
            { key: "sec-" + sec, style: st(styles && styles.section, { color: meta.color }) },
            meta.label + " · " + (counts[sec] || 0),
          ),
        );
      }
      (function (item) {
        var initial = (item.name || "?").slice(0, 1).toUpperCase();
        kids.push(
          e(
            View,
            { key: item.id, style: styles && styles.friend },
            e(View, { style: styles && styles.avatar }, e(Text, { style: styles && styles.avatarText }, initial)),
            e(
              Pressable,
              {
                onPress: function () {
                  togglePin(item.id);
                },
                style: { flex: 1, paddingRight: 8 },
              },
              e(Text, { style: styles && styles.name, numberOfLines: 1 }, item.name),
              e(Text, { style: styles && styles.sub }, item.status === "pinned" ? "pinned · tap to unpin" : "tap name to pin"),
            ),
            e(
              Pressable,
              {
                onPress: function () {
                  openDM(item.id);
                },
                style: styles && styles.msg,
              },
              e(Text, { style: styles && styles.msgText }, "Message"),
            ),
          ),
        );
      })(row);
    }
    kids.push(e(Text, { key: "opt", style: st(styles && styles.section, { color: "#8b8f98" }) }, "OPTIONS"));
    for (var t = 0; t < TOGGLES.length; t++) {
      (function (tog) {
        kids.push(
          e(
            View,
            { key: tog[0], style: styles && styles.row },
            e(
              View,
              { style: { flex: 1, paddingRight: 12 } },
              e(Text, { style: styles && styles.label }, tog[1]),
              e(Text, { style: styles && styles.sub }, tog[2]),
            ),
            e(Switch, {
              value: !!storage[tog[0]],
              onChange: function (v) {
                storage[tog[0]] = v;
              },
            }),
          ),
        );
      })(TOGGLES[t]);
    }
    kids.push(
      e(
        Pressable,
        {
          key: "dbg",
          onPress: function () {
            setDbg(!dbg);
          },
        },
        e(Text, { style: styles && styles.debugBtn }, dbg ? "Hide plugin debug" : "Plugin debug"),
      ),
    );
    if (dbg) {
      kids.push(
        e(
          Text,
          { key: "log", style: styles && styles.hint },
          (hooks.length ? "Hooks: " + hooks.join(", ") : "No hooks yet.") +
            "\n\n" +
            (log.length ? log.join("\n") : "Enable, wait 3s, reopen."),
        ),
      );
    }
    return e(ScrollView, { style: styles && styles.page, contentContainerStyle: styles && styles.pad }, kids);
    } catch (err) {
      note("page err " + err);
      return e(
        ScrollView,
        { style: styles && styles.page },
        e(Text, { style: styles && styles.title }, "OnlineNow"),
        e(Text, { style: styles && styles.hint }, "Page error: " + String(err)),
      );
    }
  }

  function patchVisibleBadge() {
    try {
      var i18n = findFn("getLocale") || byProps("Messages");
      var dict = i18n && (i18n.Messages || i18n.default);
      if (dict && dict.MESSAGES && typeof dict.MESSAGES === "string") {
        dict.MESSAGES = "Messages · OnlineNow";
        note("badge:i18n.MESSAGES");
        hooks.push("badge:i18n");
      }
    } catch (err) {
      note("badge err " + err);
    }
  }

  function openOnlineNowPage() {
    var params = { title: "OnlineNow", render: Settings };
    var routes = ["SHIGGYCORD_CUSTOM_PAGE", "VendettaCustomPage", "BUNNY_CUSTOM_PAGE"];
    var nav = null;
    try {
      var refApi = byProps("getRootNavigationRef");
      nav = refApi && refApi.getRootNavigationRef && refApi.getRootNavigationRef();
    } catch (_) {}
    if (!nav) {
      try {
        var NN = common.NavigationNative;
        if (NN && typeof NN.getNavigationRef === "function") nav = NN.getNavigationRef();
      } catch (_) {}
    }
    if (nav && typeof nav.navigate === "function") {
      for (var i = 0; i < routes.length; i++) {
        try {
          nav.navigate(routes[i], params);
          note("page=" + routes[i]);
          return;
        } catch (err) {
          note("nav " + routes[i] + " " + err);
        }
      }
    }
    toast("Open Plugins → OnlineNow → gear");
  }

  function aroundCount() {
    try {
      return collectNowPeople().length;
    } catch (_) {
      return 0;
    }
  }

  function NowChip() {
    if (!e) return null;
    var n = aroundCount();
    return e(
      Pressable,
      {
        onPress: openOnlineNowPage,
        style: {
          marginHorizontal: 16,
          marginVertical: 8,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 10,
          backgroundColor: "#1e2b24",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
      },
      e(Text, { style: { color: "#3ba55c", fontWeight: "700", fontSize: 13, letterSpacing: 1 } }, n ? "NOW · " + n : "NOW"),
      e(Text, { style: { color: "#8b8f98", fontSize: 13 } }, "Online friends"),
    );
  }

  function injectNowChip(ret) {
    if (!ret || !e) return ret;
    if (isFastestEl(ret)) return ret;
    if (!React || !React.cloneElement) return ret;
    try {
      var chip = e(NowChip, { key: "onlinenow-chip" });
      var kids = ret.props && ret.props.children;
      if (kids == null) return e(View, { style: { flex: 1 } }, chip, ret);
      var arr = Array.isArray(kids) ? kids.slice() : [kids];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].key === "onlinenow-chip") return ret;
      }
      var at = arr.length;
      for (var j = 0; j < arr.length; j++) {
        if (isFastestEl(arr[j])) {
          at = j;
          break;
        }
      }
      arr.splice(at, 0, chip);
      return React.cloneElement(ret, { children: arr });
    } catch (err) {
      note("chip inject " + err);
      return ret;
    }
  }

  function patchFriendsNowChip() {
    var names = ["FriendsScreen", "SearchableUserList", "ThemedFriendsNavigator"];
    var hit = false;
    for (var i = 0; i < names.length; i++) {
      var found = findComp([names[i]]);
      if (!found) continue;
      hit = true;
      note("friendsHost=" + found.name);
      patchAfterRender(
        found,
        function (_args, ret) {
          if (!ret) return ret;
          try {
            return injectNowChip(ret);
          } catch (err) {
            note("friends wrap " + err);
            return ret;
          }
        },
        "friendsNow",
      );
    }
    if (!hit) note("friendsHost=none");
  }

  function HeaderNow() {
    if (!e) return null;
    var n = aroundCount();
    return e(
      Pressable,
      {
        onPress: openOnlineNowPage,
        hitSlop: 10,
        style: { paddingHorizontal: 10, paddingVertical: 4 },
      },
      e(
        Text,
        { style: { color: "#3ba55c", fontWeight: "700", fontSize: 12, letterSpacing: 0.8 } },
        n ? "NOW · " + n : "NOW",
      ),
    );
  }

  function injectHeaderNow(ret) {
    if (!ret || !e) return ret;
    if (isFastestEl(ret)) return ret;
    if (!React || !React.cloneElement) return ret;
    try {
      var btn = e(HeaderNow, { key: "onlinenow-header" });
      var kids = ret.props && ret.props.children;
      if (kids == null) {
        return e(
          View,
          { style: { flexDirection: "row", alignItems: "center" } },
          ret,
          btn,
        );
      }
      var arr = Array.isArray(kids) ? kids.slice() : [kids];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].key === "onlinenow-header") return ret;
      }
      arr.push(btn);
      return React.cloneElement(ret, { children: arr });
    } catch (err) {
      note("header inject " + err);
      return ret;
    }
  }

  function hookScreens(names, inject, tag) {
    var hit = false;
    for (var i = 0; i < names.length; i++) {
      var found = findComp([names[i]]);
      if (!found) continue;
      hit = true;
      note(tag + "Host=" + found.name);
      patchAfterRender(
        found,
        function (_args, ret) {
          if (!ret) return ret;
          try {
            return inject(ret);
          } catch (err) {
            note(tag + " wrap " + err);
            return ret;
          }
        },
        tag,
      );
    }
    if (!hit) note(tag + "Host=none");
  }

  function patchHomeNow() {
    hookScreens(
      ["LaunchPad", "HomeHeader", "MainHeader", "AppHeader", "TitleBar", "QuickSwitcher"],
      injectNowChip,
      "home",
    );
  }

  function patchChatNow() {
    hookScreens(
      [
        "ChatHeader",
        "ChannelHeader",
        "HeaderBar",
        "PrivateChannelHeader",
        "ChatScreenHeader",
        "HeaderContainer",
        "NavigationHeader",
      ],
      injectHeaderNow,
      "chat",
    );
  }

  function patchProfileNow() {
    hookScreens(
      [
        "UserProfileHeader",
        "ProfileActionButtons",
        "UserProfileActions",
        "RelationshipButtons",
        "FriendActionButtons",
      ],
      injectHeaderNow,
      "profile",
    );
  }

  function registerOnlineNowSection() {
    var register = null;
    try {
      if (bunnyApi && bunnyApi.ui && bunnyApi.ui.settings && bunnyApi.ui.settings.registerSection) {
        register = bunnyApi.ui.settings.registerSection;
      }
    } catch (_) {}
    if (!register) {
      var mod = byProps("registerSection", "registeredSections");
      register = mod && mod.registerSection;
    }
    if (!register) {
      note("registerSection=no");
      return;
    }
    try {
      var undo = register({
        name: "OnlineNow",
        items: [
          {
            key: "onlinenow-page",
            title: function () {
              return "OnlineNow";
            },
            onPress: openOnlineNowPage,
            useTrailing: function () {
              var n = aroundCount();
              return n ? n + " around" : "Nobody around";
            },
          },
        ],
      });
      if (typeof undo === "function") unpatches.push(undo);
      hooks.push("settingsRow");
      note("registerSection=ok");
    } catch (err) {
      note("registerSection err " + err);
    }
  }

  function whenReady(get, cb, label) {
    var done = false;
    function hit(m) {
      if (done || !m) return;
      done = true;
      note("ready:" + label);
      try {
        cb(m);
      } catch (err) {
        note("ready err " + label + " " + err);
      }
    }
    var n = 0;
    (function tick() {
      if (done) return;
      var m = get();
      if (m) return hit(m);
      if (n++ >= 80) {
        note("timeout:" + label);
        return;
      }
      setTimeout(tick, 250);
    })();
  }

  function isPrivateData(data) {
    var arr = asArray(data);
    if (arr.length < 2) return false;
    var ch = ChannelStore();
    var hits = 0;
    var n = Math.min(arr.length, 12);
    for (var i = 0; i < n; i++) {
      var item = arr[i];
      var id = item && (item.id || item.channel_id || item.channelId || item.userId || item);
      if (id == null || typeof id === "object") continue;
      try {
        var c = ch && ch.getChannel && ch.getChannel(String(id));
        if (c && (c.type === 1 || c.type === 3)) {
          hits++;
          continue;
        }
      } catch (_) {}
      if (rankUser(id) <= 3) hits++;
    }
    return hits >= 2;
  }

  function onlineHeader() {
    if (!e || !Text) return null;
    return e(
      Pressable,
      { onPress: openOnlineNowPage },
      e(
        Text,
        {
          style: {
            color: "#3ba55c",
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 6,
            fontWeight: "700",
            fontSize: 13,
          },
        },
        "OnlineNow · tap for online first",
      ),
    );
  }

  function sortedProps(props) {
    if (!props) return null;
    var next = null;
    function set(k, v) {
      if (!next) {
        next = {};
        for (var p in props) next[p] = props[p];
      }
      next[k] = v;
    }
    var keys = ["data", "items", "rows", "channels", "records", "list", "previews"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (isPrivateData(props[k])) set(k, sortUnknown(props[k]));
    }
    if (Array.isArray(props.sections) && props.sections.length) {
      var secs = [];
      for (var s = 0; s < props.sections.length; s++) {
        var sec = props.sections[s];
        if (sec && sec.data) {
          secs.push(Object.assign({}, sec, { data: sortUnknown(sec.data) }));
        } else secs.push(sec);
      }
      set("sections", secs);
    }
    if (typeof props.getItem === "function" && typeof props.getItemCount === "function") {
      try {
        var n = props.getItemCount(props.data);
        if (typeof n !== "number") n = props.getItemCount();
        var bag = [];
        if (typeof n === "number" && n > 1 && n < 2000) {
          for (var gi = 0; gi < n; gi++) {
            var it = null;
            try {
              it = props.getItem(props.data, gi);
            } catch (_) {
              try {
                it = props.getItem(gi);
              } catch (_) {}
            }
            bag.push(it);
          }
          if (isPrivateData(bag) || (bag.length > 2 && rankChannel(bag[0]) <= 3)) {
            var sortedBag = sortUnknown(bag);
            set("getItemCount", function () {
              return sortedBag.length;
            });
            set("getItem", function (_d, i) {
              if (typeof i !== "number") i = _d;
              return sortedBag[i];
            });
          }
        }
      } catch (_) {}
    }
    if (next) {
      /* never ListHeaderComponent / extraData / renderItem — FastestList crash */
    }
    return next;
  }

  function restyleList(el) {
    if (!el || !el.props || !React || !React.cloneElement) return el;
    var next = sortedProps(el.props);
    if (!next) return el;
    try {
      return React.cloneElement(el, next);
    } catch (_) {
      return el;
    }
  }

  function sortUserListProps(props) {
    if (!props || !storage.friendsGrouping) return null;
    var keys = ["users", "data", "items", "rows", "userIds"];
    var next = null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!props[k]) continue;
      var arr = asArray(props[k]);
      if (arr.length < 2) continue;
      if (!next) next = {};
      next[k] = sortUnknown(arr);
    }
    return next;
  }

  function restyleTitle(el) {
    if (!el || !el.props || !React || !React.cloneElement) return el;
    var kids = el.props.children;
    var label = el.props.accessibilityLabel;
    var text = typeof kids === "string" ? kids : typeof label === "string" ? label : "";
    if (text !== "Messages" && text !== "Friends") return el;
    try {
      return React.cloneElement(el, { children: text + " · OnlineNow" });
    } catch (_) {
      return el;
    }
  }

  function patchJsxLists() {
    var jsx = byProps("jsx", "jsxs");
    var inJsx = false;
    var jsxSeen = {};
    var jsxLogged = 0;
    function wrap(args, ret) {
      if (inJsx || !ret || !ret.props) return ret;
      inJsx = true;
      try {
        var Comp = args && args[0];
        var cname =
          typeof Comp === "string"
            ? Comp
            : (Comp && (Comp.displayName || Comp.name)) || "";
        var looksList =
          /FastestList|FastList|FlashList|VirtualizedList|Recycler|DCD.*List|ChannelList/i.test(cname) ||
          (ret.props && (ret.props.estimatedItemSize != null || ret.props.estimatedFirstItemOffset != null));
        if (jsxLogged < 24 && ret.props && (ret.props.data || ret.props.items || ret.props.getItem || looksList)) {
          var tag = cname || "?";
          if (!jsxSeen[tag]) {
            jsxSeen[tag] = 1;
            jsxLogged++;
            var n = asArray(ret.props.data || ret.props.items || ret.props.rows).length;
            note("jsxComp=" + tag + (typeof Comp === "string" ? " native" : "") + " n=" + n + (looksList ? " list" : ""));
          }
        }
        if (looksList) {
          if (!jsxSeen["impl:" + cname]) {
            jsxSeen["impl:" + cname] = 1;
            note("messagesImpl=jsx:" + (cname || "anonList") + " (no wrap — FastestList crash)");
          }
        }
        if (
          storage.patchDiscordLists &&
          (cname === "SearchableUserList" || cname === "UsersFastListInner")
        ) {
          var userSorted = sortUserListProps(ret.props);
          if (userSorted && React.cloneElement) {
            if (!jsxSeen["sort:" + cname]) {
              jsxSeen["sort:" + cname] = 1;
              note("jsx sort " + cname);
              hooks.push("jsx:" + cname);
            }
            return React.cloneElement(ret, userSorted);
          }
        }
        var titled = storage.patchDiscordLists ? restyleTitle(ret) : ret;
        if (titled !== ret) {
          note("jsx title");
          return titled;
        }
      } catch (err) {
        note("jsx wrap " + err);
      } finally {
        inJsx = false;
      }
      return ret;
    }
    if (jsx) {
      hookAll(jsx, "jsx", wrap);
      hookAll(jsx, "jsxs", wrap);
    } else if (React && typeof React.createElement === "function") {
      hookAll(React, "createElement", wrap);
    }
  }

  function findNamedList(name) {
    var m = null;
    try {
      if (findByName) m = findByName(name);
    } catch (_) {}
    if (m) return m;
    try {
      if (findByDisplayName) m = findByDisplayName(name);
    } catch (_) {}
    if (m) return m;
    try {
      m = byProps(name);
      if (m && m[name]) return m[name];
      if (m) return m;
    } catch (_) {}
    return null;
  }

  function ctorOf(mod) {
    if (!mod) return null;
    if (typeof mod === "function") return mod;
    if (typeof mod.default === "function") return mod.default;
    if (mod.type && typeof mod.type === "function") return mod.type;
    return null;
  }

  function wrapListRender(C, name) {
    note("list wrap skipped:" + name);
    return false;
  }

  function scanListNames() {
    var names = [];
    try {
      if (typeof metro.findAll !== "function") return;
      var all = metro.findAll(function (m) {
        if (!m) return false;
        var n = m.displayName || m.name || (m.default && (m.default.displayName || m.default.name));
        return typeof n === "string" && /List|Fastest|FastList|FlashList|Recycler/.test(n);
      });
      if (!all) return;
      for (var i = 0; i < Math.min(all.length, 24); i++) {
        var m = all[i];
        var n = m.displayName || m.name || (m.default && (m.default.displayName || m.default.name)) || "?";
        names.push(n);
      }
      if (names.length) note("listNames=" + names.join(","));
    } catch (err) {
      note("listNames err " + err);
    }
  }

  function patchListModules() {
    note("messagesImpl=FastestList (FriendsScreen/UsersFastListInner) — wrap disabled, use OnlineNow page");
  }

  function onLoad() {
    hooks = [];
    debugLog = [];
    hookedPairs = [];
    note("OnlineNow " + VERSION);
    note("bunny=" + !!(bunnyApi) + " definePlugin=" + typeof definePlug);
    note("patcher.after=" + typeof after + " instead=" + typeof instead);
    note("storage.create=" + typeof (pluginApi && pluginApi.createStorage) + " keys=" + Object.keys(storage || {}).slice(0, 8).join(","));
    note("metro=" + Object.keys(metro || {}).slice(0, 12).join(","));
    note("after=" + typeof after + " instead=" + typeof instead);
    note("findByProps=" + typeof findByProps + " store=" + typeof findByStoreName);
    note("waitFor=" + typeof (metro && metro.waitFor));
    note("react=" + !!React + " rn=" + !!ReactNative);
    note("metro.find=" + typeof metro.find);
    try {
      patchFriends();
      patchDms();
      watchPresence();
      patchNowTray();
      patchFriendsNowChip();
      registerOnlineNowSection();
      if (storage.patchDiscordLists) {
        patchVisibleBadge();
        patchJsxLists();
        patchListModules();
      }
    } catch (err) {
      note("onLoad err " + err);
      console.error("[OnlineNow]", err);
    }
    whenReady(RelationshipStore, function () {
      patchFriends();
    }, "RelationshipStore");
    whenReady(PresenceStore, function () {
      watchPresence();
    }, "PresenceStore");
    whenReady(
      function () {
        return byProps("getPrivateChannelIds") || byProps("getMutablePrivateChannels") || ChannelStore();
      },
      function () {
        patchDms();
      },
      "PrivateChannels",
    );
    setTimeout(function () {
      try {
        if (storage.patchDiscordLists) patchListModules();
      } catch (_) {}
    }, 1000);
    setTimeout(function () {
      try {
        patchNowTray();
        patchFriendsNowChip();
        if (storage.patchDiscordLists) {
          patchFriendHeaders();
          patchJsxLists();
          patchListModules();
        }
      } catch (_) {}
      var rel = RelationshipStore();
      var pre = PresenceStore();
      var ch = ChannelStore();
      note("RelationshipStore=" + !!(rel && rel.getFriendIDs) + " " + fnNames(rel));
      note("PresenceStore=" + !!(pre && pre.getStatus) + " " + fnNames(pre));
      note("ChannelStore=" + !!(ch && ch.getChannel) + " " + fnNames(ch));
      note("PrivateChannelSortStore " + fnNames(byStore("PrivateChannelSortStore")));
      toast("OnlineNow " + VERSION + " · Messages → + for online first");
    }, 2500);
  }

  function onUnload() {
    if (presenceTimer) {
      try {
        clearTimeout(presenceTimer);
      } catch (_) {}
      presenceTimer = null;
    }
    while (unpatches.length) {
      try {
        unpatches.pop()();
      } catch (_) {}
    }
    hooks = [];
  }

  var instance = {
    onLoad: onLoad,
    onUnload: onUnload,
    start: onLoad,
    stop: onUnload,
    settings: Settings,
    Settings: Settings,
    SettingsComponent: Settings,
  };
  if (definePlug) {
    try {
      instance = definePlug(instance) || instance;
    } catch (_) {}
  }
  return instance;
})())
