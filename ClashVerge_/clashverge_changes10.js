/**
 * ClashVerge 随机最快节点脚本
 * 日期：2026-03-24
 *
 * 原理：
 *   1. 读取所有节点，过滤香港及流量信息节点
 *   2. 将节点平均分成 TARGET_GROUPS 组（默认20组）
 *   3. 每组建立一个 url-test 子组，自动竞速选出本组最快节点
 *   4. 用 load-balance random 在 20 个"组冠军"中随机选一个
 *
 * 效果：
 *   🎲 随机最快节点 → 每次连接从 20 个速度候选节点中随机选一个
 *                     兼顾速度（每个候选都是本组最快）+ IP 多样性（随机分配）
 *                     适合注册机等需要 IP 多样性的场景
 *
 * 与旧版对比：
 *   旧版 url-test          → 始终选延迟最低那个（几乎总是同一国家）
 *   旧版 load-balance 轮转 → 按列表顺序轮转（同国家节点连续出现）
 *   新版 随机最快          → 从20个分区冠军中随机，速度 + 地域均衡
 */

function uniqPrepend(arr, items) {
  if (!Array.isArray(arr)) arr = [];
  for (var i = items.length - 1; i >= 0; i--) {
    var item = items[i];
    var exists = false;
    for (var j = 0; j < arr.length; j++) {
      if (arr[j] === item) {
        exists = true;
        break;
      }
    }
    if (!exists) arr.unshift(item);
  }
  return arr;
}

function upsertGroup(groups, group) {
  for (var i = 0; i < groups.length; i++) {
    if (groups[i] && groups[i].name === group.name) {
      groups[i] = group;
      return groups;
    }
  }
  groups.unshift(group);
  return groups;
}

function main(config, profileName) {
  if (!config) return config;

  if (!Array.isArray(config["proxy-groups"])) {
    config["proxy-groups"] = [];
  }

  var groups = config["proxy-groups"];

  // ── 排除规则：香港 + 流量信息节点 ──
  var excludeRegex =
    "(?i)(" +
    "香港|hong[ -]?kong|\\bhk\\b|\\bhkg\\b|🇭🇰" +
    "|剩余流量|套餐到期|下次重置剩余|重置剩余|到期时间|流量重置" +
    "|traffic|expire|expiration|subscription|subscribe|reset|plan" +
    ")";

  // ── 组1: url-test — 10分钟定时切换 ──
  // interval=600 → 每600秒（10分钟）重新健康检测
  // tolerance=9999 → 极高容差，检测后大概率切换到不同节点
  // lazy=false → 即使没有流量也主动检测，确保按时切换
  var URL_TEST_NAME = "🔄 10分钟换IP";

  groups = upsertGroup(groups, {
    name: URL_TEST_NAME,
    type: "url-test",
    "include-all-proxies": true,
    "exclude-filter": excludeRegex,
    url: "https://www.gstatic.com/generate_204",
    interval: 600,
    tolerance: 9999,
    lazy: false,
    "expected-status": 204
  });

  // ── 组2: load-balance — 每连接轮换 ──
  // round-robin 策略：每个新TCP连接分配到下一个节点
  // 适合批量注册（每次注册请求自动用不同IP）
  var LB_NAME = "🔁 每连接换IP";

  groups = upsertGroup(groups, {
    name: LB_NAME,
    type: "load-balance",
    strategy: "round-robin",
    "include-all-proxies": true,
    "exclude-filter": excludeRegex,
    url: "https://www.gstatic.com/generate_204",
    interval: 600,
    lazy: true,
    "expected-status": 204
  });

  // ── 注入到 select 选择组 ──
  var injected = false;
  var entryNameRegex = /节点选择|代理|Proxy|PROXY|默认|GLOBAL|全局|选择/i;

  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    if (!g || g.type !== "select") continue;

    if (entryNameRegex.test(g.name || "")) {
      if (!Array.isArray(g.proxies)) g.proxies = [];
      g.proxies = uniqPrepend(g.proxies, [URL_TEST_NAME, LB_NAME]);
      injected = true;
    }
  }

  if (!injected) {
    for (var k = 0; k < groups.length; k++) {
      var g2 = groups[k];
      if (g2 && g2.type === "select") {
        if (!Array.isArray(g2.proxies)) g2.proxies = [];
        g2.proxies = uniqPrepend(g2.proxies, [URL_TEST_NAME, LB_NAME]);
        break;
      }
    }
  }

  config["proxy-groups"] = groups;
  return config;
}
