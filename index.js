/**
 * OnlineNow — Classic Revenge / Vendetta / Bunny plugin
 *
 * Install URL is the FOLDER, not this file:
 *   Settings → Revenge → Plugins → Install → paste …/plugin/
 * Revenge fetches manifest.json, then this script.
 *
 * Groups friends by status, pins, Online-now strip on Chat.
 * Reads local Flux stores only. DMs open through Discord's own action.
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
  var common = vdRequire("@vendetta/metro/common") || {};
  var React = common.React;
  var ReactNative = common.ReactNative;
  var patcher = vdRequire("@vendetta/patcher") || {};
  var after = patcher.after;
  var pluginApi = vdRequire("@vendetta/plugin") || {};
  var storage = pluginApi.storage || {};
  var storageUi = vdRequire("@vendetta/storage") || {};
  var useProxy = storageUi.useProxy;
  var uiComponents = vdRequire("@vendetta/ui/components") || {};
  var Forms = uiComponents.Forms || {};

  var e = React && React.createElement;
  var View = ReactNative && ReactNative.View;
  var Text = ReactNative && ReactNative.Text;
  var ScrollView = ReactNative && ReactNative.ScrollView;
  var Pressable = ReactNative && ReactNative.Pressable;
  var StyleSheet = ReactNative && ReactNative.StyleSheet;

  var STATUS_ORDER = ["pinned", "online", "idle", "dnd", "offline"];
  var STATUS_LABEL = {
    pinned: "PINNED",
    online: "ONLINE",
    idle: "IDLE",
    dnd: "DO NOT DISTURB",
    offline: "OFFLINE",
  };
  var STATUS_COLOR = {
    pinned: "#f2f3f5",
    online: "#3ba55c",
    idle: "#c9a227",
    dnd: "#d44548",
    offline: "#6d7178",
  };

  var DEFAULTS = {
    friendsGrouping: true,
    collapseOffline: true,
    hideOffline: false,
    splitIdle: true,
    splitDnd: true,
    dmStrip: true,
    dmOnlineFirst: false,
    showActivity: true,
    showPlatform: true,
    stripLimit: 24,
  };

  for (var key in DEFAULTS) {
    if (storage[key] === undefined) storage[key] = DEFAULTS[key];
  }
  if (!Array.isArray(storage.pinnedIds)) storage.pinnedIds = [];

  var unpatches = [];
  var lastBuckets = emptyBuckets();
  var rebuildTimer = null;

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

  function stores() {
    return {
      RelationshipStore: first([
        function () {
          return findByStoreName && findByStoreName("RelationshipStore");
        },
        function () {
          return findByProps && findByProps("getFriendIDs", "isFriend");
        },
      ]),
      PresenceStore: first([
        function () {
          return findByStoreName && findByStoreName("PresenceStore");
        },
        function () {
          return findByProps && findByProps("getStatus", "getActivities");
        },
      ]),
      UserStore: first([
        function () {
          return findByStoreName && findByStoreName("UserStore");
        },
        function () {
          return findByProps && findByProps("getUser", "getCurrentUser");
        },
      ]),
      ChannelStore: first([
        function () {
          return findByStoreName && findByStoreName("ChannelStore");
        },
        function () {
          return findByProps && findByProps("getDMFromUserId", "getChannel");
        },
      ]),
    };
  }

  function isPinned(id) {
    return (storage.pinnedIds || []).indexOf(id) !== -1;
  }

  function togglePin(id) {
    var cur = Array.isArray(storage.pinnedIds) ? storage.pinnedIds.slice() : [];
    var i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1);
    else cur.unshift(id);
    storage.pinnedIds = cur;
    rebuild();
  }

  function bucketOf(status) {
    if (status === "idle" && !storage.splitIdle) return "online";
    if (status === "dnd" && !storage.splitDnd) return "online";
    if (status === "online" || status === "idle" || status === "dnd") return status;
    return "offline";
  }

  function activityLine(activities) {
    if (!storage.showActivity || !Array.isArray(activities) || activities.length === 0) return null;
    var play, listen, custom, i, a;
    for (i = 0; i < activities.length; i++) {
      a = activities[i];
      if (!a) continue;
      if (a.type === 0 && !play) play = a;
      if (a.type === 2 && !listen) listen = a;
      if (a.type === 4 && !custom) custom = a;
    }
    a = play || listen || custom || activities[0];
    if (!a) return null;
    if (a.type === 0) return a.name ? "Playing " + a.name : null;
    if (a.type === 2) return a.details || a.name || null;
    if (a.type === 4) return a.state || a.name || null;
    return a.name || null;
  }

  function lastDmTs(ChannelStore, userId) {
    try {
      var chId = ChannelStore && ChannelStore.getDMFromUserId && ChannelStore.getDMFromUserId(userId);
      if (!chId) return 0;
      var ch = ChannelStore.getChannel && ChannelStore.getChannel(chId);
      if (!ch) return 0;
      return Number(ch.lastMessageTimestamp || ch.lastMessageId || 0) || 0;
    } catch (_) {
      return 0;
    }
  }

  function compareRows(a, b) {
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    return String(a.name).localeCompare(String(b.name));
  }

  function rebuild() {
    var s = stores();
    var buckets = emptyBuckets();
    if (!s.RelationshipStore || !s.PresenceStore) {
      lastBuckets = buckets;
      return buckets;
    }
    var ids = [];
    try {
      ids = s.RelationshipStore.getFriendIDs() || [];
    } catch (_) {
      ids = [];
    }
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var status = bucketOf(s.PresenceStore.getStatus && s.PresenceStore.getStatus(id));
      if (storage.hideOffline && status === "offline") continue;
      if (storage.collapseOffline && status === "offline") continue;
      var user = s.UserStore && s.UserStore.getUser && s.UserStore.getUser(id);
      var row = {
        id: id,
        name: (user && (user.globalName || user.displayName || user.username)) || String(id),
        username: (user && user.username) || "",
        status: status,
        activity: activityLine(s.PresenceStore.getActivities && s.PresenceStore.getActivities(id)),
        platforms: Object.keys((s.PresenceStore.getClientStatus && s.PresenceStore.getClientStatus(id)) || {}),
        lastTs: lastDmTs(s.ChannelStore, id),
        pinned: isPinned(id),
      };
      if (row.pinned) buckets.pinned.push(row);
      else buckets[status].push(row);
    }
    for (var k = 0; k < STATUS_ORDER.length; k++) {
      buckets[STATUS_ORDER[k]].sort(compareRows);
    }
    lastBuckets = buckets;
    return buckets;
  }

  function scheduleRebuild() {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      rebuildTimer = null;
      rebuild();
    }, 150);
  }

  function sortedIds() {
    var buckets = rebuild();
    var out = [];
    for (var i = 0; i < STATUS_ORDER.length; i++) {
      var list = buckets[STATUS_ORDER[i]];
      for (var j = 0; j < list.length; j++) out.push(list[j].id);
    }
    return out;
  }

  function firstIds() {
    var firstMap = {};
    for (var i = 0; i < STATUS_ORDER.length; i++) {
      var key = STATUS_ORDER[i];
      if (lastBuckets[key][0]) firstMap[lastBuckets[key][0].id] = key;
    }
    return firstMap;
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
      function () {
        var m = findByProps && findByProps("getOrCreatePrivateChannel");
        return m && m.getOrCreatePrivateChannel;
      },
    ]);
    if (!open) return;
    Promise.resolve(open(userId)).then(function (channelId) {
      var id = channelId;
      if (id && typeof id === "object") id = id.id || id.channelId;
      if (!id) return;
      var nav = first([
        function () {
          return findByProps && findByProps("transitionToGuild");
        },
        function () {
          return findByProps && findByProps("transitionTo");
        },
      ]);
      if (nav && nav.transitionToGuild) nav.transitionToGuild(id);
      else if (nav && nav.transitionTo) nav.transitionTo("/channels/@me/" + id);
    });
  }

  var styles =
    StyleSheet &&
    StyleSheet.create({
      header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 4,
        flexDirection: "row",
        alignItems: "center",
      },
      headerText: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
      headerCount: { fontSize: 11, color: "#8b8f98", marginLeft: 6 },
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
      stripName: {
        fontSize: 11,
        color: "#8b8f98",
        marginTop: 6,
        width: "100%",
        textAlign: "center",
      },
      avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2f5d46",
        borderWidth: 2,
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

  function Header(props) {
    if (!e) return null;
    return e(
      View,
      { style: styles.header },
      e(Text, { style: [styles.headerText, { color: STATUS_COLOR[props.status] }] }, STATUS_LABEL[props.status]),
      e(Text, { style: styles.headerCount }, String(props.count)),
    );
  }

  function OnlineStrip() {
    if (!e || !storage.dmStrip) return null;
    var online = lastBuckets.pinned
      .concat(lastBuckets.online, lastBuckets.idle, lastBuckets.dnd)
      .slice(0, storage.stripLimit || 24);
    if (online.length === 0) return null;
    return e(
      View,
      { style: styles.stripWrap },
      e(Text, { style: styles.stripLabel }, "ONLINE NOW · " + online.length),
      e(
        ScrollView,
        { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.stripRow },
        online.map(function (row) {
          return e(
            Pressable,
            { key: row.id, style: styles.stripItem, onPress: function () { openDM(row.id); } },
            e(
              View,
              {
                style: [
                  styles.avatar,
                  { borderColor: STATUS_COLOR[row.pinned ? "online" : row.status] || STATUS_COLOR.online },
                ],
              },
              e(Text, { style: styles.avatarLetter }, initials(row.name)),
            ),
            e(Text, { style: styles.stripName, numberOfLines: 1 }, String(row.name).split(" ")[0]),
          );
        }),
      ),
    );
  }

  function patchFriendOrder() {
    var RelationshipStore = stores().RelationshipStore;
    if (!RelationshipStore || !RelationshipStore.getFriendIDs || !after) return;
    unpatches.push(
      after("getFriendIDs", RelationshipStore, function (_args, ids) {
        if (!storage.friendsGrouping || !Array.isArray(ids)) return ids;
        var order = sortedIds();
        var rank = {};
        for (var i = 0; i < order.length; i++) rank[order[i]] = i;
        return ids.slice().sort(function (a, b) {
          var aa = rank[a];
          var bb = rank[b];
          if (aa === undefined && bb === undefined) return 0;
          if (aa === undefined) return 1;
          if (bb === undefined) return -1;
          return aa - bb;
        });
      }),
    );
  }

  function patchFriendRows() {
    if (!findByName || !after || !e) return;
    var names = ["FriendRow", "FriendsRow", "UserListItem", "PeopleListItem", "FriendsListItem"];
    var Row = null;
    for (var i = 0; i < names.length; i++) {
      try {
        Row = findByName(names[i]);
        if (Row) break;
      } catch (_) {}
    }
    if (!Row) return;
    var target = Row.default || Row;
    var isRender = !!target.render;
    var host = isRender ? target : { type: target };
    var method = isRender ? "render" : "type";
    unpatches.push(
      after(method, host, function (args, ret) {
        if (!storage.friendsGrouping) return ret;
        var props = (args && args[0]) || {};
        var userId = props.userId || (props.user && props.user.id) || props.user;
        if (!userId || typeof userId !== "string") return ret;
        var first = firstIds();
        var status = first[userId];
        if (!status) return ret;
        return e(View, null, e(Header, { status: status, count: lastBuckets[status].length }), ret);
      }),
    );
  }

  function patchPrivateChannels() {
    if (!after || !e) return;
    var Comp = first([
      function () {
        return findByName && findByName("ConnectedPrivateChannels");
      },
      function () {
        return findByName && findByName("PrivateChannels");
      },
      function () {
        return findByName && findByName("PrivateChannelList");
      },
      function () {
        return findByProps && findByProps("PrivateChannels");
      },
    ]);
    if (!Comp) return;
    var inst = Comp.default || Comp.type || Comp;
    var method = inst.render ? "render" : inst.type ? "type" : null;
    if (!method) return;
    var host = inst.render ? inst : { type: inst };
    unpatches.push(
      after(method, host, function (_args, ret) {
        if (!storage.dmStrip || !ret) return ret;
        rebuild();
        var strip = e(OnlineStrip, null);
        if (!strip) return ret;
        try {
          if (ret.props) {
            var existing = ret.props.ListHeaderComponent;
            var wrapped = function () {
              return e(
                View,
                null,
                strip,
                typeof existing === "function" ? e(existing) : existing || null,
              );
            };
            return React.cloneElement(ret, { ListHeaderComponent: wrapped });
          }
        } catch (_) {}
        return e(View, { style: { flex: 1 } }, strip, ret);
      }),
    );
  }

  function patchDmOrder() {
    if (!after) return;
    var ChannelStore = stores().ChannelStore;
    var sortMod = first([
      function () {
        return findByProps && findByProps("getPrivateChannelIds");
      },
      function () {
        return findByStoreName && findByStoreName("PrivateChannelSortStore");
      },
      function () {
        return findByProps && findByProps("getSortedPrivateChannels");
      },
    ]);
    if (!sortMod) return;
    var method = sortMod.getPrivateChannelIds
      ? "getPrivateChannelIds"
      : sortMod.getSortedPrivateChannels
        ? "getSortedPrivateChannels"
        : null;
    if (!method) return;
    unpatches.push(
      after(method, sortMod, function (_args, res) {
        if (!storage.dmOnlineFirst || !Array.isArray(res)) return res;
        var PresenceStore = stores().PresenceStore;
        function score(id) {
          var ch = ChannelStore && ChannelStore.getChannel && ChannelStore.getChannel(id);
          var recip = ch && ch.recipients && ch.recipients[0];
          if (!recip) return 1;
          return bucketOf(PresenceStore && PresenceStore.getStatus && PresenceStore.getStatus(recip)) === "offline"
            ? 1
            : 0;
        }
        return res.slice().sort(function (a, b) {
          return score(a) - score(b);
        });
      }),
    );
  }

  function patchActionSheet() {
    if (!after || !e) return;
    var Lazy = first([
      function () {
        return findByProps && findByProps("hideActionSheet", "openLazy");
      },
      function () {
        return findByName && findByName("ActionSheet");
      },
    ]);
    if (!Lazy || !Lazy.openLazy) return;
    unpatches.push(
      after("openLazy", Lazy, function (args) {
        try {
          var opts = args && args[0];
          var sheet = opts && (opts.sheet || opts);
          if (!sheet || typeof sheet.then !== "function") return;
        } catch (_) {}
      }),
    );
  }

  var TOGGLES = [
    ["friendsGrouping", "Group Friends by status", "Online, Idle, DND, Offline as sections"],
    ["splitIdle", "Keep Idle separate", "Otherwise Idle sits with Online"],
    ["splitDnd", "Keep Do Not Disturb separate", "Otherwise DND sits with Online"],
    ["collapseOffline", "Hide Offline on All", "Drops Offline from the sorted list"],
    ["hideOffline", "Hide Offline friends", "Never show Offline in Friends"],
    ["dmStrip", "Online-now strip on Chat", "Avatars of people who are around"],
    ["dmOnlineFirst", "Sort DMs online-first", "Recency stays default if this is off"],
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
              rebuild();
            },
          }),
        );
      }),
      e(
        Text,
        { style: [styles && styles.settingHint, { paddingHorizontal: 16, paddingTop: 12 }] },
        "OnlineNow never sends messages. Tap an Online-now avatar to open a DM through Discord. Pin is stored locally.",
      ),
    );
  }

  function onLoad() {
    try {
      rebuild();
      patchFriendOrder();
      patchFriendRows();
      patchPrivateChannels();
      patchDmOrder();
      patchActionSheet();
      var s = stores();
      var bump = function () {
        scheduleRebuild();
      };
      if (s.PresenceStore && s.PresenceStore.addChangeListener) {
        s.PresenceStore.addChangeListener(bump);
        unpatches.push(function () {
          s.PresenceStore.removeChangeListener && s.PresenceStore.removeChangeListener(bump);
        });
      }
      if (s.RelationshipStore && s.RelationshipStore.addChangeListener) {
        s.RelationshipStore.addChangeListener(bump);
        unpatches.push(function () {
          s.RelationshipStore.removeChangeListener && s.RelationshipStore.removeChangeListener(bump);
        });
      }
    } catch (err) {
      console.error("[OnlineNow] failed to load", err);
    }
  }

  function onUnload() {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    while (unpatches.length) {
      try {
        unpatches.pop()();
      } catch (_) {}
    }
  }

  return { onLoad: onLoad, onUnload: onUnload, settings: Settings, togglePin: togglePin };
});
