
/**
 * Sub-Store Mihomo / Clash / OpenClash
 * 国内直连、国外代理、广告拦截、地区节点分组
 *
 * 默认：
 * Apple -> DIRECT
 * 其他业务 -> 🚀 节点选择
 * 所有策略组手动选择，无自动测速
 */

const source = $content ?? $files?.[0] ?? "{}";

const config = typeof source === "string"
  ? (ProxyUtils.yaml.safeLoad(source) || {})
  : source;

if (!config || typeof config !== "object" || Array.isArray(config)) {
  throw new Error("无效的 Mihomo YAML 配置");
}

// 统一代理延迟计算，减少不同协议握手对面板测速的影响。
config["unified-delay"] = true;

// ==============================
// 1. TUN 修复
// ==============================

config.tun = config.tun || {};
config.tun.stack = "system";

if (config.tun.enable === undefined) {
  config.tun.enable = false;
}

// ==============================
// 2. 机场节点
// ==============================

config.proxies = Array.isArray(config.proxies)
  ? config.proxies
  : [];

const names = [...new Set(
  config.proxies
    .filter(p => p && typeof p.name === "string")
    .map(p => p.name)
)];

if (!names.length) {
  throw new Error("没有找到机场节点，请检查订阅来源");
}

const MAIN = "🚀 节点选择";
const MAIN_AUTO = "♻️ 全部节点自动测速";
const HK = "🇭🇰 香港节点";
const JP = "🇯🇵 日本节点";
const US = "🇺🇸 美国节点";
const SG = "🇸🇬 新加坡节点";
const HK_AUTO = "♻️ 香港自动测速";
const JP_AUTO = "♻️ 日本自动测速";
const US_AUTO = "♻️ 美国自动测速";
const SG_AUTO = "♻️ 新加坡自动测速";

const testURL = "https://www.gstatic.com/generate_204";

// 可配置匹配条件：只识别现有本地节点名称，不写入节点连接信息。
// 修改这里的关键字即可切换落地节点或办公节点；中转节点无需指定关键字。
const LOCAL_NODES = {
  companyKeyword: "公司Socks",
  homeKeyword: "家里Socks"
};
const TRANSIT = "中转节点";
const HOME_GROUP = "家宽代理";
const ATrust = "atrust";

// _subName 是 Sub-Store 内部来源标识，并非 Mihomo 支持的节点属性。
// 只取来源标签用于运行时动态分组；正式输出之前清理内部元数据。
// 与上游 operator(proxy._subName) 使用同一来源标识。
// Sub-Store 节点脚本会将其变为 "[来源] 节点名"；文件转换时字段可能已被剥离。
// 因此优先 _subName / _subDisplayName，其次解析节点名称最前方的 [来源]。
const subGroups = new Map();
for (const proxy of config.proxies) {
  if (!proxy || typeof proxy.name !== "string") continue;
  const originalSubName = proxy._subName || proxy._subDisplayName;
  const taggedSource = /^\[([^\]\r\n]+)\]/.exec(proxy.name.trim());
  const sourceName = String(originalSubName || (taggedSource && taggedSource[1]) || "").trim();
  if (!sourceName) continue;
  if (!subGroups.has(sourceName)) subGroups.set(sourceName, []);
  subGroups.get(sourceName).push(proxy.name);
}
const sourceGroups = [];
const usedGroupNames = new Set([MAIN, MAIN_AUTO, HK, JP, US, SG, HK_AUTO, JP_AUTO, US_AUTO, SG_AUTO, TRANSIT, HOME_GROUP, ATrust,
  "🤖 AI 服务", "📺 流媒体", "🔎 Google 服务", "💻 开发服务", "💬 社交通信", "💰 金融服务", "🍎 Apple 服务", "🐟 漏网之鱼"]);
for (const [sourceName, proxyNames] of subGroups) {
  // 用 Sub-Store 本来的订阅名作为组名，例如 amy，不在代码中固定具体订阅名。
  let groupName = sourceName;
  for (let n = 2; usedGroupNames.has(groupName) || names.includes(groupName); n++) {
    groupName = sourceName + "-" + n;
  }
  usedGroupNames.add(groupName);
  sourceGroups.push({ name: groupName, type: "select", proxies: [...new Set(proxyNames)] });
}

// 寻找原始落地节点，只在内存里复制节点对象，不向仓库写入连接参数。
// 中转选择全部普通节点；家宽代理只包括来源名包含「家宽」的链式副本。
const transitNames = [...names];
const homeSourceNames = new Set(
  [...subGroups].filter(([subName]) => subName.includes("家宽")).flatMap(([, proxyNames]) => proxyNames)
);
const chainedNames = [];
const usedNodeNames = new Set(names);
for (const proxy of [...config.proxies]) {
  if (!proxy || typeof proxy.name !== "string" || !homeSourceNames.has(proxy.name)) continue;
  const base = "链式-" + proxy.name;
  let chainedName = base;
  for (let n = 2; usedNodeNames.has(chainedName) || usedGroupNames.has(chainedName); n++) {
    chainedName = base + "-" + n;
  }
  usedNodeNames.add(chainedName);
  config.proxies.push({ ...proxy, name: chainedName, "dialer-proxy": TRANSIT });
  chainedNames.push(chainedName);
}
if (!chainedNames.length) {
  throw new Error("未找到订阅来源名称包含「家宽」的节点；请检查 _subName 或 [订阅名] 前缀");
}
// 禁止把 Sub-Store 的内部元数据写入最终 Mihomo YAML。
for (const p of config.proxies) {
  if (!p || typeof p !== "object") continue;
  for (const k of Object.keys(p)) {
    if (k.startsWith("_")) delete p[k];
  }
}


// 按节点地区标签动态生成国家/地区组；支持国旗、常见中文/英文名称及国家代码。
// 没有地区标签的节点继续留在来源分组，不会被错误划到某个国家。
const regionCatalog = [
  ["HK", "🇭🇰", "香港", /香港|hong[\s-]?kong|(?:^|[\s_-])HK(?=$|[\s_-]|\d)/i],
  ["JP", "🇯🇵", "日本", /日本|东京|大阪|japan|tokyo|osaka|(?:^|[\s_-])JP(?=$|[\s_-]|\d)/i],
  ["US", "🇺🇸", "美国", /美国|美西|美东|洛杉矶|硅谷|纽约|united[\s-]?states|los[\s-]?angeles|(?:^|[\s_-])US(?=$|[\s_-]|\d)/i],
  ["SG", "🇸🇬", "新加坡", /新加坡|狮城|singapore|(?:^|[\s_-])SG(?=$|[\s_-]|\d)/i],
  ["TW", "🇹🇼", "台湾", /台湾|臺灣|taiwan|taipei|台北|(?:^|[\s_-])TW(?=$|[\s_-]|\d)/i],
  ["KR", "🇰🇷", "韩国", /韩国|韓國|首尔|首爾|korea|seoul|(?:^|[\s_-])KR(?=$|[\s_-]|\d)/i],
  ["GB", "🇬🇧", "英国", /英国|英國|伦敦|倫敦|britain|united[\s-]?kingdom|london|(?:^|[\s_-])(?:GB|UK)(?=$|[\s_-]|\d)/i],
  ["DE", "🇩🇪", "德国", /德国|德國|法兰克福|法蘭克福|germany|frankfurt|(?:^|[\s_-])DE(?=$|[\s_-]|\d)/i],
  ["FR", "🇫🇷", "法国", /法国|法國|巴黎|france|paris|(?:^|[\s_-])FR(?=$|[\s_-]|\d)/i],
  ["CA", "🇨🇦", "加拿大", /加拿大|canada|toronto|vancouver|(?:^|[\s_-])CA(?=$|[\s_-]|\d)/i],
  ["AU", "🇦🇺", "澳大利亚", /澳大利亚|澳洲|australia|sydney|melbourne|(?:^|[\s_-])AU(?=$|[\s_-]|\d)/i],
  ["NL", "🇳🇱", "荷兰", /荷兰|荷蘭|netherlands|amsterdam|(?:^|[\s_-])NL(?=$|[\s_-]|\d)/i],
  ["RU", "🇷🇺", "俄罗斯", /俄罗斯|俄羅斯|russia|moscow|(?:^|[\s_-])RU(?=$|[\s_-]|\d)/i],
  ["IN", "🇮🇳", "印度", /印度|india|mumbai|(?:^|[\s_-])IN(?=$|[\s_-]|\d)/i],
  ["TR", "🇹🇷", "土耳其", /土耳其|turkey|türkiye|istanbul|(?:^|[\s_-])TR(?=$|[\s_-]|\d)/i],
  ["VN", "🇻🇳", "越南", /越南|vietnam|hanoi|(?:^|[\s_-])VN(?=$|[\s_-]|\d)/i],
  ["TH", "🇹🇭", "泰国", /泰国|泰國|thailand|bangkok|(?:^|[\s_-])TH(?=$|[\s_-]|\d)/i],
  ["MY", "🇲🇾", "马来西亚", /马来西亚|馬來西亞|malaysia|kuala[\s-]?lumpur|(?:^|[\s_-])MY(?=$|[\s_-]|\d)/i],
  ["ID", "🇮🇩", "印尼", /印尼|印度尼西亚|indonesia|jakarta|(?:^|[\s_-])ID(?=$|[\s_-]|\d)/i],
  ["PH", "🇵🇭", "菲律宾", /菲律宾|菲律賓|philippines|manila|(?:^|[\s_-])PH(?=$|[\s_-]|\d)/i],
  ["CH", "🇨🇭", "瑞士", /瑞士|switzerland|zurich|(?:^|[\s_-])CH(?=$|[\s_-]|\d)/i],
  ["SE", "🇸🇪", "瑞典", /瑞典|sweden|stockholm|(?:^|[\s_-])SE(?=$|[\s_-]|\d)/i],
  ["IT", "🇮🇹", "意大利", /意大利|義大利|italy|milan|(?:^|[\s_-])IT(?=$|[\s_-]|\d)/i],
  ["ES", "🇪🇸", "西班牙", /西班牙|spain|madrid|(?:^|[\s_-])ES(?=$|[\s_-]|\d)/i],
  ["BR", "🇧🇷", "巴西", /巴西|brazil|sao[\s-]?paulo|(?:^|[\s_-])BR(?=$|[\s_-]|\d)/i],
  ["AE", "🇦🇪", "阿联酋", /阿联酋|阿聯酋|united[\s-]?arab[\s-]?emirates|dubai|(?:^|[\s_-])AE(?=$|[\s_-]|\d)/i]
];
const fixedRegionGroups = { HK, JP, US, SG };
const regionMap = new Map();
for (const nodeName of names) {
  // 去掉 Sub-Store 的 [来源] 前缀，防止机场名称干扰国家识别。
  const label = nodeName.replace(/^\[[^\]\r\n]+\]\s*/, "");
  const flag = /[\u{1F1E6}-\u{1F1FF}]{2}/u.exec(label);
  const codeFromFlag = flag ? String.fromCharCode(
    ...Array.from(flag[0]).map(ch => ch.codePointAt(0) - 0x1F1E6 + 65)
  ) : "";
  // 优先匹配明确的地区文字，避免「🇨🇳 台湾 01」错误归入 CN。
  // 只把国旗作为缺乏明确地名时的兜底识别。
  const labelWithoutFlags = label.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, " ");
  const byText = regionCatalog.find(([, , , regex]) => regex.test(labelWithoutFlags));
  const def = byText || regionCatalog.find(([code]) => code === codeFromFlag);
  // 未列出的国旗仍可动态生成，例如 🇳🇴 → 🇳🇴 NO节点。
  if (!def && !codeFromFlag) continue;
  const code = def ? def[0] : codeFromFlag;
  if (!/^[A-Z]{2}$/.test(code)) continue;
  const emoji = def ? def[1] : flag[0];
  const display = def ? def[2] : code;
  if (!regionMap.has(code)) regionMap.set(code, { code, emoji, display, nodes: [] });
  regionMap.get(code).nodes.push(nodeName);
}

function regionGroup(name, nodes, autoName) {
  return { name, type: "select", proxies: nodes.length ? [...nodes, autoName] : ["DIRECT"] };
}
function regionAutoGroup(name, nodes) {
  return nodes.length ? [{
    name, type: "url-test", proxies: nodes,
    url: testURL, interval: 300, tolerance: 50
  }] : [];
}
const regionGroups = [];
const regionTestGroups = [];
const dynamicRegionNames = [];
for (const region of regionMap.values()) {
  const groupName = fixedRegionGroups[region.code] ||
    region.emoji + " " + region.display + "节点";
  const autoName = "♻️ " + region.display + "自动测速";
  if (!fixedRegionGroups[region.code]) {
    // 动态地区与真实节点/订阅名冲突时避免覆盖。
    if (usedGroupNames.has(groupName) || names.includes(groupName)) continue;
    usedGroupNames.add(groupName);
    dynamicRegionNames.push(groupName);
  }
  regionGroups.push(regionGroup(groupName, region.nodes, autoName));
  regionTestGroups.push(...regionAutoGroup(autoName, region.nodes));
}
// 保留传统四个组名，让已有业务策略的引用始终有效。
for (const [code, groupName] of Object.entries(fixedRegionGroups)) {
  if (!regionMap.has(code)) {
    regionGroups.push({ name: groupName, type: "select", proxies: ["DIRECT"] });
  }
}

function serviceGroup(name, options = [], first = MAIN) {
  // 保留原有默认选项和地区组，再加入 Sub-Store 来源分组供手动选择。
  // 仅引用分组名称，不将原始节点直接展开到业务组。
  const subNameGroups = sourceGroups.map(g => g.name);
  return {
    name,
    type: "select",
    proxies: [...new Set([
      first,
      ...options,
      ...subNameGroups
    ])]
  };
}

config["proxy-groups"] = [
  {
    name: MAIN,
    type: "select",
    // 只展示组；自动测速是可手动选用的独立策略组。
    proxies: [
      MAIN_AUTO,
      HK, JP, US, SG,
      ...dynamicRegionNames,
      ...sourceGroups.map(g => g.name),
      HOME_GROUP
    ]
  },
  {
    name: MAIN_AUTO,
    type: "url-test",
    proxies: names,
    url: testURL,
    interval: 300,
    tolerance: 50
  },
  ...regionGroups,
  ...regionTestGroups,

  // 基于 Sub-Store 节点 _subName/_subDisplayName 自动创建订阅分组。
  ...sourceGroups,

  // 中转：只列国家和订阅来源策略组，不直接列出节点。
  // 不包含 MAIN/HOME_GROUP/业务组，防止家宽链式连接出现循环引用。
  {
    name: TRANSIT,
    type: "select",
    proxies: [
      HK, JP, US, SG,
      ...dynamicRegionNames,
      ...sourceGroups.map(g => g.name)
    ]
  },

  // 家宽代理：仅来源「家宽」的链式副本，全部经过「中转节点」。
  {
    name: HOME_GROUP,
    type: "select",
    proxies: chainedNames
  },

  {
    name: ATrust,
    type: "select",
    proxies: [
      ...[LOCAL_NODES.companyKeyword, LOCAL_NODES.homeKeyword]
        .map(keyword => names.find(name => name.includes(keyword)))
        .filter(Boolean),
      "DIRECT"
    ]
  },

  serviceGroup("🤖 AI 服务", [
    US, JP, SG, "DIRECT"
  ]),

  serviceGroup("📺 流媒体", [
    HK, JP, US, SG, "DIRECT"
  ]),

  serviceGroup("🔎 Google 服务", [
    HK, JP, US, "DIRECT"
  ]),

  serviceGroup("💻 开发服务", [
    HK, JP, US, "DIRECT"
  ]),

  // 社交平台单独选出口，避免 Telegram / WhatsApp 经常切换线路。
  serviceGroup("💬 社交通信", [
    HK, JP, US, SG, "DIRECT"
  ]),

  // 金融服务手动指定稳定出口，不接入 url-test 自动切换。
  serviceGroup("💰 金融服务", [
    MAIN, HK, JP, US, SG
  ], "DIRECT"),

  // Apple 默认 DIRECT
  serviceGroup("🍎 Apple 服务", [
    MAIN, HK, JP, US
  ], "DIRECT"),

  serviceGroup("🐟 漏网之鱼", [
    "DIRECT"
  ])
];

// ==============================
// ==============================
// 4. DNS：统一使用国内 DNS，查询不走代理
// 国内外域名均使用国内 DNS 直连解析；不使用 DoH/DoT。
// DNS listen 保持原配置，OpenClash 可按自身设置覆盖端口。
// ==============================
const dnsServers = ["223.5.5.5", "119.29.29.29"];
config.dns = {
  ...(config.dns || {}),
  enable: true,
  listen: config.dns?.listen || "0.0.0.0:1053",
  ipv6: false,
  "enhanced-mode": "redir-host",
  "use-hosts": true,
  "respect-rules": false,
  "default-nameserver": [...dnsServers],
  "proxy-server-nameserver": [...dnsServers],
  nameserver: [...dnsServers],
  // 不区分国内外 DNS 上游，避免国外 DoH 不可用导致解析失败。
  "nameserver-policy": {
    "geosite:cn": [...dnsServers],
    "geosite:geolocation-!cn": [...dnsServers]
  },
  "fake-ip-filter": [
    ...(Array.isArray(config.dns?.["fake-ip-filter"]) ? config.dns["fake-ip-filter"] : []),
    "*.lan", "*.local", "*.localhost", "localhost",
    "time.*.com", "time.*.gov", "time.*.edu.cn",
    "ntp.*.com", "+.pool.ntp.org",
    "stun.*.*", "stun.*.*.*",
    "+.msftconnecttest.com", "+.msftncsi.com"
  ]
};

// ==============================
// 5. 广告拦截
// ==============================

config["rule-providers"] =
  config["rule-providers"] || {};

config["rule-providers"].Advertising = {
  type: "http",
  behavior: "classical",
  format: "yaml",
  url: "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Advertising/Advertising.yaml",
  path: "./ruleset/Advertising.yaml",
  interval: 86400
};

// ==============================
// 6. GEO 数据
// ==============================

config["geodata-mode"] = true;

config["geox-url"] = {
  ...(config["geox-url"] || {}),
  geoip:
    "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat",
  geosite:
    "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
};

// ==============================
// 7. 分流规则
// ==============================

config.rules = [
  // 本地自定义分流：在通用分流和 GEO 规则之前
  "DOMAIN-SUFFIX,lulu,DIRECT",
  "DOMAIN-SUFFIX,onitsukatiger.com,家宽代理",
  "DOMAIN-SUFFIX,onitsukatiger.jp,家宽代理",
  "DOMAIN-KEYWORD,mercari,家宽代理",
  "DOMAIN-SUFFIX,mercari.com,家宽代理",
  "DOMAIN-SUFFIX,mercari.jp,家宽代理",
  "DOMAIN-SUFFIX,merpay.com,家宽代理",
  "DOMAIN-SUFFIX,mercdn.net,家宽代理",

  // 局域网
  "DOMAIN-SUFFIX,localhost,DIRECT",
  "DOMAIN-SUFFIX,local,DIRECT",
  "DOMAIN-SUFFIX,lan,DIRECT",
  "DOMAIN-SUFFIX,ts.net,DIRECT",
  "DOMAIN-SUFFIX,tailscale.com,DIRECT",
  "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
  "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
  "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
  "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
  "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
  "IP-CIDR6,fc00::/7,DIRECT,no-resolve",
  "IP-CIDR6,fe80::/10,DIRECT,no-resolve",

  // Cloudflare 全家桶与 R2 默认直连（需在通用分流规则之前）
  "DOMAIN-SUFFIX,cloudflare.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflare.net,DIRECT",
  "DOMAIN-SUFFIX,cloudflare-dns.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflarestorage.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflareinsights.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflareaccess.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflareclient.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflarestream.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflarepages.com,DIRECT",
  "DOMAIN-SUFFIX,cloudflareworkers.com,DIRECT",
  "DOMAIN-SUFFIX,workers.dev,DIRECT",
  "DOMAIN-SUFFIX,pages.dev,DIRECT",

  // 常用办公协作软件优先直连（在 AI / Google 规则之前）
  // Microsoft Teams / Microsoft 365 / Outlook / OneDrive / SharePoint
  "DOMAIN-SUFFIX,teams.microsoft.com,DIRECT",
  "DOMAIN-SUFFIX,teams.cloud.microsoft,DIRECT",
  "DOMAIN-SUFFIX,teams.live.com,DIRECT",
  "DOMAIN-SUFFIX,skype.com,DIRECT",
  "DOMAIN-SUFFIX,lync.com,DIRECT",
  "DOMAIN-SUFFIX,office.com,DIRECT",
  "DOMAIN-SUFFIX,office365.com,DIRECT",
  "DOMAIN-SUFFIX,microsoft365.com,DIRECT",
  "DOMAIN-SUFFIX,office.net,DIRECT",
  "DOMAIN-SUFFIX,officeapps.live.com,DIRECT",
  "DOMAIN-SUFFIX,outlook.com,DIRECT",
  "DOMAIN-SUFFIX,outlook.office.com,DIRECT",
  "DOMAIN-SUFFIX,onedrive.com,DIRECT",
  "DOMAIN-SUFFIX,sharepoint.com,DIRECT",
  "DOMAIN-SUFFIX,sharepointonline.com,DIRECT",
  "DOMAIN-SUFFIX,microsoftonline.com,DIRECT",
  "DOMAIN-SUFFIX,msftauth.net,DIRECT",
  "DOMAIN-SUFFIX,msauth.net,DIRECT",
  "DOMAIN-SUFFIX,msftidentity.com,DIRECT",

  // Zoom / Webex
  "DOMAIN-SUFFIX,zoom.us,DIRECT",
  "DOMAIN-SUFFIX,zoom.com,DIRECT",
  "DOMAIN-SUFFIX,zoomcdn.net,DIRECT",
  "DOMAIN-SUFFIX,webex.com,DIRECT",
  "DOMAIN-SUFFIX,webexcontent.com,DIRECT",

  // 飞书 / Lark / 钉钉 / 腾讯会议
  "DOMAIN-SUFFIX,feishu.cn,DIRECT",
  "DOMAIN-SUFFIX,feishu.net,DIRECT",
  "DOMAIN-SUFFIX,larksuite.com,DIRECT",
  "DOMAIN-SUFFIX,larkoffice.com,DIRECT",
  "DOMAIN-SUFFIX,dingtalk.com,DIRECT",
  "DOMAIN-SUFFIX,dingtalk.cn,DIRECT",
  "DOMAIN-SUFFIX,meeting.tencent.com,DIRECT",
  "DOMAIN-SUFFIX,wemeet.qq.com,DIRECT",

  // 海外社交通信（置于 GEO 和兜底规则之前）
  "DOMAIN-SUFFIX,telegram.org,💬 社交通信",
  "DOMAIN-SUFFIX,telegram.me,💬 社交通信",
  "DOMAIN-SUFFIX,t.me,💬 社交通信",
  "DOMAIN-SUFFIX,telegra.ph,💬 社交通信",
  "DOMAIN-SUFFIX,tdesktop.com,💬 社交通信",
  "DOMAIN-SUFFIX,whatsapp.com,💬 社交通信",
  "DOMAIN-SUFFIX,whatsapp.net,💬 社交通信",
  "DOMAIN-SUFFIX,facebook.com,💬 社交通信",
  "DOMAIN-SUFFIX,fbcdn.net,💬 社交通信",
  "DOMAIN-SUFFIX,instagram.com,💬 社交通信",
  "DOMAIN-SUFFIX,cdninstagram.com,💬 社交通信",
  "DOMAIN-SUFFIX,threads.net,💬 社交通信",
  "DOMAIN-SUFFIX,x.com,💬 社交通信",
  "DOMAIN-SUFFIX,twitter.com,💬 社交通信",
  "DOMAIN-SUFFIX,twimg.com,💬 社交通信",

  // 金融平台（先只覆盖明确的官方域名，不对银行/CDN进行宽泛匹配）
  "DOMAIN-SUFFIX,interactivebrokers.com,💰 金融服务",
  "DOMAIN-SUFFIX,ibkr.com,💰 金融服务",

  // AI
  "DOMAIN-SUFFIX,openai.com,🤖 AI 服务",
  "DOMAIN-SUFFIX,chatgpt.com,🤖 AI 服务",
  "DOMAIN-SUFFIX,oaistatic.com,🤖 AI 服务",
  "DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI 服务",
  "DOMAIN-SUFFIX,anthropic.com,🤖 AI 服务",
  "DOMAIN-SUFFIX,claude.ai,🤖 AI 服务",
  "DOMAIN-SUFFIX,gemini.google.com,🤖 AI 服务",
  "DOMAIN-SUFFIX,perplexity.ai,🤖 AI 服务",
  "DOMAIN-SUFFIX,copilot.microsoft.com,🤖 AI 服务",

  // 流媒体
  "DOMAIN-SUFFIX,youtube.com,📺 流媒体",
  "DOMAIN-SUFFIX,youtu.be,📺 流媒体",
  "DOMAIN-SUFFIX,googlevideo.com,📺 流媒体",
  "DOMAIN-SUFFIX,ytimg.com,📺 流媒体",
  "DOMAIN-SUFFIX,netflix.com,📺 流媒体",
  "DOMAIN-SUFFIX,nflxvideo.net,📺 流媒体",
  "DOMAIN-SUFFIX,nflximg.net,📺 流媒体",
  "DOMAIN-SUFFIX,disneyplus.com,📺 流媒体",
  "DOMAIN-SUFFIX,disney-plus.net,📺 流媒体",

  // Google
  "DOMAIN-SUFFIX,google.com,🔎 Google 服务",
  "DOMAIN-SUFFIX,googleapis.com,🔎 Google 服务",
  "DOMAIN-SUFFIX,gstatic.com,🔎 Google 服务",
  "DOMAIN-SUFFIX,gmail.com,🔎 Google 服务",
  "DOMAIN-SUFFIX,googleusercontent.com,🔎 Google 服务",

  // 开发服务
  "DOMAIN-SUFFIX,github.com,💻 开发服务",
  "DOMAIN-SUFFIX,githubusercontent.com,💻 开发服务",
  "DOMAIN-SUFFIX,githubassets.com,💻 开发服务",
  "DOMAIN-SUFFIX,github.io,💻 开发服务",
  "DOMAIN-SUFFIX,github.dev,💻 开发服务",
  "DOMAIN-SUFFIX,githubcopilot.com,💻 开发服务",
  "DOMAIN-SUFFIX,githubapp.com,💻 开发服务",
  "DOMAIN-SUFFIX,githubstatus.com,💻 开发服务",
  "DOMAIN-SUFFIX,github-cloud.s3.amazonaws.com,💻 开发服务",
  "DOMAIN-SUFFIX,github-production-release-asset-2e65be.s3.amazonaws.com,💻 开发服务",
  "DOMAIN-SUFFIX,objects.githubusercontent.com,💻 开发服务",
  "DOMAIN-SUFFIX,release-assets.githubusercontent.com,💻 开发服务",
  "DOMAIN-SUFFIX,docker.io,💻 开发服务",
  "DOMAIN-SUFFIX,docker.com,💻 开发服务",
  "DOMAIN-SUFFIX,ghcr.io,💻 开发服务",
  "DOMAIN-SUFFIX,registry.npmjs.org,💻 开发服务",
  "DOMAIN-SUFFIX,npmjs.org,💻 开发服务",
  "DOMAIN-SUFFIX,files.pythonhosted.org,💻 开发服务",
  "DOMAIN-SUFFIX,pypi.org,💻 开发服务",

  // Apple 默认直连
  "DOMAIN-SUFFIX,apple.com,🍎 Apple 服务",
  "DOMAIN-SUFFIX,icloud.com,🍎 Apple 服务",
  "DOMAIN-SUFFIX,apple-dns.net,🍎 Apple 服务",
  "DOMAIN-SUFFIX,apple-cloudkit.com,🍎 Apple 服务",

  // 广告
  "RULE-SET,Advertising,REJECT",

  // 中国大陆直连
  "GEOSITE,CN,DIRECT",
  "GEOIP,CN,DIRECT,no-resolve",

  // 其他流量代理
  "MATCH,🐟 漏网之鱼"
];

// ==============================
// 8. 默认选择设置
// ==============================

config.profile = {
  ...(config.profile || {}),
  "store-selected": true
};

// ==============================
// 9. 输出
// ==============================

config.tun.stack = "system";

$content = ProxyUtils.yaml.dump(config);

