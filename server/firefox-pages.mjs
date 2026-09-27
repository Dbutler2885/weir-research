// The research browser's tools when it is Firefox. Firefox lets one automation
// session into a browser, so the relay holds it and every worker's tool server
// calls these through the relay. The tools are named as Chrome DevTools MCP names
// its own, so workers follow the same instructions in either browser, and each
// worker reaches only the tabs it opened.

const page = {pageId: {type: 'number', description: 'The ID of your page, from new_page.'}};
const element = {...page, uid: {type: 'string', description: 'The uid of an element, from the latest take_snapshot of the page.'}};
const tool = (name, description, properties = {}, required = Object.keys(properties)) => ({name, description, inputSchema: {type: 'object', properties, required}});

export const TOOLS = [
  tool('new_page', 'Opens a new tab of your own at a URL, and gives its page ID.', {url: {type: 'string'}, background: {type: 'boolean', description: 'Open it without bringing it to the front.'}}, ['url']),
  tool('list_pages', 'Lists the tabs you opened, with their page IDs.'),
  tool('close_page', 'Closes one of your tabs.', page),
  tool('navigate_page', 'Goes to a URL in one of your tabs, or back, forward, or reloads it.', {...page, type: {type: 'string', enum: ['url', 'back', 'forward', 'reload']}, url: {type: 'string'}}, ['pageId']),
  tool('take_snapshot', 'Reads a page as text, giving each link, button and form field a uid to act on.', page),
  tool('click', 'Clicks an element.', {...element, dblClick: {type: 'boolean'}}, ['pageId', 'uid']),
  tool('fill', 'Types a value into a text field, or chooses an option in a select.', {...element, value: {type: 'string'}}),
  tool('press_key', 'Presses a key or a combination in a page, such as Enter or Control+A.', {...page, key: {type: 'string'}}),
  tool('wait_for', 'Waits until a page shows some text.', {...page, text: {type: 'string'}, timeout: {type: 'number', description: 'Milliseconds, 10000 by default.'}}, ['pageId', 'text']),
  tool('take_screenshot', 'Takes a screenshot of a page.', {...page, fullPage: {type: 'boolean'}}, ['pageId']),
  tool('evaluate_script', 'Runs a JavaScript function in a page and returns its result as JSON.', {...page, function: {type: 'string', description: 'A function declaration, such as () => document.title.'}}),
];

// The most text a snapshot returns; a worker reads the rest with evaluate_script.
const SNAPSHOT_LIMIT = 60_000;

// Runs in the page: its visible text in reading order, a line to each block, with
// each element a worker can act on marked where it appears, and those elements in
// uid order.
function readPage(start) {
  const lines = [];
  const elements = [];
  let text = '';
  const flush = () => {
    const line = text.replace(/\s+/g, ' ').replace(/\] ([.,;:!?)])/g, ']$1').trim();
    if (line) lines.push(line);
    text = '';
  };
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const quote = (value) => JSON.stringify(clean(value));
  const roles = {A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button'};
  const inputs = {checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', file: 'file'};
  const acting = new Set(['link', 'button', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox', 'slider', 'switch', 'tab', 'menuitem', 'option', 'file']);
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(' ')[0];
    if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : null;
    if (el.tagName === 'INPUT') return el.type === 'hidden' ? null : inputs[el.type] || 'textbox';
    if (el.isContentEditable && !el.parentElement?.isContentEditable) return 'textbox';
    return roles[el.tagName] || null;
  };
  const nameOf = (el) =>
    el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.innerText || '').join(' ').trim() ||
    [...(el.labels || [])].map((l) => l.innerText).join(' ') ||
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? '' : el.innerText) ||
    el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder') ||
    el.querySelector?.('img[alt]')?.alt ||
    (el.type === 'submit' || el.type === 'button' ? el.value : '');
  const hidden = (el) => {
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true' || el.hidden;
  };
  const block = (el) => !/^inline/.test(getComputedStyle(el).display);
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg'].includes(node.tagName) || hidden(node)) return;
    const role = roleOf(node);
    const level = /^H([1-6])$/.exec(node.tagName)?.[1];
    // An element to act on sits in the text where it appears, so sentences stay whole.
    if (acting.has(role)) {
      const parts = [`uid=${start + elements.length} ${role} ${quote(nameOf(node))}`];
      if (role === 'link') parts.push(`url=${node.href}`);
      if (role === 'textbox' || role === 'searchbox' || role === 'slider') parts.push(`value=${quote(node.value ?? node.innerText)}`);
      if (role === 'combobox' && node.tagName === 'SELECT') parts.push(`value=${quote(node.selectedOptions[0]?.text)}`, `options=${JSON.stringify([...node.options].map((o) => clean(o.text)).slice(0, 50))}`);
      if (node.checked || node.getAttribute('aria-checked') === 'true') parts.push('checked');
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') parts.push('disabled');
      text += ` [${parts.join(' ')}] `;
      elements.push(node);
      return;
    }
    if (level) {
      flush();
      lines.push(`heading ${quote(node.innerText)} level=${level}`);
      return;
    }
    if (node.tagName === 'IMG') {
      if (node.alt) text += ` [image ${quote(node.alt)}] `;
      return;
    }
    if (node.tagName === 'IFRAME') {
      flush();
      lines.push(`frame ${quote(node.title || node.src)}`);
      return;
    }
    const isBlock = block(node);
    if (isBlock) flush();
    for (const child of node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes) walk(child);
    if (isBlock) flush();
  };
  if (document.body) walk(document.body);
  flush();
  return {text: lines.join('\n'), elements};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textResult = (text) => ({content: [{type: 'text', text}]});

// The tabs workers opened, each owned by the worker that opened it.
export class FirefoxPages {
  constructor(browser) {
    this.browser = browser;
    this.pages = new Map();
    // Each worker's most recently opened tab, marked in its listing.
    this.latest = new Map();
    this.next = 1;
  }
  // Runs a tool for a worker, known by its client ID.
  async call(client, name, args = {}) {
    if (!TOOLS.some((t) => t.name === name)) throw new Error(`There is no tool named ${name}.`);
    if (name === 'new_page') return this.open(client, args);
    if (name === 'list_pages') return textResult(this.listing(client));
    const entry = this.own(client, args.pageId);
    if (name === 'close_page') {
      this.pages.delete(args.pageId);
      await entry.page.close().catch(() => {});
      return textResult(this.listing(client));
    }
    return this[name](entry, args);
  }
  // Closes every tab a worker opened, once its tool server has gone.
  async release(client) {
    for (const [id, entry] of this.pages) {
      if (entry.client !== client) continue;
      this.pages.delete(id);
      await entry.page.close().catch(() => {});
    }
  }
  own(client, pageId) {
    const entry = this.pages.get(pageId);
    if (!entry || entry.client !== client) throw new Error(`Page ${pageId} is not one of your tabs. Open your own with new_page.`);
    if (entry.page.isClosed()) {
      this.pages.delete(pageId);
      throw new Error(`Page ${pageId} was closed. Open another with new_page.`);
    }
    return entry;
  }
  listing(client) {
    const own = [...this.pages].filter(([, e]) => e.client === client && !e.page.isClosed());
    if (!own.length) return 'You have no open tabs. Open one with new_page.';
    return own.map(([id, e]) => `${id}: ${e.page.url()}${id === this.latest.get(client) ? ' [selected]' : ''}`).join('\n');
  }
  async open(client, {url}) {
    // A worker's tab never takes the human's focus.
    const page = await this.browser.newPage({background: true});
    const id = this.next++;
    this.pages.set(id, {client, page, elements: []});
    this.latest.set(client, id);
    page.on('close', () => this.pages.delete(id));
    await this.go(page, () => page.goto(url, {waitUntil: 'load', timeout: 30_000}));
    return textResult(this.listing(client));
  }
  // Navigates, reporting a page that loaded slowly rather than failing on it.
  async go(page, navigate) {
    try {
      await navigate();
    } catch (error) {
      if (!/timeout/i.test(error.message)) throw error;
    }
  }
  async navigate_page({page}, {type = 'url', url}) {
    if (type === 'url') {
      if (!url) throw new Error('Give the URL to go to.');
      await this.go(page, () => page.goto(url, {waitUntil: 'load', timeout: 30_000}));
    } else if (type === 'back') await this.go(page, () => page.goBack({waitUntil: 'load', timeout: 30_000}));
    else if (type === 'forward') await this.go(page, () => page.goForward({waitUntil: 'load', timeout: 30_000}));
    else await this.go(page, () => page.reload({waitUntil: 'load', timeout: 30_000}));
    return textResult(`The page is now ${page.url()}.`);
  }
  async take_snapshot(entry) {
    const {page} = entry;
    for (const handle of entry.elements) handle.dispose().catch(() => {});
    entry.elements = [];
    const sections = [`Page ${JSON.stringify(await page.title())} at ${page.url()}`];
    for (const [n, frame] of page.frames().entries()) {
      let result;
      try {
        result = await frame.evaluateHandle(readPage, entry.elements.length + 1);
      } catch {
        continue;
      }
      const text = await result.evaluate((r) => r.text);
      const list = await result.evaluateHandle((r) => r.elements);
      const count = await list.evaluate((l) => l.length);
      for (let i = 0; i < count; i++) entry.elements.push(await list.evaluateHandle((l, at) => l[at], i));
      list.dispose().catch(() => {});
      result.dispose().catch(() => {});
      if (n === 0) sections.push(text);
      else if (text) sections.push(`In the frame at ${frame.url()}:\n${text}`);
    }
    let snapshot = sections.join('\n');
    if (snapshot.length > SNAPSHOT_LIMIT) snapshot = `${snapshot.slice(0, SNAPSHOT_LIMIT)}\n[The page continues; read the rest with evaluate_script.]`;
    return textResult(snapshot);
  }
  element(entry, uid) {
    const handle = entry.elements[Number(uid) - 1];
    if (!handle) throw new Error(`There is no element ${uid} in the latest snapshot. Take a new snapshot.`);
    return handle;
  }
  // After an action, lets a navigation it started finish loading.
  async settle(page) {
    await sleep(300);
    for (let n = 0; n < 40; n++) {
      try {
        if ((await page.evaluate(() => document.readyState)) === 'complete') return;
      } catch {
        /* Between documents. */
      }
      await sleep(250);
    }
  }
  async act(entry, uid, action) {
    try {
      await action(this.element(entry, uid));
    } catch (error) {
      if (/detached|stale|not.*(connected|attached)|no such (node|element)/i.test(error.message)) throw new Error(`Element ${uid} is no longer on the page. Take a new snapshot.`);
      throw error;
    }
    await this.settle(entry.page);
  }
  async click(entry, {uid, dblClick}) {
    await this.act(entry, uid, (handle) => handle.click({count: dblClick ? 2 : 1}));
    return textResult(`Clicked. The page is now ${entry.page.url()}.`);
  }
  async fill(entry, {uid, value}) {
    await this.act(entry, uid, async (handle) => {
      const kind = await handle.evaluate((el) => (el.tagName === 'SELECT' ? 'select' : 'text'));
      if (kind === 'select') {
        const chosen = await handle.evaluate((el, wanted) => {
          const option = [...el.options].find((o) => o.value === wanted || o.text.trim() === wanted);
          if (!option) return false;
          el.value = option.value;
          el.dispatchEvent(new Event('input', {bubbles: true}));
          el.dispatchEvent(new Event('change', {bubbles: true}));
          return true;
        }, value);
        if (!chosen) throw new Error(`The select has no option ${JSON.stringify(value)}.`);
        return;
      }
      await handle.evaluate((el) => {
        el.focus();
        if ('value' in el) el.value = '';
        else el.textContent = '';
      });
      await handle.type(value);
    });
    return textResult('Filled.');
  }
  async press_key({page}, {key}) {
    const keys = key.split('+');
    const last = keys.pop();
    for (const k of keys) await page.keyboard.down(k);
    await page.keyboard.press(last);
    for (const k of keys.reverse()) await page.keyboard.up(k);
    await this.settle(page);
    return textResult(`Pressed ${key}. The page is now ${page.url()}.`);
  }
  async wait_for({page}, {text, timeout = 10_000}) {
    await page.waitForFunction((wanted) => document.body?.innerText.includes(wanted), {timeout, polling: 250}, text);
    return textResult(`The page shows ${JSON.stringify(text)}.`);
  }
  async take_screenshot({page}, {fullPage = false}) {
    const data = await page.screenshot({encoding: 'base64', fullPage});
    return {content: [{type: 'image', data, mimeType: 'image/png'}]};
  }
  async evaluate_script({page}, args) {
    const result = await page.evaluate(`(${args.function})()`);
    return textResult(result === undefined ? 'undefined' : JSON.stringify(result, null, 2));
  }
}
