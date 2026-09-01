/**
 * OnlineNow — Classic Revenge 1.11.x (1b1d297) / Discord 342
 *
 * Folder install URL, not this file:
 *   …/plugin/   or   https://raw.githubusercontent.com/SirTibbles666one/onlinenow/main/
 */
(function (root, factory) {
  var plugin = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = plugin;
    module.exports.default = function () {
      return plugin;
    };
  }
  return plugin;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function vdRequire(id) {
    try {
      if (typeof require === "function") {
        var got = require(id);
        if (got) return got;
      }
    } catch (_) {}
    var vendetta =
      (root && root.vendetta) ||
      (typeof globalThis !== "undefined" && globalThis.vendetta) ||
      {};
    var path = String(id)
      .replace(/^@vendetta\/?/, "")
      .split("/")
      .filter(Boolean);
    var cur = vendetta;
    for (var i = 0; i < path.length; i++) cur = cur && cur[path[i]];
    return cur || null;
  }

  var metro = vdRequire("@vendetta/metro") || {};
  var findByProps = metro.findByProps;
  var findByStoreName = metro.findByStoreName;
  var findByName = metro.findByName;
  var findByDisplayName = metro.findByDisplayName;
  var common = vdRequire("@vendetta/metro/common") || {};
  var React = common.React;
  var ReactNative = common.ReactNative;
  var patcher = vdRequire("@vendetta/patcher") || {};
  var after = patcher.after;
  var pluginApi = vdRequire("@vendetta/plugin") || {};
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
  var inFriend = false;
  var inDm = false;

  function toast(msg) {
    try {
      if (typeof toasts.showToast === "function") toasts.showToast(msg);
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
    try {
      return findByProps && findByProps.apply(null, arguments);
    } catch (_) {
      return null;
    }
  }

  function PresenceStore() {
    return pick(function () {
      return byStore("PresenceStore");
    }, function () {
      return byProps("getStatus", "getActivities");
    }, function () {
      return byProps("getStatus");
    });
  }

  function RelationshipStore() {
    return pick(function () {
      return byStore("RelationshipStore");
    }, function () {
      return byProps("getFriendIDs", "isFriend");
    }, function () {
      return byProps("getFriendIDs");
    });
  }

  function ChannelStore() {
    return pick(function () {
      return byStore("ChannelStore");
    }, function () {
      return byProps("getChannel", "getDMFromUserId");
    }, function () {
      return byProps("getChannel");
    });
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
    if (!Array.isArray(ids) || !storage.friendsGrouping) return ids;
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
    if (!Array.isArray(ids) || !storage.dmOnlineFirst) return ids;
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
    if (!host || !after || typeof host[method] !== "function") return false;
    try {
      unpatches.push(after(method, host, wrap));
      hooks.push(method);
      return true;
    } catch (_) {
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
      if (inFriend || !Array.isArray(ids)) return ids;
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
      byProps("getPrivateChannelIds"),
      byProps("getSortedPrivateChannels"),
      byProps("getPrivateChannelList"),
      byProps("getMutablePrivateChannels"),
    ];
    var seen = [];
    for (var i = 0; i < mods.length; i++) {
      var m = mods[i];
      if (!m || seen.indexOf(m) >= 0) continue;
      seen.push(m);
      hookAll(m, "getPrivateChannelIds", wrapIds);
      hookAll(m, "getSortedPrivateChannels", wrapList);
      hookAll(m, "getPrivateChannelList", wrapList);
      hookAll(m, "getMutablePrivateChannels", wrapMap);
      hookAll(m, "getPrivateChannels", wrapMap);
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
    if (useProxy) useProxy(storage);
    if (!e) return null;
    return e(
      ScrollView,
      { style: styles && styles.page },
      e(Text, { style: styles && styles.title }, "OnlineNow"),
      e(
        Text,
        { style: styles && styles.hint },
        hooks.length
          ? "Loaded. Hooks: " + hooks.join(", ")
          : "Loaded but no Discord lists were hooked. Screenshot this page.",
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

  function onLoad() {
    hooks = [];
    try {
      patchFriends();
      patchDms();
      watchPresence();
      patchStrip();
      patchFriendHeaders();
    } catch (err) {
      console.error("[OnlineNow]", err);
    }
    toast(hooks.length ? "OnlineNow on · " + hooks.length + " hooks" : "OnlineNow on · 0 hooks");
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
  };
});
