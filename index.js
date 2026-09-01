/**
 * OnlineNow — Classic Revenge / Vendetta / Bunny plugin
 *
 * Install FOLDER URL (not this file):
 *   https://raw.githubusercontent.com/SirTibbles666one/onlinenow/main/
 *
 * Groups friends by status. Puts online people at the top of Messages.
 */
(function (root, factory) {
  var plugin = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = plugin;
    module.exports.default = plugin;
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
      (typeof root !== "undefined" && root.vendetta) ||
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
  var storageUi = vdRequire("@vendetta/storage") || {};
  var useProxy = storageUi.useProxy;
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
    collapseOffline: false,
    hideOffline: false,
    splitIdle: true,
    splitDnd: true,
    dmStrip: true,
    dmOnlineFirst: true,
    showActivity: true,
    stripLimit: 24,
  };

  for (var key in DEFAULTS) {
    if (storage[key] === undefined) storage[key] = DEFAULTS[key];
  }
  if (!Array.isArray(storage.pinnedIds)) storage.pinnedIds = [];
  if (storage._v !== 2) {
    storage.dmOnlineFirst = true;
    storage.collapseOffline = false;
    storage._v = 2;
  }

  var unpatches = [];
  var lastBuckets = emptyBuckets();
  var inFriendSort = false;
  var inDmSort = false;
  var applied = [];

  function emptyBuckets() {
    return { pinned: [], online: [], idle: [], dnd: [], offline: [] };
  }

  function first(fns) {
    for (var i = 0; i < fns.length; i++) {
      try {
        var v = fns[i]();
        if (v) return v;
      } catch (_) {}
    }
    return null;
  }

  function findStore(name, props) {
    return first([
      function () {
        return findByStoreName && findByStoreName(name);
      },
      function () {
        return findByProps && findByProps.apply(null, props);
      },
    ]);
  }

  function stores() {
    return {
      RelationshipStore: findStore("RelationshipStore", ["getFriendIDs", "isFriend"]),
      PresenceStore: findStore("PresenceStore", ["getStatus"]),
      UserStore: findStore("UserStore", ["getCurrentUser", "getUser"]),
      ChannelStore: findStore("ChannelStore", ["getChannel", "getDMFromUserId"]),
    };
  }

  function statusOf(id) {
    try {
      var p = stores().PresenceStore;
      var s = p && p.getStatus && p.getStatus(id);
      if (s === "online" || s === "idle" || s === "dnd" || s === "invisible") return s;
    } catch (_) {}
    return "offline";
  }

  function bucketOf(status) {
    if (status === "idle" && !storage.splitIdle) return "online";
    if (status === "dnd" && !storage.splitDnd) return "online";
    if (status === "online" || status === "idle" || status === "dnd") return status;
    return "offline";
  }

  function rankStatus(status) {
    var b = bucketOf(status);
    if (b === "online") return 0;
    if (b === "idle") return 1;
    if (b === "dnd") return 2;
    return 3;
  }

  function isPinned(id) {
    id = String(id);
    return (storage.pinnedIds || []).indexOf(id) !== -1;
  }

  function orderFriendIds(ids) {
    if (!Array.isArray(ids) || !storage.friendsGrouping) return ids;
    var pinned = [];
    var online = [];
    var idle = [];
    var dnd = [];
    var offline = [];
    var buckets = { pinned: pinned, online: online, idle: idle, dnd: dnd, offline: offline };
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var sid = String(id);
      var bucket = isPinned(sid) ? "pinned" : bucketOf(statusOf(sid));
      if (storage.hideOffline && bucket === "offline") continue;
      buckets[bucket].push(id);
    }
    lastBuckets = {
      pinned: pinned.slice(),
      online: online.slice(),
      idle: idle.slice(),
      dnd: dnd.slice(),
      offline: offline.slice(),
    };
    var out = pinned.concat(online, idle, dnd);
    if (!storage.hideOffline && !storage.collapseOffline) out = out.concat(offline);
    return out;
  }

  function recipientIds(channel) {
    if (!channel) return [];
    if (Array.isArray(channel.recipients) && channel.recipients.length) return channel.recipients;
    if (channel.rawRecipients && channel.rawRecipients.length) {
      return channel.rawRecipients.map(function (u) {
        return u && (u.id || u);
      });
    }
    return [];
  }

  function dmScore(channelId) {
    var ChannelStore = stores().ChannelStore;
    var ch = ChannelStore && ChannelStore.getChannel && ChannelStore.getChannel(channelId);
    if (!ch) return 3;
    var recips = recipientIds(ch);
    if (!recips.length && ch.type === 1) return rankStatus(statusOf(ch.id));
    var best = 3;
    for (var i = 0; i < recips.length; i++) {
      var r = recips[i];
      if (r == null) continue;
      var sc = rankStatus(statusOf(r));
      if (isPinned(r)) sc = -1;
      if (sc < best) best = sc;
    }
    return best;
  }

  function sortDmIds(ids) {
    if (!Array.isArray(ids) || !storage.dmOnlineFirst) return ids;
    return ids.slice().sort(function (a, b) {
      return dmScore(a) - dmScore(b);
    });
  }

  function sortDmChannels(list) {
    if (!Array.isArray(list) || !storage.dmOnlineFirst) return list;
    return list.slice().sort(function (a, b) {
      var aid = a && (a.id || a.channel_id || a);
      var bid = b && (b.id || b.channel_id || b);
      return dmScore(aid) - dmScore(bid);
    });
  }

  function patchMethod(host, method, fn) {
    if (!host || typeof host[method] !== "function" || !after) return false;
    try {
      unpatches.push(after(method, host, fn));
      applied.push(method);
      return true;
    } catch (_) {
      return false;
    }
  }

  function patchFriendOrder() {
    var store = stores().RelationshipStore;
    if (!store) return;
    var targets = [store];
    try {
      var proto = Object.getPrototypeOf(store);
      if (proto && proto !== Object.prototype) targets.push(proto);
    } catch (_) {}
    for (var t = 0; t < targets.length; t++) {
      patchMethod(targets[t], "getFriendIDs", function (_args, ids) {
        if (inFriendSort || !Array.isArray(ids)) return ids;
        inFriendSort = true;
        try {
          return orderFriendIds(ids);
        } catch (_) {
          return ids;
        } finally {
          inFriendSort = false;
        }
      });
    }
  }

  function patchDmOrder() {
    var ChannelStore = stores().ChannelStore;
    var extras = [
      ChannelStore,
      findByProps && findByProps("getPrivateChannelIds"),
      findByStoreName && findByStoreName("PrivateChannelSortStore"),
      findByProps && findByProps("getSortedPrivateChannels"),
      findByProps && findByProps("getPrivateChannels"),
    ];
    var seen = [];
    function once(obj, method, wrap) {
      if (!obj || seen.indexOf(obj) >= 0) return;
      if (typeof obj[method] !== "function") return;
      seen.push(obj);
      patchMethod(obj, method, wrap);
    }
    for (var i = 0; i < extras.length; i++) {
      var mod = extras[i];
      if (!mod) continue;
      once(mod, "getPrivateChannelIds", function (_a, res) {
        if (inDmSort) return res;
        inDmSort = true;
        try {
          return sortDmIds(res);
        } catch (_) {
          return res;
        } finally {
          inDmSort = false;
        }
      });
      once(mod, "getSortedPrivateChannels", function (_a, res) {
        if (inDmSort) return res;
        inDmSort = true;
        try {
          return Array.isArray(res) && res.length && typeof res[0] === "object"
            ? sortDmChannels(res)
            : sortDmIds(res);
        } catch (_) {
          return res;
        } finally {
          inDmSort = false;
        }
      });
    }
  }

  var styles =
    StyleSheet &&
    StyleSheet.create({
      stripWrap: {
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#2a2d33",
      },
      stripLabel: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.2,
        color: "#3ba55c",
      },
      stripRow: { paddingHorizontal: 12, flexDirection: "row" },
      stripItem: { width: 64, alignItems: "center", marginHorizontal: 4 },
      stripName: { fontSize: 11, color: "#8b8f98", marginTop: 6, width: "100%", textAlign: "center" },
      avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2f5d46",
        borderWidth: 2,
        borderColor: "#3ba55c",
      },
      avatarLetter: { color: "#f2f3f5", fontWeight: "700", fontSize: 16 },
      settingPage: { paddingVertical: 8 },
      settingRow: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      },
      settingLabel: { color: "#f2f3f5", fontSize: 16, fontWeight: "600" },
      settingHint: { color: "#8b8f98", fontSize: 12, marginTop: 4, maxWidth: 240 },
    });

  function initials(name) {
    return String(name || "?")
      .split(" ")
      .slice(0, 2)
      .map(function (p) {
        return p[0];
      })
      .join("")
      .toUpperCase();
  }

  function displayName(id) {
    try {
      var u = stores().UserStore && stores().UserStore.getUser(id);
      return (u && (u.globalName || u.displayName || u.username)) || String(id);
    } catch (_) {
      return String(id);
    }
  }

  function openDM(userId) {
    var open = first([
      function () {
        var m = findByProps && findByProps("openPrivateChannel");
        return m && m.openPrivateChannel;
      },
      function () {
        var m = findByProps && findByProps("ensurePrivateChannel");
        return m && m.ensurePrivateChannel;
      },
    ]);
    if (!open) return;
    Promise.resolve(open(userId)).then(function (channelId) {
      var id = channelId;
      if (id && typeof id === "object") id = id.id || id.channelId;
      if (!id) return;
      var nav = findByProps && (findByProps("transitionToGuild") || findByProps("transitionTo"));
      if (nav && nav.transitionToGuild) nav.transitionToGuild(id);
      else if (nav && nav.transitionTo) nav.transitionTo("/channels/@me/" + id);
    });
  }

  function OnlineStrip() {
    if (!e || !storage.dmStrip) return null;
    var ids = lastBuckets.pinned.concat(lastBuckets.online, lastBuckets.idle, lastBuckets.dnd);
    if (!ids.length) {
      try {
        var raw = stores().RelationshipStore && stores().RelationshipStore.getFriendIDs();
        ids = (raw || []).filter(function (id) {
          return rankStatus(statusOf(id)) < 3;
        });
      } catch (_) {}
    }
    ids = ids.slice(0, storage.stripLimit || 24);
    if (!ids.length) return null;
    return e(
      View,
      { style: styles.stripWrap },
      e(Text, { style: styles.stripLabel }, "ONLINE NOW · " + ids.length),
      e(
        ScrollView,
        { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.stripRow },
        ids.map(function (id) {
          var name = displayName(id);
          return e(
            Pressable,
            { key: String(id), style: styles.stripItem, onPress: function () { openDM(id); } },
            e(View, { style: styles.avatar }, e(Text, { style: styles.avatarLetter }, initials(name))),
            e(Text, { style: styles.stripName, numberOfLines: 1 }, String(name).split(" ")[0]),
          );
        }),
      ),
    );
  }

  function patchListHeader() {
    if (!after || !e) return;
    var names = [
      "ConnectedPrivateChannels",
      "PrivateChannels",
      "PrivateChannelList",
      "InstantPrivateChannels",
      "Messages",
    ];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var Comp = null;
      try {
        Comp = findByName && findByName(n);
      } catch (_) {}
      if (!Comp) {
        try {
          Comp = findByDisplayName && findByDisplayName(n);
        } catch (_) {}
      }
      if (!Comp) continue;
      var inst = Comp.default || Comp.type || Comp;
      var method = inst.render ? "render" : inst.type ? "type" : null;
      if (!method) continue;
      var host = inst.render ? inst : { type: inst };
      unpatches.push(
        after(method, host, function (_args, ret) {
          if (!storage.dmStrip || !ret) return ret;
          var strip = e(OnlineStrip, null);
          if (!strip) return ret;
          try {
            if (ret.props) {
              var existing = ret.props.ListHeaderComponent;
              return React.cloneElement(ret, {
                ListHeaderComponent: function () {
                  return e(View, null, strip, typeof existing === "function" ? e(existing) : existing || null);
                },
              });
            }
          } catch (_) {}
          return e(View, { style: { flex: 1 } }, strip, ret);
        }),
      );
      applied.push("header:" + names[i]);
      break;
    }
  }

  var TOGGLES = [
    ["friendsGrouping", "Group Friends by status", "Online, Idle, DND, Offline — online first"],
    ["splitIdle", "Keep Idle separate", "Otherwise Idle sits with Online"],
    ["splitDnd", "Keep Do Not Disturb separate", "Otherwise DND sits with Online"],
    ["hideOffline", "Hide Offline friends", "Never show Offline in Friends"],
    ["dmOnlineFirst", "Online at top of Messages", "People who are around sit above recency"],
    ["dmStrip", "Online-now strip on Chat", "Avatars of people who are around"],
    ["showActivity", "Show activity line", "Playing / listening under the name"],
  ];

  function Switch(props) {
    if (Forms && Forms.FormSwitch) {
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
      { style: styles && styles.settingPage },
      TOGGLES.map(function (row) {
        return e(
          View,
          { key: row[0], style: styles && styles.settingRow },
          e(
            View,
            { style: { flex: 1, paddingRight: 12 } },
            e(Text, { style: styles && styles.settingLabel }, row[1]),
            e(Text, { style: styles && styles.settingHint }, row[2]),
          ),
          e(Switch, {
            value: !!storage[row[0]],
            onChange: function (v) {
              storage[row[0]] = v;
            },
          }),
        );
      }),
      e(
        Text,
        { style: [styles && styles.settingHint, { paddingHorizontal: 16, paddingTop: 12 }] },
        "If Messages still looks like recency-only, open this plugin in Revenge settings and confirm it is enabled. OnlineNow never sends messages.",
      ),
    );
  }

  function toast(msg) {
    try {
      if (toasts.showToast) toasts.showToast(msg);
    } catch (_) {}
  }

  function onLoad() {
    try {
      patchFriendOrder();
      patchDmOrder();
      patchListHeader();
      var s = stores();
      var bump = function () {};
      if (s.PresenceStore && s.PresenceStore.addChangeListener) {
        s.PresenceStore.addChangeListener(bump);
        unpatches.push(function () {
          s.PresenceStore.removeChangeListener && s.PresenceStore.removeChangeListener(bump);
        });
      }
      toast("OnlineNow on · " + (applied.length ? applied.length + " hooks" : "no hooks — check logs"));
    } catch (err) {
      console.error("[OnlineNow] failed to load", err);
      toast("OnlineNow failed to load");
    }
  }

  function onUnload() {
    while (unpatches.length) {
      try {
        unpatches.pop()();
      } catch (_) {}
    }
    applied = [];
  }

  return { onLoad: onLoad, onUnload: onUnload, settings: Settings };
});
