(plugin = (function () {
  "use strict";

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var bunnyApi = typeof bunny !== "undefined" ? bunny : null;

  function vdRequire(id) {
    var vd =
      (typeof vendetta !== "undefined" && vendetta) ||
      (root && root.vendetta) ||
      {};
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
      if (id === "@vendetta/metro") return bunnyApi.metro || vd.metro;
      if (id === "@vendetta/metro/common")
        return (bunnyApi.metro && bunnyApi.metro.common) || (vd.metro && vd.metro.common);
      if (id === "@vendetta/patcher") return bunnyApi.patcher || vd.patcher;
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
  var patcher = vdRequire("@vendetta/patcher") || (bunnyApi && bunnyApi.patcher) || {};
  var after = patcher.after;
  var instead = patcher.instead;
  var pluginApi = vdRequire("@vendetta/plugin") || (bunnyApi && bunnyApi.plugin) || {};
  var storage = pluginApi.storage || {};
  var useProxy = (vdRequire("@vendetta/storage") || {}).useProxy;
  var Forms = (vdRequire("@vendetta/ui/components") || {}).Forms || {};
  var toasts = vdRequire("@vendetta/ui/toasts") || {};

  var e = React && React.createElement;
  var View = ReactNative && ReactNative.View;
  var Text = ReactNative && ReactNative.Text;
  var ScrollView = ReactNative && ReactNative.ScrollView;
  var Pressable = ReactNative && ReactNative.Pressable;
  var StyleSheet = ReactNative && ReactNative.StyleSheet;

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

  var DEFAULTS = {
    friendsGrouping: true,
    hideOffline: false,
    splitIdle: true,
    splitDnd: true,
    dmOnlineFirst: true,
    dmStrip: true,
  };

  for (var k in DEFAULTS) {
    if (storage[k] === undefined) storage[k] = DEFAULTS[k];
  }
  storage._v = 4;
  storage.dmOnlineFirst = true;
  storage.friendsGrouping = storage.friendsGrouping !== false;
  if (!Array.isArray(storage.pinnedIds)) storage.pinnedIds = [];

  var unpatches = [];
  var hooks = [];
  var hookedPairs = [];
  var inFriend = false;
  var inDm = false;

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
      return rankChannel(a) - rankChannel(b);
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
      bumpLists();
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
                if (open) Promise.resolve(open(id));
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

  function patchStrip() {
    var found = findComp([
      "ConnectedPrivateChannels",
      "PrivateChannels",
      "PrivateChannelList",
      "Messages",
      "InstantPrivateChannels",
    ]);
    if (!found) return;
    patchAfterRender(
      found,
      function (_args, ret) {
        if (!storage.dmStrip || !ret) return ret;
        var strip = e(OnlineStrip, null);
        if (!strip) return ret;
        try {
          if (ret.props && React && React.cloneElement) {
            var existing = ret.props.ListHeaderComponent;
            return React.cloneElement(ret, {
              ListHeaderComponent: function () {
                return e(View, null, strip, typeof existing === "function" ? e(existing) : existing || null);
              },
            });
          }
        } catch (_) {}
        return e(View, { style: { flex: 1 } }, strip, ret);
      },
      "strip",
    );
  }

  function patchFriendHeaders() {
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
      page: { paddingVertical: 8, paddingHorizontal: 16 },
      title: { color: "#f2f3f5", fontSize: 16, fontWeight: "700", marginBottom: 8 },
      hint: { color: "#8b8f98", fontSize: 12, marginBottom: 16, lineHeight: 18 },
      row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
      },
      label: { color: "#f2f3f5", fontSize: 16, fontWeight: "600", maxWidth: 240 },
      sub: { color: "#8b8f98", fontSize: 12, marginTop: 4, maxWidth: 240 },
    });

  var TOGGLES = [
    ["friendsGrouping", "Online first on Friends", "All tab: Online, Idle, DND, Offline"],
    ["splitIdle", "Keep Idle separate", "Otherwise Idle counts as online"],
    ["splitDnd", "Keep DND separate", "Otherwise DND counts as online"],
    ["dmOnlineFirst", "Online first on Messages", "People who are around sit at the top"],
    ["dmStrip", "Online-now strip on Chat", "Avatars of people who are around"],
    ["hideOffline", "Hide Offline on Friends", "Drop Offline from the All tab"],
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

  function Settings() {
    try {
      if (useProxy) useProxy(storage);
    } catch (_) {}
    if (!e) return null;
    var log = (storage._debug && storage._debug.length ? storage._debug : debugLog) || [];
    return e(
      ScrollView,
      { style: styles && styles.page },
      e(Text, { style: styles && styles.title }, "OnlineNow debug"),
      e(
        Text,
        { style: styles && styles.hint },
        (hooks.length ? "Hooks: " + hooks.join(", ") : "No hooks yet.") +
          "\n\n" +
          (log.length ? log.join("\n") : "Enable the plugin, wait 3s, reopen this page."),
      ),
      TOGGLES.map(function (row) {
        return e(
          View,
          { key: row[0], style: styles && styles.row },
          e(
            View,
            { style: { flex: 1, paddingRight: 12 } },
            e(Text, { style: styles && styles.label }, row[1]),
            e(Text, { style: styles && styles.sub }, row[2]),
          ),
          e(Switch, {
            value: !!storage[row[0]],
            onChange: function (v) {
              storage[row[0]] = v;
            },
          }),
        );
      }),
    );
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
      "OnlineNow · online people first",
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
    if (next && !props.ListHeaderComponent) next.ListHeaderComponent = onlineHeader;
    if (next) next.extraData = "onlinenow";
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
    function wrap(_args, ret) {
      if (inJsx || !ret || !ret.props) return ret;
      inJsx = true;
      try {
        var titled = restyleTitle(ret);
        if (titled !== ret) {
          note("jsx title");
          return titled;
        }
        var listed = restyleList(ret);
        if (listed !== ret) {
          note("jsx list");
          return listed;
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

  function patchListModules() {
    var specs = [
      ["FlashList"],
      ["FlatList"],
      ["SectionList"],
      ["VirtualizedList"],
      ["LegendList"],
      ["RecyclerListView"],
      ["FastList"],
    ];
    for (var i = 0; i < specs.length; i++) {
      var name = specs[i][0];
      var mod = byProps(name);
      var C = mod && (mod[name] || mod.default);
      if (!C) continue;
      var proto = C.prototype;
      if (proto && typeof proto.render === "function") {
        if (!instead) continue;
        try {
          if (hookedPairs.some(function (p) { return p[0] === proto && p[1] === "render"; })) continue;
          hookedPairs.push([proto, "render"]);
          unpatches.push(
            instead("render", proto, function (args, orig) {
              var self = this;
              var next = self && sortedProps(self.props);
              if (!next) return orig.apply(self, args);
              var prev = self.props;
              self.props = Object.assign({}, prev, next);
              try {
                return orig.apply(self, args);
              } finally {
                self.props = prev;
              }
            }),
          );
          hooks.push("list:" + name);
          note("list:" + name);
        } catch (err) {
          note("list fail " + name + " " + err);
        }
      }
    }
  }

  function onLoad() {
    hooks = [];
    debugLog = [];
    hookedPairs = [];
    note("bunny=" + (bunnyApi ? Object.keys(bunnyApi).slice(0, 12).join(",") : "no"));
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
      patchStrip();
      patchFriendHeaders();
      patchVisibleBadge();
      patchJsxLists();
      patchListModules();
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
        patchStrip();
        patchFriendHeaders();
        patchJsxLists();
        patchListModules();
      } catch (_) {}
      var rel = RelationshipStore();
      var pre = PresenceStore();
      var ch = ChannelStore();
      note("RelationshipStore=" + !!(rel && rel.getFriendIDs) + " " + fnNames(rel));
      note("PresenceStore=" + !!(pre && pre.getStatus) + " " + fnNames(pre));
      note("ChannelStore=" + !!(ch && ch.getChannel) + " " + fnNames(ch));
      note("PrivateChannelSortStore " + fnNames(byStore("PrivateChannelSortStore")));
      toast(hooks.length ? "OnlineNow on · " + hooks.length + " hooks" : "OnlineNow on · 0 hooks — open plugin settings");
    }, 2500);
  }

  function onUnload() {
    while (unpatches.length) {
      try {
        unpatches.pop()();
      } catch (_) {}
    }
    hooks = [];
  }

  return {
    onLoad: onLoad,
    onUnload: onUnload,
    start: onLoad,
    stop: onUnload,
    settings: Settings,
    Settings: Settings,
    SettingsComponent: Settings,
  };
})())
