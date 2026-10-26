/* ==========================================================================
   Anvayra — workspace.js
   Multi-account WhatsApp workspace: accounts, threaded inbox, real Cloud API
   sending through Supabase Edge Functions, templates, automations, activity log.

   Security: no App Secret and no access token ever lives in this file.
   Real sends and token exchange call Edge Functions, which hold the
   WhatsApp credential server-side.
   ========================================================================== */

(async function () {
  'use strict';

  /* Supabase Auth guard: redirects to /login/ when there is no session. */
  const session = await window.AnvayraAuth.requireSession();
  if (!session) return;

  /* Session confirmed — reveal the workspace and drop the checking splash. */
  document.body.classList.add('auth-ready');
  const authSplash = document.getElementById('authSplash');
  if (authSplash) authSplash.remove();

  /* ---------------------------------------------------------------------- */
  /*  Config                                                                */
  /* ---------------------------------------------------------------------- */
  const CONFIG = {
    appId: '1111754955165517',
    configId: '1469679065081628',
    graphVersion: 'v21.0',
    callbackUrl: 'https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/wa-connect',
    sendUrl: 'https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/wa-send',
    healthUrl: 'https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/health',
    redirectUri: window.location.origin + '/'
  };

  const WS_BASE = 'anvayra.workspace.v1';
  const WS_KEY = WS_BASE + '.' + (session.userId || 'anon');

  /* One-time migration: pre-Supabase namespaces used random local user IDs,
     so a returning user's workspace lived under an unguessable key. Adopt
     the most recent legacy blob (newest localStorage key wins) so the same
     browser keeps its accounts, inbox and settings after the auth swap. */
  (function migrateLegacyNamespace() {
    try {
      if (localStorage.getItem(WS_KEY)) return;
      const legacy = Object.keys(localStorage)
        .filter(function (k) { return k.indexOf(WS_BASE + '.') === 0 && k !== WS_KEY; })
        .sort();
      if (!legacy.length) return;
      localStorage.setItem(WS_KEY, localStorage.getItem(legacy[legacy.length - 1]));
      legacy.forEach(function (k) { localStorage.removeItem(k); });
    } catch (error) {
      /* storage issues are non-fatal; a fresh workspace is created below */
    }
  })();

  /* ---------------------------------------------------------------------- */
  /*  State                                                                 */
  /* ---------------------------------------------------------------------- */
  let db = null;
  let activeThreadId = null;
  let searchTerm = '';
  let currentView = 'inbox';

  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------------- */
  /*  Utilities                                                             */
  /* ---------------------------------------------------------------------- */
  const uid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10);
  const digits = (value) => String(value || '').replace(/[^\d]/g, '');

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
  }

  function dayLabel(iso) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(date, today)) return 'Today';
    if (sameDay(date, yesterday)) return 'Yesterday';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function timeLabel(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function relativeLabel(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h';
    return Math.round(hours / 24) + 'd';
  }

  function fmtNumber(value) {
    const d = digits(value);
    if (!d) return '—';
    if (d.length === 12 && d.startsWith('91')) {
      return '+' + d.slice(0, 2) + ' ' + d.slice(2, 7) + ' ' + d.slice(7);
    }
    return '+' + d;
  }

  let toastTimer = null;
  function toast(message, bad) {
    const node = $('toast');
    node.textContent = message;
    node.classList.toggle('bad', Boolean(bad));
    node.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('show'), 3400);
  }

  /* ---------------------------------------------------------------------- */
  /*  Seed data                                                             */
  /* ---------------------------------------------------------------------- */
  function seed() {
    const isReviewer = session.userId === 'usr_demo';
    const accounts = [
      isReviewer
        ? {
            id: 'acc_real',
            name: 'Anvayra Support',
            number: '+91 91658 26867',
            phoneNumberId: '',
            wabaId: '',
            kind: 'real',
            connected: false
          }
        : {
            id: 'acc_real',
            name: (session.business || 'Your business').slice(0, 40),
            number: '',
            phoneNumberId: '',
            wabaId: '',
            kind: 'real',
            connected: false
          },
      {
        id: 'acc_lotus',
        name: 'Lotus Dental Clinic',
        number: '+91 90000 11121',
        phoneNumberId: '109938475610293',
        wabaId: '209384756102931',
        kind: 'demo',
        connected: true
      },
      {
        id: 'acc_sunrise',
        name: 'Sunrise Realty',
        number: '+91 90000 22232',
        phoneNumberId: '109938475610294',
        wabaId: '209384756102932',
        kind: 'demo',
        connected: true
      },
      {
        id: 'acc_mocha',
        name: 'Cafe Mocha House',
        number: '+91 90000 33343',
        phoneNumberId: '109938475610295',
        wabaId: '209384756102933',
        kind: 'demo',
        connected: true
      },
      {
        id: 'acc_fitloop',
        name: 'Fitloop Studio',
        number: '+91 90000 44454',
        phoneNumberId: '109938475610296',
        wabaId: '209384756102934',
        kind: 'demo',
        connected: true
      }
    ];

    const threads = {
      acc_real: isReviewer ? [
        {
          id: 'th_real_1',
          name: 'Aarav Mehta',
          number: '+91 98200 44531',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Hi, I saw your website. Do you build WhatsApp automations for a two-clinic dental business?', at: minutesAgo(74), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'Hi Aarav — yes. We connect each clinic number to the Cloud API and run appointment reminders plus a shared inbox. Want a 15-minute walkthrough?', at: minutesAgo(61), status: 'read' },
            { id: uid('m'), dir: 'in', text: 'Tomorrow after 6pm works.', at: minutesAgo(12), status: 'read' }
          ]
        },
        {
          id: 'th_real_2',
          name: 'Sana Khan',
          number: '+91 99100 78224',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'What does the starter plan include?', at: minutesAgo(200), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'One WhatsApp number, the shared inbox, 3 templates and two automations. I can send the full sheet.', at: minutesAgo(188), status: 'delivered' }
          ]
        }
      ] : [],
      acc_lotus: [
        {
          id: 'th_lotus_1',
          name: 'Priya Sharma',
          number: '+91 98765 11002',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Hi, is a root canal consultation available this Saturday?', at: minutesAgo(46), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'Hello Priya! Yes — Saturday 11:30 with Dr. Mehta is free. Shall I book it?', at: minutesAgo(44), status: 'read' },
            { id: uid('m'), dir: 'in', text: 'Perfect, please book it.', at: minutesAgo(9), status: 'read' }
          ]
        },
        {
          id: 'th_lotus_2',
          name: 'Rahul Verma',
          number: '+91 90123 55110',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Do you accept HDFC insurance for braces?', at: minutesAgo(130), status: 'read' },
            { id: uid('m'), dir: 'in', text: 'Also what is the consultation fee?', at: minutesAgo(126), status: 'read' }
          ]
        },
        {
          id: 'th_lotus_3',
          name: 'Farida Ansari',
          number: '+91 98220 33119',
          optIn: false,
          messages: [
            { id: uid('m'), dir: 'in', text: 'STOP', at: minutesAgo(320), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'You have been unsubscribed and will not receive further marketing messages. Reply START to opt back in.', at: minutesAgo(319), status: 'read' }
          ]
        }
      ],
      acc_sunrise: [
        {
          id: 'th_sunrise_1',
          name: 'Neha Agarwal',
          number: '+91 97110 88231',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Looking for a 2BHK near MP Nagar, budget around 45L. Anything available?', at: minutesAgo(88), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'Yes — two options in that range. I can send photos and the floor plans on WhatsApp.', at: minutesAgo(80), status: 'read' },
            { id: uid('m'), dir: 'in', text: 'Please send. Also is the price negotiable?', at: minutesAgo(22), status: 'read' }
          ]
        },
        {
          id: 'th_sunrise_2',
          name: 'Imran Qureshi',
          number: '+91 99260 41128',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Site visit tomorrow at 4pm confirmed.', at: minutesAgo(240), status: 'read' }
          ]
        }
      ],
      acc_mocha: [
        {
          id: 'th_mocha_1',
          name: 'Ananya Rao',
          number: '+91 98450 77312',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Do you have outdoor seating for 8 people tonight?', at: minutesAgo(34), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'We do — the terrace table seats 8. What time should I hold it for?', at: minutesAgo(31), status: 'read' },
            { id: uid('m'), dir: 'in', text: '8:30pm please.', at: minutesAgo(18), status: 'read' }
          ]
        },
        {
          id: 'th_mocha_2',
          name: 'Karan Malhotra',
          number: '+91 90040 22117',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Table for 2 at 8pm?', at: minutesAgo(150), status: 'read' }
          ]
        }
      ],
      acc_fitloop: [
        {
          id: 'th_fitloop_1',
          name: 'Meera Iyer',
          number: '+91 99870 12290',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Is the 6am batch still open?', at: minutesAgo(26), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'Two spots left in the 6am batch. Want me to reserve one for a trial class?', at: minutesAgo(24), status: 'read' },
            { id: uid('m'), dir: 'in', text: 'Yes please, tomorrow.', at: minutesAgo(6), status: 'read' }
          ]
        },
        {
          id: 'th_fitloop_2',
          name: 'Rohan Deshmukh',
          number: '+91 98111 60034',
          optIn: true,
          messages: [
            { id: uid('m'), dir: 'in', text: 'Payment done, sending the screenshot.', at: minutesAgo(300), status: 'read' },
            { id: uid('m'), dir: 'out', text: 'Received — your membership is active from today. See you at the 7pm class.', at: minutesAgo(295), status: 'read' }
          ]
        }
      ]
    };

    const templates = [
      { id: uid('tpl'), name: 'appointment_reminder', category: 'UTILITY', lang: 'en', status: 'approved', body: 'Hello {{1}}, this is a reminder of your appointment at {{2}}. Reply YES to confirm or RESCHEDULE to change it.' },
      { id: uid('tpl'), name: 'enquiry_followup', category: 'UTILITY', lang: 'en', status: 'approved', body: 'Hi {{1}}, thanks for your enquiry. Would you like us to call you today about {{2}}?' },
      { id: uid('tpl'), name: 'order_update', category: 'UTILITY', lang: 'en', status: 'pending', body: 'Hello {{1}}, your order {{2}} has been updated. Reply HELP for support.' },
      { id: uid('tpl'), name: 'payment_link', category: 'UTILITY', lang: 'en', status: 'approved', body: 'Hi {{1}}, here is your secure payment link for {{2}}: {{3}}' },
      { id: uid('tpl'), name: 'review_request', category: 'MARKETING', lang: 'en', status: 'approved', body: 'Thank you for visiting {{1}}, {{2}}. Would you leave us a quick review? {{3}}' }
    ];

    const automations = [
      { id: 'auto_reply', name: 'Instant first reply', desc: 'Answers a new contact within seconds, in Hindi or English, and hands over to a human when asked.', enabled: true },
      { id: 'lead_capture', name: 'Lead capture to sheet', desc: 'Every enquiry is written to Google Sheets with name, number, intent and consent timestamp.', enabled: true },
      { id: 'appointment_reminder', name: 'Appointment reminders', desc: 'Sends a 24-hour and a 2-hour reminder with confirm and reschedule buttons.', enabled: true },
      { id: 'stop_handler', name: 'STOP / opt-out handler', desc: 'Honours STOP instantly, stores a suppression record and blocks future marketing messages.', enabled: true },
      { id: 'human_handover', name: 'Human handover', desc: 'Notifies the team and pauses automation when the customer asks for a person.', enabled: false },
      { id: 'daily_digest', name: 'Daily owner digest', desc: 'Sends a 9pm summary of new leads, unanswered chats and template performance.', enabled: false }
    ];

    const state = {
      accounts,
      threads,
      templates,
      automations,
      activity: [],
      activeAccountId: 'acc_real',
      version: 1,
      createdAt: new Date().toISOString()
    };

    activeThreadId = threads.acc_real.length ? threads.acc_real[0].id : null;
    return state;
  }

  /* ---------------------------------------------------------------------- */
  /*  Persistence                                                           */
  /* ---------------------------------------------------------------------- */
  function save() {
    try {
      localStorage.setItem(WS_KEY, JSON.stringify(db));
    } catch (error) {
      toast('Could not save locally — storage may be full.', true);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(WS_KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.accounts) || !parsed.threads) return seed();
      parsed.templates = parsed.templates || [];
      parsed.automations = parsed.automations || [];
      parsed.activity = parsed.activity || [];
      return parsed;
    } catch (error) {
      return seed();
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Selectors                                                             */
  /* ---------------------------------------------------------------------- */
  function activeAccount() {
    return db.accounts.find((account) => account.id === db.activeAccountId) || db.accounts[0];
  }

  function accountThreads() {
    const account = activeAccount();
    return db.threads[account.id] || [];
  }

  function activeThread() {
    return accountThreads().find((thread) => thread.id === activeThreadId) || null;
  }

  function log(message, kind) {
    db.activity.unshift({ at: new Date().toISOString(), message, kind: kind || '' });
    db.activity = db.activity.slice(0, 120);
    save();
    renderLog();
  }

  /* ---------------------------------------------------------------------- */
  /*  Rendering — rail + header                                             */
  /* ---------------------------------------------------------------------- */
  function renderAccounts() {
    const list = $('accountList');
    list.innerHTML = '';

    db.accounts.forEach((account) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ws-account' + (account.id === db.activeAccountId ? ' active' : '') + (account.kind === 'real' ? ' is-real' : '');
      button.setAttribute('aria-pressed', String(account.id === db.activeAccountId));

      const av = document.createElement('span');
      av.className = 'av';
      av.textContent = initials(account.name);

      const meta = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = account.name;
      const sub = document.createElement('span');
      sub.className = 'sub';
      const last4 = digits(account.number).slice(-4);
      const kindLabel = account.kind === 'real' ? (account.connected ? 'LIVE' : 'SETUP') : 'DEMO';
      sub.textContent = kindLabel + (last4 ? ' · ' + last4 : '');
      meta.appendChild(name);
      meta.appendChild(sub);

      const dot = document.createElement('span');
      dot.className = 'dot' + (account.connected ? '' : ' off');

      button.appendChild(av);
      button.appendChild(meta);
      button.appendChild(dot);
      button.addEventListener('click', () => selectAccount(account.id));
      list.appendChild(button);
    });

    const unread = accountThreads().reduce((total, thread) => {
      return total + thread.messages.filter((message) => message.dir === 'in' && message.unread).length;
    }, 0);
    $('inboxCount').textContent = String(unread);
    $('inboxCount').style.display = unread ? '' : 'none';
  }

  function renderHeader() {
    const account = activeAccount();
    const live = account.kind === 'real';

    $('accName').textContent = account.name;
    $('accNumber').textContent = fmtNumber(account.number);
    $('accBadge').textContent = live ? (account.connected ? 'Live · Cloud API' : 'Setup · Cloud API') : 'Demo · sandbox';
    $('accBadge').className = 'ws-badge' + (live ? '' : ' demo');

    let status = 'Demo workspace';
    if (live) {
      status = account.phoneNumberId ? 'Connected · sending enabled' : 'Not connected — add Phone Number ID';
    }
    $('accStatusText').textContent = status;

    $('userName').textContent = session.name || 'Workspace owner';
    $('userEmail').textContent = session.email || '';
    $('userAv').textContent = initials(session.name || 'A');

    const hint = $('composerHint');
    if (live) {
      hint.textContent = account.phoneNumberId
        ? 'Sends through the WhatsApp Cloud API · recipient must have opted in'
        : 'Add a Phone Number ID in Settings to send live messages';
      hint.className = 'real';
    } else {
      hint.textContent = 'Demo account · replies are simulated locally, no real message is sent';
      hint.className = 'demo';
    }
  }

  function selectAccount(id) {
    db.activeAccountId = id;
    const threads = db.threads[id] || [];
    activeThreadId = threads.length ? threads[0].id : null;
    searchTerm = '';
    $('threadSearch').value = '';
    save();
    closeRail();
    renderAll();
  }

  /* ---------------------------------------------------------------------- */
  /*  Rendering — inbox                                                     */
  /* ---------------------------------------------------------------------- */
  function renderThreads() {
    const list = $('threadList');
    list.innerHTML = '';

    const threads = accountThreads().filter((thread) => {
      if (!searchTerm) return true;
      return (
        thread.name.toLowerCase().includes(searchTerm) ||
        thread.number.includes(searchTerm)
      );
    });

    if (!threads.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'padding:22px 16px;font-size:.78rem;color:var(--ink-30)';
      empty.textContent = searchTerm ? 'No conversation matches that search.' : 'No conversations yet on this account.';
      list.appendChild(empty);
      return;
    }

    threads.forEach((thread) => {
      const last = thread.messages[thread.messages.length - 1];
      const unread = thread.messages.filter((message) => message.dir === 'in' && message.unread).length;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thread' + (thread.id === activeThreadId ? ' active' : '');

      const av = document.createElement('span');
      av.className = 'av';
      av.textContent = initials(thread.name);

      const body = document.createElement('span');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = thread.name;
      const prev = document.createElement('span');
      prev.className = 'prev';
      prev.textContent = (last && last.dir === 'out' ? 'You: ' : '') + (last ? last.text : 'No messages');
      body.appendChild(who);
      body.appendChild(prev);
      if (unread) {
        const badge = document.createElement('span');
        badge.className = 'unread';
        badge.textContent = unread + ' new';
        body.appendChild(badge);
      }

      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = last ? relativeLabel(last.at) : '';

      button.appendChild(av);
      button.appendChild(body);
      button.appendChild(when);
      button.addEventListener('click', () => openThread(thread.id));
      list.appendChild(button);
    });
  }

  function openThread(id) {
    activeThreadId = id;
    const thread = activeThread();
    if (thread) {
      thread.messages.forEach((message) => { message.unread = false; });
      save();
    }
    $('inboxEl').classList.add('chat-open');
    renderThreads();
    renderChat();
  }

  function renderChat() {
    const thread = activeThread();
    const logNode = $('chatLog');
    const input = $('msgInput');
    logNode.innerHTML = '';

    if (!thread) {
      $('chatName').textContent = 'Select a conversation';
      $('chatNumber').textContent = '—';
      $('chatAv').textContent = '?';
      $('chatOpts').textContent = '';
      input.disabled = true;
      $('sendBtn').disabled = true;

      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.textContent = 'Choose a conversation on the left to start replying.';
      logNode.appendChild(empty);
      return;
    }

    input.disabled = false;
    $('sendBtn').disabled = false;

    $('chatName').textContent = thread.name;
    $('chatNumber').textContent = fmtNumber(thread.number);
    $('chatAv').textContent = initials(thread.name);
    $('chatOpts').textContent = thread.optIn ? 'Opted in · 24h window open' : 'Opted out · marketing blocked';

    let lastDay = '';
    thread.messages.forEach((message) => {
      const day = dayLabel(message.at);
      if (day !== lastDay) {
        const label = document.createElement('div');
        label.className = 'chat-day';
        label.textContent = day;
        logNode.appendChild(label);
        lastDay = day;
      }

      const bubble = document.createElement('div');
      bubble.className = 'bubble ' + message.dir + (message.status === 'failed' ? ' failed' : '');

      const text = document.createElement('span');
      text.textContent = message.text;
      bubble.appendChild(text);

      if (message.dir === 'out') {
        const stamp = document.createElement('span');
        stamp.className = 'stamp';
        const tick = document.createElement('span');
        tick.className = 'tick';
        if (message.status === 'failed') tick.textContent = '!';
        else if (message.status === 'read' || message.status === 'delivered') tick.textContent = '✓✓';
        else tick.textContent = '✓';
        const label = document.createElement('span');
        label.textContent = timeLabel(message.at) + ' · ' + (message.status || 'queued');
        stamp.appendChild(tick);
        stamp.appendChild(label);
        bubble.appendChild(stamp);
      } else {
        const stamp = document.createElement('span');
        stamp.className = 'stamp';
        stamp.textContent = timeLabel(message.at);
        bubble.appendChild(stamp);
      }

      if (message.error) {
        const err = document.createElement('span');
        err.className = 'stamp';
        err.style.color = '#8a4426';
        err.textContent = message.error;
        bubble.appendChild(err);
      }

      logNode.appendChild(bubble);
    });

    logNode.scrollTop = logNode.scrollHeight;
  }

  /* ---------------------------------------------------------------------- */
  /*  Sending                                                               */
  /* ---------------------------------------------------------------------- */
  async function sendMessage() {
    const thread = activeThread();
    const input = $('msgInput');
    const text = input.value.trim();
    if (!thread) return;
    if (!text) {
      toast('Write a message first.');
      return;
    }

    const account = activeAccount();
    const message = {
      id: uid('m'),
      dir: 'out',
      text,
      at: new Date().toISOString(),
      status: 'queued'
    };
    thread.messages.push(message);
    input.value = '';
    save();
    renderThreads();
    renderChat();

    if (account.kind === 'demo') {
      simulateDemo(account, thread, message);
      return;
    }

    await sendReal(account, thread, message);
  }

  function updateMessage(thread, messageId, patch) {
    const target = thread.messages.find((message) => message.id === messageId);
    if (!target) return;
    Object.assign(target, patch);
    save();
    if (thread.id === activeThreadId) renderChat();
  }

  async function sendReal(account, thread, message) {
    if (!account.phoneNumberId) {
      updateMessage(thread, message.id, { status: 'failed', error: 'No Phone Number ID saved for this account.' });
      log('Send blocked — Phone Number ID missing for ' + account.name + '.', 'err');
      toast('Add this account’s Phone Number ID in Settings first.', true);
      return;
    }

    log('POST /meta-app/send → ' + fmtNumber(thread.number) + ' · Phone Number ID ' + account.phoneNumberId);
    updateMessage(thread, message.id, { status: 'sending' });

    try {
      const response = await fetch(CONFIG.sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (session.accessToken || '')
        },
        body: JSON.stringify({
          accountId: account.id,
          to: digits(thread.number),
          text: message.text
        })
      });

      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (error) { data = { raw }; }

      if (!response.ok) {
        const detail =
          (data.error && (data.error.message || data.error.error_user_msg)) ||
          data.message ||
          raw ||
          'HTTP ' + response.status;
        throw new Error(String(detail).slice(0, 220));
      }

      const wamid =
        (data.messages && data.messages[0] && data.messages[0].id) ||
        data.messageId ||
        data.id ||
        '';

      updateMessage(thread, message.id, { status: 'sent', wamid });
      log('Accepted by Cloud API' + (wamid ? ' · wamid ' + wamid : '') + '.', 'ok');
      toast('Message accepted by the WhatsApp Cloud API.');
    } catch (error) {
      updateMessage(thread, message.id, { status: 'failed', error: error.message });
      log('Send failed — ' + error.message, 'err');
      toast('Send failed. See the activity log for the Meta error.', true);
    }
  }

  const DEMO_REPLIES = {
    acc_lotus: [
      'Great, thank you! Should I come 10 minutes early for the paperwork?',
      'Perfect. And do you take UPI for the consultation?',
      'Noted — see you Saturday.'
    ],
    acc_sunrise: [
      'Yes please send the photos. Is the 4pm visit still free tomorrow?',
      'Understood. Can we negotiate if we close this week?',
      'Thanks, that works for me.'
    ],
    acc_mocha: [
      'Great, please hold the terrace table. We may be 9 people.',
      'Perfect. Can we pre-order two platters?',
      'See you tonight!'
    ],
    acc_fitloop: [
      'Reserved, thank you! What should I bring for the trial?',
      'Great. Is there parking at the studio?',
      'Perfect, see you at 6am.'
    ],
    acc_real: [
      'Thanks for the quick reply. Can you share pricing?',
      'That sounds good — let’s talk tomorrow.',
      'Understood, thank you.'
    ]
  };

  function simulateDemo(account, thread, message) {
    const replies = DEMO_REPLIES[account.id] || DEMO_REPLIES.acc_real;
    const reply = replies[Math.floor(Math.random() * replies.length)];

    log('Demo send · ' + account.name + ' → ' + thread.name + ' (no real message).');

    window.setTimeout(() => updateMessage(thread, message.id, { status: 'sent' }), 350);
    window.setTimeout(() => updateMessage(thread, message.id, { status: 'delivered' }), 1100);
    window.setTimeout(() => updateMessage(thread, message.id, { status: 'read' }), 2100);

    const automationOn = db.automations.find((item) => item.id === 'auto_reply');
    if (!automationOn || !automationOn.enabled) return;

    window.setTimeout(() => {
      thread.messages.push({
        id: uid('m'),
        dir: 'in',
        text: reply,
        at: new Date().toISOString(),
        status: 'read',
        unread: thread.id !== activeThreadId
      });
      save();
      renderAccounts();
      renderThreads();
      if (thread.id === activeThreadId) renderChat();
      log('Simulated inbound reply from ' + thread.name + ' · webhook 200 OK', 'ok');
    }, 3000);
  }

  /* ---------------------------------------------------------------------- */
  /*  Rendering — contacts / templates / automations                        */
  /* ---------------------------------------------------------------------- */
  function renderContacts() {
    const body = $('contactsBody');
    body.innerHTML = '';
    const threads = accountThreads();

    $('contactCount').textContent = threads.length + (threads.length === 1 ? ' contact' : ' contacts');

    if (!threads.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.style.cssText = 'padding:22px;color:var(--ink-30);font-size:.8rem';
      cell.textContent = 'No contacts on this account yet.';
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }

    threads.forEach((thread) => {
      const last = thread.messages[thread.messages.length - 1];
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = thread.name;
      nameCell.appendChild(strong);

      const numberCell = document.createElement('td');
      numberCell.className = 'mono';
      numberCell.textContent = fmtNumber(thread.number);

      const lastCell = document.createElement('td');
      lastCell.textContent = last ? (last.dir === 'out' ? 'You: ' : '') + last.text.slice(0, 54) + (last.text.length > 54 ? '…' : '') : '—';

      const consentCell = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = thread.optIn ? 'pill-ok' : 'pill-demo';
      pill.textContent = thread.optIn ? 'Opted in' : 'Opted out';
      consentCell.appendChild(pill);

      const actionCell = document.createElement('td');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--ghost btn--sm';
      open.textContent = 'Open chat';
      open.addEventListener('click', () => {
        switchView('inbox');
        openThread(thread.id);
      });
      actionCell.appendChild(open);

      row.appendChild(nameCell);
      row.appendChild(numberCell);
      row.appendChild(lastCell);
      row.appendChild(consentCell);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  function renderTemplates() {
    const grid = $('templateGrid');
    grid.innerHTML = '';

    if (!db.templates.length) {
      grid.innerHTML = '<p style="font-size:.82rem;color:var(--ink-30)">No templates yet.</p>';
      return;
    }

    db.templates.forEach((template) => {
      const card = document.createElement('article');
      card.className = 'tpl';

      const top = document.createElement('div');
      top.className = 'tpl-top';
      const code = document.createElement('code');
      code.textContent = template.name;
      const status = document.createElement('span');
      status.className = template.status === 'approved' ? 'pill-ok' : 'pill-warn';
      status.textContent = template.status === 'approved' ? 'Approved' : 'In review';
      top.appendChild(code);
      top.appendChild(status);

      const body = document.createElement('p');
      body.textContent = template.body;

      const meta = document.createElement('span');
      meta.className = 'tpl-meta';
      meta.textContent = template.category + ' · ' + template.lang + ' · Cloud API';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost btn--sm';
      button.textContent = 'Use in chat →';
      button.addEventListener('click', () => {
        const thread = activeThread();
        if (!thread) {
          toast('Pick a conversation first.');
          return;
        }
        const hints = ['name', 'detail', 'link'];
        let index = 0;
        const filled = template.body.replace(/\{\{\s*\d+\s*\}\}/g, function () {
          const hint = hints[index] || 'value';
          index += 1;
          return '[' + hint + ']';
        });
        $('msgInput').value = filled;
        switchView('inbox');
        $('msgInput').focus();
        toast('Template loaded — replace the [bracketed] fields before sending.');
      });

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(body);
      card.appendChild(button);
      grid.appendChild(card);
    });
  }

  function renderAutomations() {
    const grid = $('automationGrid');
    grid.innerHTML = '';

    db.automations.forEach((automation) => {
      const card = document.createElement('article');
      card.className = 'auto';

      const title = document.createElement('h3');
      title.textContent = automation.name;
      const desc = document.createElement('p');
      desc.textContent = automation.desc;

      const foot = document.createElement('div');
      foot.className = 'auto-foot';
      const state = document.createElement('span');
      state.textContent = automation.enabled ? 'Active · automation' : 'Paused';
      const sw = document.createElement('label');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = automation.enabled;
      input.setAttribute('aria-label', 'Toggle ' + automation.name);
      const slider = document.createElement('i');
      input.addEventListener('change', () => {
        automation.enabled = input.checked;
        state.textContent = automation.enabled ? 'Active · automation' : 'Paused';
        save();
        log('Automation “' + automation.name + '” ' + (automation.enabled ? 'enabled' : 'paused') + '.', 'ok');
        toast(automation.name + (automation.enabled ? ' enabled' : ' paused') + '.');
      });
      sw.appendChild(input);
      sw.appendChild(slider);

      foot.appendChild(state);
      foot.appendChild(sw);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(foot);
      grid.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Rendering — settings + log                                            */
  /* ---------------------------------------------------------------------- */
  function renderSettings() {
    const account = activeAccount();

    $('inputPhoneId').value = account.phoneNumberId || '';
    $('inputWaba').value = account.wabaId || '';
    $('connStatus').textContent = account.connected ? 'Connected' : 'Not connected';
    $('connWaba').textContent = account.wabaId || '—';
    $('connPhone').textContent = account.phoneNumberId || '—';
    $('settingsStatus').textContent = account.connected ? 'Connected · ' + fmtNumber(account.number) : 'Not connected';

    $('accountTypeNote').textContent = account.kind === 'real'
      ? 'This is your live Cloud API account. Messages are sent to real WhatsApp numbers.'
      : 'This is a demo account. Sending is simulated locally and never reaches WhatsApp.';

    $('profileName').value = session.name || '';
    $('profileBusiness').value = session.business || '';
  }

  function renderLog() {
    const box = $('logBox');
    if (!box) return;
    box.innerHTML = '';

    if (!db.activity.length) {
      box.textContent = '— no activity yet —';
      return;
    }

    db.activity.slice(0, 40).forEach((entry) => {
      const line = document.createElement('div');
      if (entry.kind === 'ok') line.className = 'ok';
      if (entry.kind === 'err') line.className = 'err';
      line.textContent = '[' + new Date(entry.at).toLocaleTimeString([], { hour12: false }) + '] ' + entry.message;
      box.appendChild(line);
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Views                                                                 */
  /* ---------------------------------------------------------------------- */
  function switchView(view) {
    currentView = view;

    document.querySelectorAll('.ws-nav button').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    document.querySelectorAll('.ws-view').forEach((section) => {
      section.classList.toggle('active', section.dataset.view === view);
    });

    if (view === 'inbox') {
      $('inboxEl').classList.remove('chat-open');
      renderThreads();
      renderChat();
    }
    if (view === 'contacts') renderContacts();
    if (view === 'templates') renderTemplates();
    if (view === 'automations') renderAutomations();
    if (view === 'settings') renderSettings();

    closeRail();
  }

  function renderAll() {
    renderAccounts();
    renderHeader();
    renderThreads();
    renderChat();
    renderSettings();
    renderLog();
  }

  function closeRail() {
    $('rail').classList.remove('open');
  }

  /* ---------------------------------------------------------------------- */
  /*  Embedded Signup                                                       */
  /* ---------------------------------------------------------------------- */
  let signupTarget = null;

  window.fbAsyncInit = function () {
    window.FB.init({
      appId: CONFIG.appId,
      autoLogAppEvents: true,
      xfbml: true,
      version: CONFIG.graphVersion
    });
  };

  window.addEventListener('message', function (event) {
    if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://facebook.com') return;
    if (typeof event.data !== 'string') return;

    let data;
    try { data = JSON.parse(event.data); } catch (error) { return; }
    if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

    if (data.event === 'FINISH' && data.data) {
      const account = activeAccount();
      if (data.data.waba_id) account.wabaId = String(data.data.waba_id);
      if (data.data.phone_number_id) account.phoneNumberId = String(data.data.phone_number_id);
      if (account.wabaId || account.phoneNumberId) account.connected = true;
      save();
      renderAll();
      log('Embedded Signup finished · WABA ' + (account.wabaId || '—') + ' · Phone ' + (account.phoneNumberId || '—'), 'ok');
      toast('WhatsApp account values received from Meta.');
    } else if (data.event === 'CANCEL') {
      log('Embedded Signup cancelled by the user.');
      const status = $('connectStatus');
      if (status) status.textContent = 'Signup cancelled.';
    } else if (data.event === 'ERROR') {
      log('Embedded Signup error: ' + JSON.stringify(data.data || data), 'err');
    }
  });

  function openEmbeddedSignup() {
    const status = $('connectStatus');
    if (!window.FB) {
      if (status) status.textContent = 'Facebook signup is still loading. Try again in a moment.';
      toast('Meta signup is still loading. Try again in a second.', true);
      return;
    }

    if (status) status.textContent = 'Opening Meta Embedded Signup…';
    log('Opening Embedded Signup with config ' + CONFIG.configId + '.');

    window.FB.login(
      function (response) {
        if (!response.authResponse || !response.authResponse.code) {
          if (status) status.textContent = 'Signup cancelled or not authorised.';
          log('FB.login closed without an authorisation code.', 'err');
          return;
        }

        if (status) status.textContent = 'Exchanging the code securely on the server…';
        log('Authorisation code received — exchanging server-side via Supabase Edge Function.');

        fetch(CONFIG.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (session.accessToken || '')
          },
          body: JSON.stringify({
            code: response.authResponse.code,
            label: (activeAccount() && activeAccount().name) || undefined
          })
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Backend responded ' + res.status);
            return res.json().catch(function () { return {}; });
          })
          .then(function (data) {
            const account = activeAccount();
            const waba = data.wabaId || data.waba_id;
            const phone = data.phoneNumberId || data.phone_number_id;
            if (waba) account.wabaId = String(waba);
            if (phone) account.phoneNumberId = String(phone);
            account.connected = true;
            save();
            renderAll();

            if (status) status.textContent = 'WhatsApp connected successfully.';
            log('Token exchange complete · connection saved for ' + account.name + '.', 'ok');
            toast('WhatsApp connected. You can send a message now.');
          })
          .catch(function (error) {
            if (status) status.textContent = 'Could not complete the connection. Please retry.';
            log('Token exchange failed: ' + error.message, 'err');
            toast('Token exchange failed — see the activity log.', true);
          });
      },
      {
        config_id: CONFIG.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' }
      }
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  Health check                                                          */
  /* ---------------------------------------------------------------------- */
  function checkHealth(silent) {
    fetch(CONFIG.healthUrl, { method: 'GET' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function (data) {
        $('connWebhook').textContent = data.status === 'ok' ? 'Online · 200 OK' : 'Online';
        $('connWebhook').style.color = 'var(--olive)';
        if (!silent) {
          log('Webhook health check passed.', 'ok');
          toast('Verification webhook online.');
        }
      })
      .catch(function () {
        $('connWebhook').textContent = 'Unavailable';
        $('connWebhook').style.color = 'var(--rust)';
        if (!silent) {
          log('Health check failed — webhook may be unpublished.', 'err');
          toast('Webhook health check failed.', true);
        }
      });
  }

  /* ---------------------------------------------------------------------- */
  /*  Events                                                                */
  /* ---------------------------------------------------------------------- */
  function bind() {
    document.querySelectorAll('.ws-nav button').forEach((button) => {
      button.addEventListener('click', () => switchView(button.dataset.view));
    });

    $('threadSearch').addEventListener('input', function (event) {
      searchTerm = event.target.value.trim().toLowerCase();
      renderThreads();
    });

    $('sendBtn').addEventListener('click', sendMessage);

    $('msgInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    $('msgInput').addEventListener('input', function (event) {
      event.target.style.height = 'auto';
      event.target.style.height = Math.min(event.target.scrollHeight, 130) + 'px';
    });

    $('logoutBtn').addEventListener('click', function () {
      window.AnvayraAuth.logout();
    });

    $('wsMenu').addEventListener('click', function () {
      $('rail').classList.add('open');
    });
    $('railClose').addEventListener('click', closeRail);

    $('chatBack').addEventListener('click', function () {
      $('inboxEl').classList.remove('chat-open');
    });

    $('btnConnect').addEventListener('click', openEmbeddedSignup);
    $('settingsConnectBtn').addEventListener('click', openEmbeddedSignup);
    $('addAccount').addEventListener('click', function () {
      switchView('settings');
      openEmbeddedSignup();
    });

    $('btnOpenSite').addEventListener('click', function () {
      window.location.href = '../';
    });

    $('saveAccountBtn').addEventListener('click', function () {
      const account = activeAccount();
      const phone = digits($('inputPhoneId').value);
      const waba = digits($('inputWaba').value);
      account.phoneNumberId = phone;
      account.wabaId = waba;
      account.connected = Boolean(phone || waba);
      save();
      renderAll();
      log('Connection details saved for ' + account.name + ' · Phone ' + (phone || '—'), 'ok');
      toast('Connection details saved.');
    });

    $('disconnectBtn').addEventListener('click', function () {
      const account = activeAccount();
      account.phoneNumberId = '';
      account.wabaId = '';
      account.connected = false;
      save();
      renderAll();
      log('Disconnected ' + account.name + ' locally. Server records are removed on request.', 'err');
      toast('Account disconnected locally.');
    });

    $('saveProfileBtn').addEventListener('click', async function () {
      const button = $('saveProfileBtn');
      button.disabled = true;
      try {
        const updated = await window.AnvayraAuth.updateProfile({
          name: $('profileName').value,
          business: $('profileBusiness').value
        });
        if (updated) {
          session.name = updated.name;
          session.business = updated.business;
          renderHeader();
          toast('Profile saved.');
        }
      } catch (error) {
        toast(error.message || 'Could not save the profile.');
      } finally {
        button.disabled = false;
      }
    });

    $('healthBtn').addEventListener('click', function () {
      checkHealth(false);
    });

    $('clearLogBtn').addEventListener('click', function () {
      db.activity = [];
      save();
      renderLog();
    });

    $('wipeLocalBtn').addEventListener('click', function () {
      if (!window.confirm('Clear this browser’s workspace data? Conversations, contacts and connection IDs will be removed from this device.')) return;
      localStorage.removeItem(WS_KEY);
      window.location.reload();
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Init                                                                  */
  /* ---------------------------------------------------------------------- */
  db = load();

  if (!db.threads[db.activeAccountId]) {
    db.activeAccountId = db.accounts[0].id;
  }
  if (!activeThreadId) {
    const threads = accountThreads();
    activeThreadId = threads.length ? threads[0].id : null;
  }

  save();
  bind();
  renderAll();
  log('Workspace loaded for ' + (session.email || 'this session') + '. Access tokens never reach the browser.', 'ok');
  checkHealth(true);

  if (new URLSearchParams(window.location.search).get('welcome')) {
    toast('Workspace ready. Connect WhatsApp from Settings.');
    switchView('settings');
  }
})();
