
/**
 * Sub-Store Mihomo / Clash / OpenClash
 * 国内直连、国外代理、广告拦截、地区节点分组
 *
 * 默认：
 * Apple -> DIRECT
 * 其他业务 -> 🚀 节点选择
 * 主节点 -> ♻️ 自动选择
 */

const source = $content ?? $files?.[0] ?? "{}";

const config = typeof source === "string"
  ? (ProxyUtils.yaml.safeLoad(source) || {})
  : source;

if (!config || typeof config !== "object" || Array.isArray(config)) {
  throw new Error("无效的 Mihomo YAML 配置");
}

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
const AUTO = "♻️ 自动选择";
const HK = "🇭🇰 香港节点";
const JP = "🇯🇵 日本节点";
const US = "🇺🇸 美国节点";
const SG = "🇸🇬 新加坡节点";

const testURL = "https://www.gstatic.com/generate_204";

// 可配置匹配条件：只识别现有本地节点名称，不写入节点连接信息。
// 修改这里的关键字即可切换落地节点或办公节点；中转节点无需指定关键字。
const LOCAL_NODES = {
  landingKeyword: "KDDI家宽",
  companyKeyword: "公司Socks",
  homeKeyword: "家里Socks"
};
const TRANSIT = "中转节点";
const CHAIN = "中转机场";
const HOME_GROUP = "家宽代理";
const HOME_ALL = "家宽";
const ATrust = "atrust";

// _subName 是 Sub-Store 内部来源标识，并非 Mihomo 支持的节点属性。
// 只取来源标签用于运行时动态分组；正式输出之前清理内部元数据。
const subGroups = new Map();
for (const proxy of config.proxies) {
  if (!proxy || typeof proxy.name !== "string") continue;
  const sub = proxy._subDisplayName || proxy._subName;
  if (typeof sub !== "string" || !sub.trim()) continue;
  const label = sub.trim();
  if (!subGroups.has(label)) subGroups.set(label, []);
  subGroups.get(label).push(proxy.name);
}
const sourceGroups = [];
const usedGroupNames = new Set([MAIN, AUTO, HK, JP, US, SG, TRANSIT, CHAIN, HOME_GROUP, HOME_ALL, ATrust,
  "🤖 AI 服务", "📺 流媒体", "🔎 Google 服务", "💻 开发服务", "🍎 Apple 服务", "🐟 漏网之鱼"]);
for (const [sourceName, proxyNames] of subGroups) {
  const baseName = "📦 订阅-" + sourceName;
  let groupName = baseName;
  for (let n = 2; usedGroupNames.has(groupName) || names.includes(groupName); n++) {
    groupName = baseName + "-" + n;
  }
  usedGroupNames.add(groupName);
  sourceGroups.push({ name: groupName, type: "select", proxies: [...new Set(proxyNames)] });
}

// 寻找原始落地节点，只在内存里复制节点对象，不向仓库写入连接参数。
const landing = config.proxies.find(p => p && typeof p.name === "string" && p.name.includes(LOCAL_NODES.landingKeyword));
const transitNames = names.filter(name => !landing || name !== landing.name);
const chainAvailable = Boolean(landing && transitNames.length && !names.includes(CHAIN));
if (chainAvailable) {
  config.proxies.push({ ...landing, name: CHAIN, "dialer-proxy": TRANSIT });
}
// 禁止把 Sub-Store 的内部元数据写入最终 Mihomo YAML。
for (const p of config.proxies) {
  if (!p || typeof p !== "object") continue;
  for (const k of Object.keys(p)) {
    if (k.startsWith("_")) delete p[k];
  }
}


const regex = {
  hk: /香港|港(?!币)|hong[\s-]?kong|\bHK\b|🇭🇰/i,
  jp: /日本|东京|大阪|japan|tokyo|osaka|\bJP\b|🇯🇵/i,
  us: /美国|美西|美东|洛杉矶|硅谷|纽约|united[\s-]?states|los[\s-]?angeles|\bUS\b|🇺🇸/i,
  sg: /新加坡|狮城|singapore|\bSG\b|🇸🇬/i
};

const nodesFor = re =>
  names.filter(name => re.test(name));

// ==============================
// 3. 策略组生成
// ==============================

function regionGroup(name, nodes) {
  return {
    name,
    type: "select",
    proxies: nodes.length ? nodes : [AUTO]
  };
}

function serviceGroup(name, options = [], first = MAIN) {
  return {
    name,
    type: "select",
    proxies: [
      first,
      ...options.filter(x => x !== first)
    ]
  };
}

config["proxy-groups"] = [
  {
    name: MAIN,
    type: "select",
    proxies: [
      AUTO, HK, JP, US, SG,
      ...sourceGroups.map(g => g.name),
      HOME_GROUP, HOME_ALL,
      ...(chainAvailable ? [CHAIN] : []),
      ...names,
      "DIRECT"
    ]
  },

  {
    name: AUTO,
    type: "url-test",
    proxies: names,
    url: testURL,
    interval: 300,
    tolerance: 50
  },

  regionGroup(HK, nodesFor(regex.hk)),
  regionGroup(JP, nodesFor(regex.jp)),
  regionGroup(US, nodesFor(regex.us)),
  regionGroup(SG, nodesFor(regex.sg)),

  // 基于 Sub-Store 节点 _subName/_subDisplayName 自动创建订阅分组。
  ...sourceGroups,

  // 中转节点可手动选全部非落地原始节点；不包含链式节点和落地自身，以免环路。
  ...(transitNames.length ? [{
    name: TRANSIT,
    type: "select",
    proxies: transitNames
  }] : []),

  {
    name: HOME_GROUP,
    type: "select",
    proxies: [...names, ...(chainAvailable ? [CHAIN] : []), "DIRECT"]
  },

  // 家宽：列出所有原始节点和可用链式节点，手动选择。
  {
    name: HOME_ALL,
    type: "select",
    proxies: [...names, ...(chainAvailable ? [CHAIN] : []), "DIRECT"]
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

  // Apple 默认 DIRECT
  serviceGroup("🍎 Apple 服务", [
    MAIN, HK, JP, US
  ], "DIRECT"),

  serviceGroup("🐟 漏网之鱼", [
    AUTO, "DIRECT"
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
  "DOMAIN-SUFFIX,docker.io,💻 开发服务",
  "DOMAIN-SUFFIX,docker.com,💻 开发服务",
  "DOMAIN-SUFFIX,ghcr.io,💻 开发服务",
  "DOMAIN-SUFFIX,npmjs.org,💻 开发服务",

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

