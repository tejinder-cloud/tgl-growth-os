const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = '/Users/tejindersingh/.gemini/antigravity-ide/brain/51f11428-022f-45b1-969c-10f6af9f6fe9';
const URL = 'http://localhost:8089/preview-coaching.html';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function capture() {
  console.log('Launching Chrome headless...');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless',
    '--remote-debugging-port=9222',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars'
  ]);

  await wait(1500);

  try {
    const targets = await fetchJson('http://127.0.0.1:9222/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('DOM.enable');

    console.log('Navigating to', URL);
    await client.send('Page.navigate', { url: URL });
    await wait(2500); // Wait for fonts and images

    // 1. Mobile full-page screenshot (390px width)
    console.log('Configuring mobile emulation (390px width)...');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await wait(1000);

    const docLayout = await client.send('Page.getLayoutMetrics');
    const fullHeight = Math.ceil(docLayout.cssContentSize.height);
    console.log(`Document full scroll height at 390px: ${fullHeight}px`);

    console.log('Capturing mobile full-page screenshot...');
    const mobileScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    });

    const mobilePath = path.join(ARTIFACT_DIR, 'mobile_coaching_full_390px.png');
    fs.writeFileSync(mobilePath, Buffer.from(mobileScreenshot.data, 'base64'));
    console.log(`Saved mobile full-page screenshot to ${mobilePath}`);

    // Also copy to mobile_coaching_390px.png to update existing artifact
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'mobile_coaching_390px.png'), Buffer.from(mobileScreenshot.data, 'base64'));

    // 2. Desktop screenshot (1280px width)
    console.log('Configuring desktop emulation (1280px width)...');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
      mobile: false
    });
    await wait(1000);

    console.log('Capturing desktop screenshot (1280px)...');
    const desktopScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png'
    });

    const desktopPath = path.join(ARTIFACT_DIR, 'desktop_coaching_1280px.png');
    fs.writeFileSync(desktopPath, Buffer.from(desktopScreenshot.data, 'base64'));
    console.log(`Saved desktop screenshot to ${desktopPath}`);

    // Also desktop full-page
    const desktopFullScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'desktop_coaching_full_1280px.png'), Buffer.from(desktopFullScreenshot.data, 'base64'));
    console.log('Saved desktop full-page screenshot');

    // 3. Desktop crop of Step 2 Audit Diagram
    console.log('Capturing desktop crop of audit diagram...');
    await client.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0);' });
    await wait(200);

    const auditClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-step-audit-diagram');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX - 20), y: Math.max(0, rect.top + window.scrollY - 20), width: rect.width + 40, height: rect.height + 40, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (auditClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: auditClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_audit_diagram.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_audit_diagram.png');
    }

    // 3b. Crop of Hero Desk Scene Stand-in
    console.log('Capturing desktop crop of hero desk scene...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#mechanism');
        if (el) el.scrollIntoView({ block: 'center' });
      })()`
    });
    await wait(1200); // Wait for scroll animation to complete

    const deskClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#mechanism');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX - 10), y: Math.max(0, rect.top + window.scrollY - 10), width: rect.width + 20, height: rect.height + 20, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (deskClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: deskClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_hero_desk_scene.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_hero_desk_scene.png');
    }

    // 3c. Crop of "What's Not Working?" Widget
    console.log('Capturing desktop crop of what\'s not working widget...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#diagnostic');
        if (el) el.scrollIntoView({ block: 'center' });
      })()`
    });
    await wait(600);

    const wnwClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#diagnostic');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX - 10), y: Math.max(0, rect.top + window.scrollY - 10), width: rect.width + 20, height: rect.height + 20, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (wnwClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: wnwClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_whats_not_working.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_whats_not_working.png');
    }

    // 3d. Crop of Running Today Collage
    console.log('Capturing desktop crop of running today collage...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-collage-wrap');
        if (el) el.scrollIntoView({ block: 'center' });
      })()`
    });
    await wait(600);

    const collageClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-collage-wrap');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX - 20), y: Math.max(0, rect.top + window.scrollY - 20), width: rect.width + 40, height: rect.height + 40, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (collageClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: collageClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_running_collage.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_running_collage.png');
    }

    // 3e. Crop of Founder Trust Block
    console.log('Capturing desktop crop of founder block...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-founder-card');
        if (el) el.scrollIntoView({ block: 'center' });
      })()`
    });
    await wait(800); // Wait for founder photo to load and decode

    const founderClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-founder-card');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX - 20), y: Math.max(0, rect.top + window.scrollY - 20), width: rect.width + 40, height: rect.height + 40, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (founderClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: founderClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_founder_block.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_founder_block.png');
    }

    // 4. Desktop crop of Thinking section (6 posts)
    console.log('Capturing desktop crop of thinking section...');
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-thinking-grid');
        if (el) el.scrollIntoView({ block: 'center' });
      })()`
    });
    await wait(1000); // Wait for lazy images to load upon scroll

    const thinkingClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-thinking-grid');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX - 10), y: Math.max(0, rect.top + window.scrollY - 10), width: rect.width + 20, height: rect.height + 20, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (thinkingClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: thinkingClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_thinking_6posts_desk.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_thinking_6posts_desk.png');
    }

    // 5. Mobile crop with scroll to verify sticky CTA
    console.log('Testing mobile sticky CTA...');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    // Scroll down 1500px to trigger sticky CTA
    await client.send('Runtime.evaluate', {
      expression: 'window.scrollTo(0, 1500);'
    });
    await wait(500);
    const stickyMobileShot = await client.send('Page.captureScreenshot', {
      format: 'png'
    });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'mobile_sticky_cta_active.png'), Buffer.from(stickyMobileShot.data, 'base64'));
    console.log('Saved mobile_sticky_cta_active.png');

    // 6. Mobile crop of Thinking snap-scroll row
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-thinking-grid');
        if (el) el.scrollIntoView({ block: 'center' });
      })()`
    });
    await wait(1000); // Wait for lazy images to decode upon mobile scroll

    const mobileThinkingClip = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('.tgl-thinking-grid');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: Math.max(0, rect.left + window.scrollX), y: Math.max(0, rect.top + window.scrollY), width: rect.width, height: rect.height, scale: 1 };
      })()`,
      returnByValue: true
    });
    if (mobileThinkingClip.result.value) {
      const crop = await client.send('Page.captureScreenshot', {
        format: 'png',
        clip: mobileThinkingClip.result.value,
        captureBeyondViewport: true
      });
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_thinking_snap_mobile.png'), Buffer.from(crop.data, 'base64'));
      console.log('Saved crop_thinking_snap_mobile.png');
    }

    client.close();
  } finally {
    chrome.kill();
  }
}

capture().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
