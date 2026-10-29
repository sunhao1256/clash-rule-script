
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
// 4. DNS 国内外分流（Mihomo）
// ==============================
config.dns = {
  ...(config.dns || {}),
  enable: true,
  listen: "0.0.0.0:1053",
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  "use-hosts": true,
  "respect-rules": true,
  "default-nameserver": ["223.5.5.5", "119.29.29.29"],
  "proxy-server-nameserver": [
    "https://dns.alidns.com/dns-query",
    "https://doh.pub/dns-query"
  ],
  nameserver: [
    "https://1.1.1.1/dns-query",
    "https://dns.google/dns-query",
    "https://dns.quad9.net/dns-query"
  ],
  "nameserver-policy": {
    "geosite:cn": [
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query"
    ],
    "geosite:geolocation-!cn": [
      "https://1.1.1.1/dns-query",
      "https://dns.google/dns-query"
    ]
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
  "store-selected": false
};

// ==============================
// 9. 输出
// ==============================

config.tun.stack = "system";

$content = ProxyUtils.yaml.dump(config);

