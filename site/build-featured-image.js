/**
 * TGL Design System - Featured Image Generator for Thinking Posts
 * 
 * Generates brand editorial card illustrations:
 * - Default Mode (Card View):
 *   - Abstract mechanism mark on cream canvas (#F5F0E8 / #FBF8F3)
 *   - Colour-coded by pillar (coral, sage, teal, amber, ink per token roles)
 *   - NO title text (eliminates duplication with card H3)
 *   - Sized at 480x270 (1x) and 960x540 (2x) WebP, < 25KB each
 * 
 * - OG / Social Mode (--mode=og):
 *   - 1200x630 canvas
 *   - Typographic title in Fraunces display font + rainbow rule + watermark motif
 * 
 * Usage:
 *   node site/build-featured-image.js                    (generates 6 card placeholders 480w & 960w)
 *   node site/build-featured-image.js --mode=og          (generates 6 OG 1200x630 images)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const THEME_DIR = path.resolve(__dirname, '../tgl-theme');
const FONTS_DIR = path.join(THEME_DIR, 'assets/fonts');
const OUTPUT_DIR = path.join(THEME_DIR, 'assets/img/thinking');

// Read fonts as base64 for self-contained rendering
let frauncesB64 = '';
let dmSansB64 = '';
try {
  frauncesB64 = fs.readFileSync(path.join(FONTS_DIR, 'fraunces-latin-normal.woff2')).toString('base64');
  dmSansB64 = fs.readFileSync(path.join(FONTS_DIR, 'dm-sans-latin.woff2')).toString('base64');
} catch (e) {
  console.warn('Could not read font files for base64 embed, falling back to local paths.');
}

const PILLARS = {
  'AI & Automation': {
    name: 'AI & Automation',
    accent: '#C75B3B',
    softBg: '#FBECE8',
    border: '#E8846B',
    tagText: '#A94224'
  },
  'Lead Scoring': {
    name: 'Lead Scoring',
    accent: '#7BA668',
    softBg: '#EFF6EC',
    border: '#7BA668',
    tagText: '#2D5220'
  },
  'Attribution': {
    name: 'Attribution',
    accent: '#4A9B8E',
    softBg: '#EBF5F3',
    border: '#4A9B8E',
    tagText: '#23564E'
  },
  'Unit Economics': {
    name: 'Unit Economics',
    accent: '#E8B44C',
    softBg: '#FEF8EA',
    border: '#E8B44C',
    tagText: '#7A540A'
  },
  'Funnel Operations': {
    name: 'Funnel Operations',
    accent: '#6B625B',
    softBg: '#F5F0E8',
    border: '#DDD6CA',
    tagText: '#4A433D'
  },
  'Strategy': {
    name: 'Strategy',
    accent: '#C75B3B',
    softBg: '#FBECE8',
    border: '#C75B3B',
    tagText: '#A94224'
  }
};

/**
 * 6 Dedicated abstract mechanism diagrams (NO title text)
 */
function getPillarMarkSvg(pillarName, width = 480, height = 270) {
  const p = PILLARS[pillarName] || PILLARS['AI & Automation'];

  switch (pillarName) {
    case 'AI & Automation':
      // Speed-to-lead flow: Enquiry -> 60s WhatsApp -> Qualified
      return `
        <svg viewBox="0 0 480 270" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Background -->
          <rect width="480" height="270" fill="#F7F3EC"/>
          <circle cx="240" cy="135" r="110" fill="#FFFFFF" fill-opacity="0.6"/>
          
          <!-- Node 1: Enquiry -->
          <rect x="42" y="100" width="105" height="58" rx="10" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="94" y="126" font-family="'DM Sans', sans-serif" font-size="12" font-weight="700" fill="#2C2118" text-anchor="middle">Enquiry</text>
          <text x="94" y="144" font-family="'DM Sans', sans-serif" font-size="10" font-weight="500" fill="#6B625B" text-anchor="middle">Meta / Web</text>
          
          <!-- Connector 1 -->
          <path d="M 147 129 L 181 129" stroke="#DDD6CA" stroke-width="2"/>
          <polygon points="181,129 173,124 173,134" fill="#DDD6CA"/>
          
          <!-- Node 2: 60s WhatsApp (Coral Highlight) -->
          <rect x="187" y="88" width="118" height="82" rx="12" fill="#FFFFFF" stroke="${p.accent}" stroke-width="2"/>
          <rect x="201" y="100" width="90" height="20" rx="10" fill="${p.softBg}"/>
          <text x="246" y="114" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" fill="${p.accent}" text-anchor="middle">⚡ &lt; 60s REPLY</text>
          <text x="246" y="137" font-family="'DM Sans', sans-serif" font-size="12" font-weight="700" fill="#2C2118" text-anchor="middle">WhatsApp</text>
          <text x="246" y="154" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="${p.accent}" text-anchor="middle">AI Qualified ✓✓</text>
          
          <!-- Connector 2 -->
          <path d="M 305 129 L 339 129" stroke="#DDD6CA" stroke-width="2"/>
          <polygon points="339,129 331,124 331,134" fill="#DDD6CA"/>
          
          <!-- Node 3: Counsellor Desk -->
          <rect x="345" y="100" width="100" height="58" rx="10" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="395" y="126" font-family="'DM Sans', sans-serif" font-size="12" font-weight="700" fill="#2C2118" text-anchor="middle">Counsellor</text>
          <text x="395" y="144" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#7BA668" text-anchor="middle">Pre-Screened</text>

          <!-- Hairline Grid Motif -->
          <circle cx="240" cy="135" r="95" stroke="#DDD6CA" stroke-width="1" stroke-dasharray="3 3"/>
        </svg>
      `;

    case 'Lead Scoring':
      // Scoring radar / dial: concentric circles with HOT 94 badge
      return `
        <svg viewBox="0 0 480 270" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="480" height="270" fill="#F7F3EC"/>
          
          <!-- Radar Arcs -->
          <circle cx="240" cy="135" r="105" stroke="#E6DFD5" stroke-width="1.5"/>
          <circle cx="240" cy="135" r="75" stroke="#DDD6CA" stroke-width="1.5" stroke-dasharray="4 4"/>
          <circle cx="240" cy="135" r="45" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          
          <!-- Axis crosshair -->
          <line x1="120" y1="135" x2="360" y2="135" stroke="#E6DFD5" stroke-width="1"/>
          <line x1="240" y1="25" x2="240" y2="245" stroke="#E6DFD5" stroke-width="1"/>
          
          <!-- Center Hub -->
          <circle cx="240" cy="135" r="32" fill="#FFFFFF" stroke="${p.accent}" stroke-width="2"/>
          <text x="240" y="131" font-family="'DM Sans', sans-serif" font-size="9" font-weight="800" fill="${p.accent}" text-anchor="middle">TRUELEAD</text>
          <text x="240" y="146" font-family="'DM Sans', sans-serif" font-size="13" font-weight="800" fill="#2C2118" text-anchor="middle">94</text>

          <!-- Satellites / Intent Tiers -->
          <rect x="70" y="70" width="105" height="38" rx="8" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="122" y="86" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" fill="#6B625B" text-anchor="middle">NCLEX-RN</text>
          <text x="122" y="99" font-family="'DM Sans', sans-serif" font-size="9" font-weight="700" fill="${p.accent}" text-anchor="middle">High Intent</text>
          
          <rect x="305" y="160" width="105" height="38" rx="8" fill="#FFFFFF" stroke="${p.accent}" stroke-width="1.5"/>
          <text x="357" y="176" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" fill="#2C2118" text-anchor="middle">HOT LEAD</text>
          <text x="357" y="189" font-family="'DM Sans', sans-serif" font-size="9" font-weight="700" fill="${p.accent}" text-anchor="middle">Fast-Track Call</text>

          <rect x="310" y="55" width="95" height="34" rx="6" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1"/>
          <text x="357" y="76" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#8A827B" text-anchor="middle">Filter Casuals</text>
        </svg>
      `;

    case 'Attribution':
      // Closed loop: Enquiry -> TrueLead -> Counsellor -> Admission -> back to Meta
      return `
        <svg viewBox="0 0 480 270" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="480" height="270" fill="#F7F3EC"/>
          
          <!-- Top Flow -->
          <rect x="45" y="80" width="100" height="52" rx="10" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="95" y="103" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">Ad Spend</text>
          <text x="95" y="119" font-family="'DM Sans', sans-serif" font-size="10" font-weight="500" fill="#6B625B" text-anchor="middle">Meta &amp; Google</text>
          
          <path d="M 145 106 L 185 106" stroke="#DDD6CA" stroke-width="2"/>
          <polygon points="185,106 177,101 177,111" fill="#DDD6CA"/>
          
          <rect x="190" y="80" width="100" height="52" rx="10" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="240" y="103" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">Enquiries</text>
          <text x="240" y="119" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="${p.accent}" text-anchor="middle">Qualified</text>
          
          <path d="M 290 106 L 330 106" stroke="#DDD6CA" stroke-width="2"/>
          <polygon points="330,106 322,101 322,111" fill="#DDD6CA"/>

          <rect x="335" y="80" width="105" height="52" rx="10" fill="#FFFFFF" stroke="${p.accent}" stroke-width="2"/>
          <text x="387" y="103" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">Admission</text>
          <text x="387" y="119" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" fill="${p.accent}" text-anchor="middle">Enrolled ✓</text>

          <!-- Attribution Feedback Loop -->
          <path d="M 387 132 C 387 205, 95 205, 95 137" fill="none" stroke="${p.accent}" stroke-width="2.5" stroke-dasharray="5 4"/>
          <polygon points="95,133 89,144 101,144" fill="${p.accent}"/>

          <rect x="180" y="172" width="130" height="26" rx="13" fill="#FFFFFF" stroke="${p.accent}" stroke-width="1.5"/>
          <text x="245" y="189" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" fill="${p.accent}" text-anchor="middle">↺ Closed Feedback Loop</text>
        </svg>
      `;

    case 'Unit Economics':
      // CPL vs Cost Per Enrolment metric comparison card
      return `
        <svg viewBox="0 0 480 270" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="480" height="270" fill="#F7F3EC"/>

          <!-- Comparison Card Container -->
          <rect x="60" y="55" width="360" height="160" rx="14" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <line x1="240" y1="55" x2="240" y2="215" stroke="#E6DFD5" stroke-width="1.5"/>
          
          <!-- Left: Vanity CPL -->
          <text x="150" y="90" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#8A827B" text-anchor="middle">VANITY METRIC</text>
          <text x="150" y="125" font-family="'DM Sans', sans-serif" font-size="26" font-weight="800" fill="#6B625B" text-anchor="middle">₹140</text>
          <text x="150" y="148" font-family="'DM Sans', sans-serif" font-size="11" font-weight="600" fill="#8A827B" text-anchor="middle">Cost Per Lead (Raw)</text>
          <rect x="95" y="165" width="110" height="22" rx="4" fill="#F5F0E8"/>
          <text x="150" y="180" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#6B625B" text-anchor="middle">80% Unreachable</text>
          
          <!-- Right: True Cost Per Enrolment (Amber highlight) -->
          <rect x="250" y="65" width="160" height="140" rx="10" fill="${p.softBg}" stroke="${p.accent}" stroke-width="1.5"/>
          <text x="330" y="90" font-family="'DM Sans', sans-serif" font-size="11" font-weight="800" fill="${p.accent}" text-anchor="middle">CAMPUS MARGIN</text>
          <text x="330" y="128" font-family="'Fraunces', Georgia, serif" font-size="28" font-weight="700" fill="#2C2118" text-anchor="middle">₹1,850</text>
          <text x="330" y="150" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="${p.accent}" text-anchor="middle">Cost Per Admission</text>
          <text x="330" y="180" font-family="'DM Sans', sans-serif" font-size="10" font-weight="700" fill="#2D5220" text-anchor="middle">Attributed to Batch ✓</text>
        </svg>
      `;

    case 'Funnel Operations':
      // Multi-Branch routing hub
      return `
        <svg viewBox="0 0 480 270" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="480" height="270" fill="#F7F3EC"/>

          <!-- Central Router -->
          <circle cx="160" cy="135" r="54" fill="#FFFFFF" stroke="#2C2118" stroke-width="2"/>
          <text x="160" y="126" font-family="'DM Sans', sans-serif" font-size="10" font-weight="800" fill="#2C2118" text-anchor="middle">CENTRAL</text>
          <text x="160" y="142" font-family="'DM Sans', sans-serif" font-size="12" font-weight="800" fill="#C75B3B" text-anchor="middle">ROUTER</text>
          <text x="160" y="156" font-family="'DM Sans', sans-serif" font-size="9" font-weight="600" fill="#6B625B" text-anchor="middle">Under 60s</text>

          <!-- Branch 1: Ludhiana -->
          <rect x="290" y="65" width="135" height="46" rx="8" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="357" y="85" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">Branch 1 · Desk A</text>
          <text x="357" y="100" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#7BA668" text-anchor="middle">3 Counsellors Active</text>
          
          <!-- Branch 2: Amritsar -->
          <rect x="290" y="160" width="135" height="46" rx="8" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="357" y="180" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">Branch 2 · Desk B</text>
          <text x="357" y="195" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#7BA668" text-anchor="middle">3 Counsellors Active</text>

          <!-- Connecting Paths -->
          <path d="M 214 115 C 245 100, 260 88, 290 88" stroke="#DDD6CA" stroke-width="2"/>
          <polygon points="290,88 281,83 281,93" fill="#DDD6CA"/>

          <path d="M 214 155 C 245 170, 260 183, 290 183" stroke="#DDD6CA" stroke-width="2"/>
          <polygon points="290,183 281,178 281,188" fill="#DDD6CA"/>
        </svg>
      `;

    case 'Strategy':
    default:
      // Multi-Branch scale velocity
      return `
        <svg viewBox="0 0 480 270" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="480" height="270" fill="#F7F3EC"/>

          <!-- 3-Branch Growth Curve / Blueprint -->
          <rect x="50" y="145" width="100" height="65" rx="10" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="100" y="172" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">2 Branches</text>
          <text x="100" y="192" font-family="'DM Sans', sans-serif" font-size="10" font-weight="500" fill="#6B625B" text-anchor="middle">Foundation</text>

          <rect x="190" y="105" width="105" height="105" rx="10" fill="#FFFFFF" stroke="#DDD6CA" stroke-width="1.5"/>
          <text x="242" y="135" font-family="'DM Sans', sans-serif" font-size="11" font-weight="700" fill="#2C2118" text-anchor="middle">3 Branches</text>
          <text x="242" y="155" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#C75B3B" text-anchor="middle">Auto Qualified</text>
          <text x="242" y="175" font-family="'DM Sans', sans-serif" font-size="9" font-weight="500" fill="#6B625B" text-anchor="middle">TrueLead Live</text>

          <rect x="330" y="65" width="105" height="145" rx="10" fill="#FFFFFF" stroke="${p.accent}" stroke-width="2"/>
          <rect x="340" y="75" width="85" height="20" rx="10" fill="${p.softBg}"/>
          <text x="382" y="89" font-family="'DM Sans', sans-serif" font-size="9" font-weight="800" fill="${p.accent}" text-anchor="middle">5 CAMPUSES</text>
          <text x="382" y="118" font-family="'DM Sans', sans-serif" font-size="12" font-weight="800" fill="#2C2118" text-anchor="middle">Scale</text>
          <text x="382" y="138" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#7BA668" text-anchor="middle">Predictable</text>
          <text x="382" y="156" font-family="'DM Sans', sans-serif" font-size="10" font-weight="600" fill="#7BA668" text-anchor="middle">Admissions</text>

          <!-- Trajectory Arrow -->
          <path d="M 100 135 C 160 90, 260 70, 325 50" fill="none" stroke="${p.accent}" stroke-width="2.5" stroke-dasharray="4 3"/>
          <polygon points="328,50 318,48 322,58" fill="${p.accent}"/>
        </svg>
      `;
  }
}

/**
 * OG / Social layout (1200x630 with Fraunces Title & Rainbow Bar)
 */
function generateOgHtml(title, pillar) {
  const p = PILLARS[pillar] || PILLARS['AI & Automation'];
  const motifSvg = getPillarMarkSvg(pillar, 480, 270);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @font-face {
      font-family: 'Fraunces';
      src: url('data:font/woff2;base64,${frauncesB64}') format('woff2');
      font-weight: 700;
    }
    @font-face {
      font-family: 'DM Sans';
      src: url('data:font/woff2;base64,${dmSansB64}') format('woff2');
      font-weight: 500 700;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1200px;
      height: 630px;
      overflow: hidden;
      background: #F5F0E8;
      font-family: 'DM Sans', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      width: 1120px;
      height: 550px;
      background: #FFFFFF;
      border: 1px solid #DDD6CA;
      border-radius: 28px;
      padding: 56px 64px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(44, 33, 24, 0.04);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      z-index: 2;
    }
    .pillar-tag {
      padding: 6px 14px;
      border-radius: 100px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: ${p.softBg};
      color: ${p.accent};
      border: 1px solid ${p.border};
    }
    .brand-mark {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #8A827B;
    }
    .content {
      max-width: 680px;
      z-index: 2;
    }
    .title {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 46px;
      line-height: 1.15;
      font-weight: 700;
      color: #2C2118;
      margin-bottom: 24px;
    }
    .rainbow-bar {
      display: flex;
      gap: 4px;
      width: 100px;
      height: 4px;
    }
    .rainbow-bar span { flex: 1; height: 100%; border-radius: 2px; }
    .rainbow-bar span:nth-child(1) { background: #C75B3B; }
    .rainbow-bar span:nth-child(2) { background: #E8846B; }
    .rainbow-bar span:nth-child(3) { background: #E8B44C; }
    .rainbow-bar span:nth-child(4) { background: #7BA668; }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #F0EBE2;
      padding-top: 18px;
      z-index: 2;
      font-size: 13px;
      color: #8A827B;
    }
    .motif-slot {
      position: absolute;
      right: 40px;
      top: 50%;
      transform: translateY(-50%);
      width: 420px;
      height: 240px;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #DDD6CA;
      z-index: 1;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="pillar-tag">${pillar}</span>
      <span class="brand-mark">THE GROWTH LAB · THINKING</span>
    </div>
    <div class="content">
      <h1 class="title">${title}</h1>
      <div class="rainbow-bar">
        <span></span><span></span><span></span><span></span>
      </div>
    </div>
    <div class="footer">
      <div>Insights for Multi-Branch Coaching Institutes</div>
      <div style="font-weight:700; color:#C75B3B;">thegrowthlab.co.in/thinking</div>
    </div>
    <div class="motif-slot">
      ${motifSvg}
    </div>
  </div>
</body>
</html>`;
}

function renderSvgToWebp(svgString, width, height, outputPath, quality = 85) {
  const tmpHtml = `/tmp/tgl_${Date.now()}_${Math.random().toString(36).substring(7)}.html`;
  const tmpPng = outputPath.replace(/\.webp$/, '.png');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #F7F3EC;
    }
    svg {
      width: ${width}px;
      height: ${height}px;
      display: block;
    }
  </style>
</head>
<body>
  ${svgString}
</body>
</html>`;

  fs.writeFileSync(tmpHtml, html);

  // Use Chrome headless to rasterize cleanly
  const res = spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless',
    '--disable-gpu',
    `--window-size=${width},${height}`,
    `--screenshot=${tmpPng}`,
    tmpHtml
  ]);

  if (res.status !== 0) {
    throw new Error(`Chrome rasterization failed: status ${res.status}`);
  }

  // Convert PNG to WebP with Python Pillow
  const py = `
from PIL import Image
img = Image.open('${tmpPng}')
if img.size != (${width}, ${height}):
    img = img.resize((${width}, ${height}), Image.Resampling.LANCZOS)
img.save('${outputPath}', 'WEBP', quality=${quality}, method=6)
`;
  spawnSync('python3', ['-c', py]);

  // Clean temp files
  try { fs.unlinkSync(tmpHtml); } catch(e){}
  if (tmpPng !== outputPath) {
    try { fs.unlinkSync(tmpPng); } catch(e){}
  }

  const stat = fs.statSync(outputPath);
  console.log(`Generated: ${path.basename(outputPath)} (${width}x${height}, ${(stat.size / 1024).toFixed(1)} KB)`);
}

const POSTS = [
  {
    slug: 'post-1',
    title: 'Why 80% of Coaching Enquiries Go Cold Within 15 Minutes',
    pillar: 'AI & Automation',
    alt: 'Speed-to-lead flow diagram showing enquiry to sub-60s WhatsApp automated reply'
  },
  {
    slug: 'post-2',
    title: 'The Flaw in Counting Leads Instead of Scoring Intent',
    pillar: 'Lead Scoring',
    alt: 'TrueLead scoring radar diagram filtering high-intent candidates from casual leads'
  },
  {
    slug: 'post-3',
    title: 'Why Meta Optimises for Forms, Not Real Enrolments',
    pillar: 'Attribution',
    alt: 'Attribution feedback loop diagram from verified admission back to ad account'
  },
  {
    slug: 'post-4',
    title: 'Cost Per Enrolment: The Only Metric Your Institute Should Measure',
    pillar: 'Unit Economics',
    alt: 'Unit economics matrix comparing raw cost per lead against campus margin per admission'
  },
  {
    slug: 'post-5',
    title: 'How an 8-Person Counselling Team Handles 400 Enquiries Without Burning Out',
    pillar: 'Funnel Operations',
    alt: 'Centralized enquiry routing diagram directing qualified leads to branch counsellors'
  },
  {
    slug: 'post-6',
    title: 'The Multi-Branch Playbook: Scaling From 2 to 5 Campuses Across India',
    pillar: 'Strategy',
    alt: 'Multi-campus growth trajectory blueprint showing predictable scaling'
  }
];

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const isOg = process.argv.includes('--mode=og');

  if (isOg) {
    console.log('Rendering 6 OG / Social images (1200x630 with Fraunces titles)...');
    POSTS.forEach((post) => {
      const html = generateOgHtml(post.title, post.pillar);
      const tmpHtml = `/tmp/tgl_og_${post.slug}.html`;
      const tmpPng = path.join(OUTPUT_DIR, `${post.slug}-og.png`);
      const outWebp = path.join(OUTPUT_DIR, `${post.slug}-og.webp`);

      fs.writeFileSync(tmpHtml, html);
      spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--headless',
        '--disable-gpu',
        '--window-size=1200,630',
        `--screenshot=${tmpPng}`,
        tmpHtml
      ]);

      const py = `
from PIL import Image
img = Image.open('${tmpPng}')
img.save('${outWebp}', 'WEBP', quality=88)
`;
      spawnSync('python3', ['-c', py]);
      try { fs.unlinkSync(tmpHtml); fs.unlinkSync(tmpPng); } catch(e){}
      console.log(`Generated OG: ${post.slug}-og.webp`);
    });
  } else {
    console.log('Rendering 6 Card-Size Abstract Mechanism Images (NO title text, <= 480px, WebP < 25KB)...');
    POSTS.forEach((post) => {
      const svg = getPillarMarkSvg(post.pillar, 480, 270);
      
      // 1x card size (480x270)
      const out1x = path.join(OUTPUT_DIR, `${post.slug}.webp`);
      renderSvgToWebp(svg, 480, 270, out1x, 82);

      // 2x retina size (960x540)
      const out2x = path.join(OUTPUT_DIR, `${post.slug}@2x.webp`);
      renderSvgToWebp(svg, 960, 540, out2x, 82);
    });
    console.log('All 6 Card-Size Featured Images Generated Successfully!');
  }
}

if (require.main === module) {
  main();
}

module.exports = { getPillarMarkSvg, generateOgHtml, POSTS };
