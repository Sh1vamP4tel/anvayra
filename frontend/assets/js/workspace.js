/* ==========================================================================
   Anvayra — workspace.js
   Real, database-backed WhatsApp workspace.

   Everything shown here comes from the signed-in user's workspace in the
   database: WhatsApp accounts, contacts, threads, messages, templates,
   automations and the activity log. Business data is never seeded or kept
   in the browser.

   Security: no App Secret and no WhatsApp access token ever lives in this
   file. Connection and sending call server-side functions that hold the
   credentials in the encrypted vault.
   ========================================================================== */

(async function () {
  'use strict';

  const auth = window.AnvayraAuth;
  if (!auth) {
    window.location.replace('../login/?next=dashboard');
    return;
  }

  /* Session guard: redirects to /login/ when there is no session. */
  const session = await auth.requireSession();
  if (!session) return;

  /* Session confirmed — reveal the workspace and drop the checking splash. */
  document.body.classList.add('auth-ready');
  const authSplash = document.getElementById('authSplash');
  if (authSplash) authSplash.remove();

  const client = auth.client;
  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------------- */
  /*  Config                                                                */
  /* ---------------------------------------------------------------------- */
  const CONFIG = {
    appId: '1111754955165517',
    configId: '1469679065081628',
    graphVersion: 'v21.0',
    healthUrl: 'https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/health'
  };

  /* Product automations. The database stores one row per account per key;
     this catalogue supplies the human label and description. */
  const AUTOMATION_CATALOGUE = {
    auto_reply: {
      name: 'Instant first reply',
      desc: 'Answers a new contact within seconds and hands over to a person when asked.'
    },
    lead_capture: {
      name: 'Lead capture',
      desc: 'Stores every enquiry with the number, intent and consent timestamp.'
    },
    appointment_reminder: {
      name: 'Appointment reminders',
      desc: 'Sends reminders before a booked appointment with confirm and reschedule options.'
    },
    opt_out_handler: {
      name: 'STOP / opt-out handler',
      desc: 'Honours STOP instantly, records the suppression and blocks future marketing.'
    },
    human_handover: {
      name: 'Human handover',
      desc: 'Notifies the team and pauses automation when a customer asks for a person.'
    },
    daily_digest: {
      name: 'Daily owner digest',
      desc: 'Sends a daily summary of new leads, unanswered chats and template performance.'
    }
  };

  /* ---------------------------------------------------------------------- */
  /*  State                                                                 */
  /* ---------------------------------------------------------------------- */
  const state = {
    workspaceId: null,
    workspaceName: '',
    accounts: [],
    activeAccountId: null,
    threads: [],
    activeThreadId: null,
    messages: [],
    contacts: [],
    templates: [],
    automations: [],
    activity: [],
    embeddedSignup: null,
    loadError: ''
  };

  /* ---------------------------------------------------------------------- */
  /*  Utilities                                                             */
  /* ---------------------------------------------------------------------- */
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

  function dayLabel(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(date, today)) return 'Today';
    if (sameDay(date, yesterday)) return 'Yesterday';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function timeLabel(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function relativeLabel(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return '';
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
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('bad', Boolean(bad));
    node.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('show'), 3800);
  }

  /* Unwraps a database query and turns errors into readable exceptions. */
  async function rows(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message || 'Database request failed.');
    return data;
  }

  /* Calls an Edge Function with the signed-in user's session. */
  async function callFunction(name, body) {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      let detail = error.message || 'Request failed.';
      try {
        const payload = await error.context.json();
        detail = payload.error || payload.message || detail;
      } catch (_) {
        /* response was not JSON */
      }
      throw new Error(detail);
    }
    return data || {};
  }

  function activeAccount() {
    return state.accounts.find((account) => account.id === state.activeAccountId) || null;
  }

  function accountConnected(account) {
    return Boolean(account && account.status === 'connected' && account.phone_number_id);
  }

  function accountName(account) {
    return (account && (account.business_name || account.label)) || 'WhatsApp Business';
  }

  function activeThread() {
    return state.threads.find((thread) => thread.id === state.activeThreadId) || null;
  }

  /* ---------------------------------------------------------------------- */
  /*  Data loading                                                          */
  /* ---------------------------------------------------------------------- */
  async function loadWorkspace() {
    let workspace = await rows(
      client
        .from('workspaces')
        .select('id,name')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    );

    if (!workspace) {
      const id = await rows(client.rpc('ensure_workspace', { p_name: session.business || null }));
      workspace = { id: id, name: session.business || 'My workspace' };
    }

    state.workspaceId = workspace.id;
    state.workspaceName = workspace.name || 'My workspace';
    await Promise.all([loadAccounts(), loadActivity()]);
  }

  async function loadAccounts() {
    state.accounts =
      (await rows(
        client
          .from('whatsapp_accounts')
          .select('id,label,waba_id,phone_number_id,display_phone,business_name,status,connected_at')
          .eq('workspace_id', state.workspaceId)
          .order('created_at', { ascending: true })
      )) || [];

    if (!state.activeAccountId || !state.accounts.some((account) => account.id === state.activeAccountId)) {
      state.activeAccountId = state.accounts.length ? state.accounts[0].id : null;
    }

    await loadAccountData();
  }

  async function loadAccountData() {
    if (!state.activeAccountId) {
      state.contacts = [];
      state.threads = [];
      state.templates = [];
      state.automations = [];
      state.activeThreadId = null;
      state.messages = [];
      return;
    }

    const [contacts, threads, templates, automations] = await Promise.all([
      rows(
        client
          .from('contacts')
          .select('id,wa_id,name,opt_in_state,last_seen_at')
          .eq('workspace_id', state.workspaceId)
          .order('last_seen_at', { ascending: false, nullsFirst: false })
      ),
      rows(
        client
          .from('threads')
          .select('id,contact_id,status,unread_count,last_message_at,last_message_preview,contacts(name,wa_id,opt_in_state)')
          .eq('workspace_id', state.workspaceId)
          .eq('account_id', state.activeAccountId)
          .order('last_message_at', { ascending: false })
      ),
      rows(
        client
          .from('templates')
          .select('id,name,language,category,status,body_preview,components')
          .eq('account_id', state.activeAccountId)
          .order('created_at', { ascending: false })
      ),
      rows(
        client
          .from('automations')
          .select('id,key,enabled')
          .eq('account_id', state.activeAccountId)
      )
    ]);

    state.contacts = contacts || [];
    state.templates = templates || [];
    state.automations = automations || [];
    state.threads = (threads || []).map((thread) => {
      const contact = thread.contacts || {};
      return {
        id: thread.id,
        contactId: thread.contact_id,
        name: contact.name || fmtNumber(contact.wa_id) || 'Unknown contact',
        number: contact.wa_id || '',
        optInState: contact.opt_in_state || 'unknown',
        unread: thread.unread_count || 0,
        lastMessageAt: thread.last_message_at,
        preview: thread.last_message_preview || ''
      };
    });

    if (!state.activeThreadId || !state.threads.some((thread) => thread.id === state.activeThreadId)) {
      state.activeThreadId = state.threads.length ? state.threads[0].id : null;
    }

    state.messages = [];
    if (state.activeThreadId) await loadMessages(state.activeThreadId);
  }

  async function loadMessages(threadId) {
    const messages = await rows(
      client
        .from('messages')
        .select('id,direction,body,status,error_message,created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(500)
    );

    state.messages = (messages || []).map((message) => ({
      id: message.id,
      dir: message.direction === 'out' ? 'out' : 'in',
      text: message.body || '',
      at: message.created_at,
      status: message.status || '',
      error: message.error_message || ''
    }));
  }

  async function loadActivity() {
    const items =
      (await rows(
        client
          .from('activity_log')
          .select('action,detail,kind,created_at')
          .eq('workspace_id', state.workspaceId)
          .order('created_at', { ascending: false })
          .limit(60)
      )) || [];

    state.activity = items.map((item) => ({
      at: item.created_at,
      message: (item.action ? String(item.action).replace(/\./g, ' ') + ' — ' : '') + (item.detail || ''),
      kind: item.kind || 'info'
    }));
  }

  /* ---------------------------------------------------------------------- */
  /*  Rendering — rail + header                                             */
  /* ---------------------------------------------------------------------- */
  function renderAccounts() {
    const list = $('accountList');
    list.innerHTML = '';

    if (!state.accounts.length) {
      const empty = document.createElement('p');
      empty.className = 'ws-rail-empty';
      empty.textContent = 'No WhatsApp account connected yet.';
      list.appendChild(empty);
    }

    state.accounts.forEach((account) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ws-account' + (account.id === state.activeAccountId ? ' active' : '') + ' is-real';
      button.setAttribute('aria-pressed', String(account.id === state.activeAccountId));

      const av = document.createElement('span');
      av.className = 'av';
      av.textContent = initials(accountName(account));

      const meta = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = accountName(account);
      const sub = document.createElement('span');
      sub.className = 'sub';
      const last4 = digits(account.display_phone).slice(-4);
      sub.textContent = (accountConnected(account) ? 'LIVE' : 'SETUP') + (last4 ? ' · ' + last4 : '');
      meta.appendChild(name);
      meta.appendChild(sub);

      const dot = document.createElement('span');
      dot.className = 'dot' + (accountConnected(account) ? '' : ' off');

      button.appendChild(av);
      button.appendChild(meta);
      button.appendChild(dot);
      button.addEventListener('click', () => selectAccount(account.id));
      list.appendChild(button);
    });

    const unread = state.threads.reduce((total, thread) => total + (thread.unread || 0), 0);
    $('inboxCount').textContent = String(unread);
    $('inboxCount').style.display = unread ? '' : 'none';
  }

  function renderHeader() {
    const account = activeAccount();

    $('userName').textContent = session.name || 'Workspace owner';
    $('userEmail').textContent = session.email || '';
    $('userAv').textContent = initials(session.name || 'A');

    if (!account) {
      $('accName').textContent = state.workspaceName;
      $('accNumber').textContent = 'No WhatsApp number connected';
      $('accBadge').textContent = 'Cloud API';
      $('accBadge').className = 'ws-badge';
      $('accStatusText').textContent = 'Connect WhatsApp to start';
      $('composerHint').textContent = 'Connect a WhatsApp Business account to reply to customers.';
      $('composerHint').className = '';
      return;
    }

    const connected = accountConnected(account);
    $('accName').textContent = accountName(account);
    $('accNumber').textContent = fmtNumber(account.display_phone);
    $('accBadge').textContent = connected ? 'Live · Cloud API' : 'Setup · Cloud API';
    $('accBadge').className = 'ws-badge';
    $('accStatusText').textContent = connected
      ? 'Connected · sending enabled'
      : 'Not connected — finish Embedded Signup';

    $('composerHint').textContent = connected
      ? 'Sends through the WhatsApp Cloud API · recipient must have opted in'
      : 'Connect this account before sending messages';
    $('composerHint').className = connected ? 'real' : '';
  }

  function selectAccount(id) {
    state.activeAccountId = id;
    state.activeThreadId = null;
    searchTerm = '';
    $('threadSearch').value = '';
    closeRail();
    loadAccountData()
      .then(renderAll)
      .catch((error) => toast('Could not load this account: ' + error.message, true));
  }

  /* ---------------------------------------------------------------------- */
  /*  Rendering — inbox                                                     */
  /* ---------------------------------------------------------------------- */
  let searchTerm = '';

  function renderThreads() {
    const list = $('threadList');
    list.innerHTML = '';

    const threads = state.threads.filter((thread) => {
      if (!searchTerm) return true;
      return (
        thread.name.toLowerCase().includes(searchTerm) ||
        thread.number.includes(searchTerm) ||
        thread.preview.toLowerCase().includes(searchTerm)
      );
    });

    if (!threads.length) {
      const empty = document.createElement('p');
      empty.className = 'ws-empty-note';
      empty.textContent = searchTerm
        ? 'No conversation matches that search.'
        : 'No conversations yet. New customer messages will appear here.';
      list.appendChild(empty);
      return;
    }

    threads.forEach((thread) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thread' + (thread.id === state.activeThreadId ? ' active' : '');

      const av = document.createElement('span');
      av.className = 'av';
      av.textContent = initials(thread.name);

      const body = document.createElement('span');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = thread.name;
      const prev = document.createElement('span');
      prev.className = 'prev';
      prev.textContent = thread.preview || 'No messages yet';
      body.appendChild(who);
      body.appendChild(prev);
      if (thread.unread) {
        const badge = document.createElement('span');
        badge.className = 'unread';
        badge.textContent = thread.unread + ' new';
        body.appendChild(badge);
      }

      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = relativeLabel(thread.lastMessageAt);

      button.appendChild(av);
      button.appendChild(body);
      button.appendChild(when);
      button.addEventListener('click', () => openThread(thread.id));
      list.appendChild(button);
    });
  }

  async function openThread(id) {
    state.activeThreadId = id;
    state.messages = [];
    $('inboxEl').classList.add('chat-open');
    renderThreads();
    renderChat();

    try {
      await Promise.all([
        loadMessages(id),
        rows(client.rpc('mark_thread_read', { p_thread_id: id })).catch(() => null)
      ]);
      const thread = state.threads.find((item) => item.id === id);
      if (thread) thread.unread = 0;
      renderAccounts();
      renderThreads();
      renderChat();
    } catch (error) {
      toast('Could not load this conversation: ' + error.message, true);
    }
  }

  function renderChat() {
    const thread = activeThread();
    const logNode = $('chatLog');
    const input = $('msgInput');
    const sendButton = $('sendBtn');
    logNode.innerHTML = '';

    if (!state.activeAccountId) {
      $('chatName').textContent = 'No account connected';
      $('chatNumber').textContent = '—';
      $('chatAv').textContent = '?';
      $('chatOpts').textContent = '';
      input.disabled = true;
      sendButton.disabled = true;
      logNode.innerHTML = '<div class="chat-empty">Connect WhatsApp Business to start receiving customer conversations.</div>';
      return;
    }

    if (!thread) {
      $('chatName').textContent = 'Select a conversation';
      $('chatNumber').textContent = '—';
      $('chatAv').textContent = '?';
      $('chatOpts').textContent = '';
      input.disabled = true;
      sendButton.disabled = true;
      logNode.innerHTML = '<div class="chat-empty">No conversations yet. New customer messages will appear here.</div>';
      return;
    }

    const connected = accountConnected(activeAccount());
    input.disabled = !connected;
    sendButton.disabled = !connected;

    $('chatName').textContent = thread.name;
    $('chatNumber').textContent = fmtNumber(thread.number);
    $('chatAv').textContent = initials(thread.name);
    $('chatOpts').textContent =
      thread.optInState === 'opted_in'
        ? 'Opted in · 24h window open'
        : thread.optInState === 'opted_out'
          ? 'Opted out · marketing blocked'
          : 'Consent not recorded';

    if (!state.messages.length) {
      logNode.innerHTML = '<div class="chat-empty">No messages in this conversation yet.</div>';
      return;
    }

    let lastDay = '';
    state.messages.forEach((message) => {
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

      const stamp = document.createElement('span');
      stamp.className = 'stamp';
      if (message.dir === 'out') {
        const tick = document.createElement('span');
        tick.className = 'tick';
        if (message.status === 'failed') tick.textContent = '!';
        else if (message.status === 'read' || message.status === 'delivered') tick.textContent = '✓✓';
        else tick.textContent = '✓';
        const label = document.createElement('span');
        label.textContent = timeLabel(message.at) + ' · ' + (message.status || 'queued');
        stamp.appendChild(tick);
        stamp.appendChild(label);
      } else {
        stamp.textContent = timeLabel(message.at);
      }
      bubble.appendChild(stamp);

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
  /*  Rendering — contacts / templates / automations                        */
  /* ---------------------------------------------------------------------- */
  function renderContacts() {
    const body = $('contactsBody');
    body.innerHTML = '';

    $('contactCount').textContent =
      state.contacts.length + (state.contacts.length === 1 ? ' contact' : ' contacts');

    if (!state.contacts.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'ws-empty-cell';
      cell.textContent = 'No contacts yet. Anyone who messages your WhatsApp account will appear here.';
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }

    state.contacts.forEach((contact) => {
      const thread = state.threads.find((item) => item.contactId === contact.id);
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = contact.name || fmtNumber(contact.wa_id);
      nameCell.appendChild(strong);

      const numberCell = document.createElement('td');
      numberCell.className = 'mono';
      numberCell.textContent = fmtNumber(contact.wa_id);

      const lastCell = document.createElement('td');
      lastCell.textContent = thread && thread.preview ? thread.preview.slice(0, 64) : '—';

      const consentCell = document.createElement('td');
      const pill = document.createElement('span');
      const consent = contact.opt_in_state || 'unknown';
      pill.className = consent === 'opted_in' ? 'pill-ok' : consent === 'opted_out' ? 'pill-off' : 'pill-warn';
      pill.textContent = consent === 'opted_in' ? 'Opted in' : consent === 'opted_out' ? 'Opted out' : 'Unknown';
      consentCell.appendChild(pill);

      const actionCell = document.createElement('td');
      if (thread) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn btn--ghost btn--sm';
        open.textContent = 'Open chat';
        open.addEventListener('click', () => {
          switchView('inbox');
          openThread(thread.id);
        });
        actionCell.appendChild(open);
      }

      row.appendChild(nameCell);
      row.appendChild(numberCell);
      row.appendChild(lastCell);
      row.appendChild(consentCell);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  function templateBody(template) {
    if (template.body_preview) return template.body_preview;
    const components = Array.isArray(template.components) ? template.components : [];
    const body = components.find((component) => String(component.type || '').toUpperCase() === 'BODY');
    return (body && (body.text || (body.example && body.example.body_text && body.example.body_text[0]))) || '—';
  }

  function renderTemplates() {
    const grid = $('templateGrid');
    const syncButton = $('syncTemplatesBtn');
    grid.innerHTML = '';

    if (syncButton) {
      syncButton.disabled = !accountConnected(activeAccount());
      syncButton.title = accountConnected(activeAccount())
        ? 'Fetch the latest templates from WhatsApp'
        : 'Connect an account first';
    }

    if (!state.templates.length) {
      grid.innerHTML =
        '<p class="ws-empty-note">No templates on this account yet. Approved templates from WhatsApp Manager appear here after a sync once the account is connected.</p>';
      return;
    }

    state.templates.forEach((template) => {
      const card = document.createElement('article');
      card.className = 'tpl';

      const top = document.createElement('div');
      top.className = 'tpl-top';
      const code = document.createElement('code');
      code.textContent = template.name;
      const status = document.createElement('span');
      const stateName = String(template.status || 'PENDING').toUpperCase();
      status.className = stateName === 'APPROVED' ? 'pill-ok' : 'pill-warn';
      status.textContent =
        stateName === 'APPROVED'
          ? 'Approved'
          : stateName === 'REJECTED'
            ? 'Rejected'
            : stateName === 'PAUSED' || stateName === 'DISABLED'
              ? stateName.toLowerCase()
              : 'In review';
      top.appendChild(code);
      top.appendChild(status);

      const body = document.createElement('p');
      body.textContent = templateBody(template);

      const meta = document.createElement('span');
      meta.className = 'tpl-meta';
      meta.textContent = String(template.category || 'UTILITY') + ' · ' + String(template.language || 'en') + ' · Cloud API';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost btn--sm';
      button.textContent = 'Copy to composer →';
      button.addEventListener('click', () => {
        const thread = activeThread();
        if (!thread) {
          toast('Pick a conversation first.');
          return;
        }
        const hints = ['name', 'detail', 'link'];
        let index = 0;
        const filled = templateBody(template).replace(/\{\{\s*\d+\s*\}\}/g, () => {
          const hint = hints[index] || 'value';
          index += 1;
          return '[' + hint + ']';
        });
        $('msgInput').value = filled;
        switchView('inbox');
        $('msgInput').focus();
        toast('Template copied — replace the [bracketed] fields before sending.');
      });

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(body);
      card.appendChild(button);
      grid.appendChild(card);
    });
  }

  async function syncTemplates(silent) {
    const account = activeAccount();
    if (!accountConnected(account)) {
      if (!silent) toast('Connect WhatsApp Business before syncing templates.', true);
      return;
    }

    const button = $('syncTemplatesBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Syncing…';
    }

    try {
      const result = await callFunction('wa-templates', { accountId: account.id });
      state.templates =
        (await rows(
          client
            .from('templates')
            .select('id,name,language,category,status,body_preview,components')
            .eq('account_id', account.id)
            .order('created_at', { ascending: false })
        )) || [];
      renderTemplates();
      if (!silent) {
        toast(
          result.count
            ? result.count + (result.count === 1 ? ' template synced from WhatsApp.' : ' templates synced from WhatsApp.')
            : 'No templates are available on this WhatsApp account yet.'
        );
      }
    } catch (error) {
      if (!silent) toast('Template sync failed: ' + error.message, true);
    } finally {
      if (button) {
        button.disabled = !accountConnected(activeAccount());
        button.textContent = 'Sync from WhatsApp';
      }
    }
  }

  function renderAutomations() {
    const grid = $('automationGrid');
    grid.innerHTML = '';

    const byKey = new Map(state.automations.map((row) => [row.key, row]));
    const keys = Object.keys(AUTOMATION_CATALOGUE);

    if (!state.activeAccountId) {
      const note = document.createElement('p');
      note.className = 'ws-empty-note';
      note.textContent = 'Connect a WhatsApp Business account to configure automations.';
      grid.appendChild(note);
    }

    keys.forEach((key) => {
      const meta = AUTOMATION_CATALOGUE[key];
      const row = byKey.get(key);
      const enabled = Boolean(row && row.enabled);

      const card = document.createElement('article');
      card.className = 'auto';

      const title = document.createElement('h3');
      title.textContent = meta.name;
      const desc = document.createElement('p');
      desc.textContent = meta.desc;

      const foot = document.createElement('div');
      foot.className = 'auto-foot';
      const label = document.createElement('span');
      label.textContent = !row ? 'Connect account' : enabled ? 'On · saved' : 'Off · saved';

      const sw = document.createElement('label');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = enabled;
      input.disabled = !row;
      input.setAttribute('aria-label', 'Toggle ' + meta.name);
      const slider = document.createElement('i');

      input.addEventListener('change', async () => {
        if (!row) return;
        input.disabled = true;
        try {
          await rows(
            client
              .from('automations')
              .update({ enabled: input.checked })
              .eq('id', row.id)
          );
          row.enabled = input.checked;
          label.textContent = input.checked ? 'On · saved' : 'Off · saved';
          toast(meta.name + (input.checked ? ' turned on' : ' turned off') + ' for this account.');
        } catch (error) {
          input.checked = !input.checked;
          toast('Could not update the automation: ' + error.message, true);
        } finally {
          input.disabled = false;
        }
      });

      sw.appendChild(input);
      sw.appendChild(slider);
      foot.appendChild(label);
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
    const connected = accountConnected(account);

    $('settingsStatus').textContent = account
      ? connected
        ? 'Connected · ' + fmtNumber(account.display_phone)
        : 'Not connected'
      : 'Not connected';

    $('connStatus').textContent = account ? (connected ? 'Connected' : account.status || 'Pending') : '—';
    $('connBusiness').textContent = account ? accountName(account) : '—';
    $('connWaba').textContent = (account && account.waba_id) || '—';
    $('connPhone').textContent = (account && account.phone_number_id) || '—';

    $('accountTypeNote').textContent = connected
      ? 'This is your live WhatsApp Cloud API account. Messages are delivered to real customers.'
      : 'Connect a WhatsApp Business account to enable live messaging.';

    $('profileName').value = session.name || '';
    $('profileBusiness').value = session.business || '';
    $('disconnectBtn').disabled = !account;
  }

  function renderLog() {
    const box = $('logBox');
    if (!box) return;
    box.innerHTML = '';

    if (!state.activity.length) {
      box.textContent = '— no activity yet —';
      return;
    }

    state.activity.slice(0, 40).forEach((entry) => {
      const line = document.createElement('div');
      if (entry.kind === 'ok') line.className = 'ok';
      if (entry.kind === 'err' || entry.kind === 'error') line.className = 'err';
      line.textContent = '[' + timeLabel(entry.at) + '] ' + entry.message;
      box.appendChild(line);
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Views                                                                 */
  /* ---------------------------------------------------------------------- */
  function switchView(view) {
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
  /*  Sending                                                               */
  /* ---------------------------------------------------------------------- */
  async function sendMessage() {
    const account = activeAccount();
    const thread = activeThread();
    const input = $('msgInput');
    const text = input.value.trim();

    if (!thread) {
      toast('Select a conversation first.');
      return;
    }
    if (!accountConnected(account)) {
      toast('Connect WhatsApp Business before sending.', true);
      return;
    }
    if (!text) {
      toast('Write a message first.');
      return;
    }

    const pending = {
      id: 'local_' + Date.now(),
      dir: 'out',
      text: text,
      at: new Date().toISOString(),
      status: 'sending',
      error: ''
    };

    state.messages.push(pending);
    input.value = '';
    input.style.height = 'auto';
    renderChat();

    try {
      await callFunction('wa-send', {
        accountId: account.id,
        to: digits(thread.number),
        text: text
      });

      await loadMessages(thread.id);
      await loadActivity();
      renderChat();
      renderLog();
      toast('Message accepted by the WhatsApp Cloud API.');
    } catch (error) {
      pending.status = 'failed';
      pending.error = error.message;
      renderChat();
      toast('Send failed: ' + error.message, true);
    }

    loadThreadsOnly().catch(() => null);
  }

  async function loadThreadsOnly() {
    if (!state.activeAccountId) return;
    const threads = await rows(
      client
        .from('threads')
        .select('id,contact_id,status,unread_count,last_message_at,last_message_preview,contacts(name,wa_id,opt_in_state)')
        .eq('workspace_id', state.workspaceId)
        .eq('account_id', state.activeAccountId)
        .order('last_message_at', { ascending: false })
    );

    state.threads = (threads || []).map((thread) => {
      const contact = thread.contacts || {};
      return {
        id: thread.id,
        contactId: thread.contact_id,
        name: contact.name || fmtNumber(contact.wa_id) || 'Unknown contact',
        number: contact.wa_id || '',
        optInState: contact.opt_in_state || 'unknown',
        unread: thread.unread_count || 0,
        lastMessageAt: thread.last_message_at,
        preview: thread.last_message_preview || ''
      };
    });

    renderThreads();
    renderAccounts();
  }

  /* ---------------------------------------------------------------------- */
  /*  Embedded Signup                                                       */
  /* ---------------------------------------------------------------------- */
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
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

    if (data.data && typeof data.data === 'object') {
      state.embeddedSignup = {
        phoneNumberId: data.data.phone_number_id || null,
        wabaId: data.data.waba_id || null,
        businessId: data.data.business_id || null
      };
    }

    if (data.event === 'CANCEL') {
      const status = $('connectStatus');
      if (status) status.textContent = 'Signup cancelled.';
    } else if (data.event === 'ERROR') {
      toast('Meta Embedded Signup reported an error.', true);
    } else if (data.event === 'FINISH') {
      const status = $('connectStatus');
      if (status) status.textContent = 'Number selected. Finishing the connection…';
    }
  });

  function openEmbeddedSignup() {
    const status = $('connectStatus');

    if (!state.workspaceId) {
      toast('Workspace is still loading. Try again in a moment.', true);
      return;
    }
    if (!window.FB) {
      if (status) status.textContent = 'WhatsApp signup is still loading. Try again in a moment.';
      toast('WhatsApp signup is still loading. Try again in a second.', true);
      return;
    }

    if (status) status.textContent = 'Opening WhatsApp Embedded Signup…';

    state.embeddedSignup = null;

    window.FB.login(
      function (response) {
        if (!response.authResponse || !response.authResponse.code) {
          if (status) status.textContent = 'Signup cancelled or not authorised.';
          return;
        }

        if (status) status.textContent = 'Connecting the account securely…';

        const selection = state.embeddedSignup || {};

        callFunction('wa-connect', {
          code: response.authResponse.code,
          workspaceId: state.workspaceId,
          wabaId: selection.wabaId || undefined,
          phoneNumberId: selection.phoneNumberId || undefined,
          label: session.business || state.workspaceName || 'WhatsApp Business'
        })
          .then(async function (data) {
            await loadAccounts();
            if (data.accounts && data.accounts.length) {
              state.activeAccountId = data.accounts[0].id;
              await loadAccountData();
            }
            await loadActivity();
            renderAll();
            if (status) status.textContent = 'WhatsApp connected successfully.';
            toast('WhatsApp connected. You can send a message now.');
            syncTemplates(true);
          })
          .catch(function (error) {
            if (status) status.textContent = 'Could not complete the connection.';
            toast('Connection failed: ' + error.message, true);
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
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json().catch(function () {
          return {};
        });
      })
      .then(function () {
        $('connWebhook').textContent = 'Online · 200 OK';
        $('connWebhook').style.color = 'var(--olive)';
        if (!silent) toast('Verification webhook online.');
      })
      .catch(function () {
        $('connWebhook').textContent = 'Unavailable';
        $('connWebhook').style.color = 'var(--rust)';
        if (!silent) toast('Health check failed.', true);
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
      auth.logout();
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
    $('syncTemplatesBtn').addEventListener('click', function () {
      syncTemplates(false);
    });
    $('addAccount').addEventListener('click', function () {
      switchView('settings');
      openEmbeddedSignup();
    });

    $('btnOpenSite').addEventListener('click', function () {
      window.location.href = '../';
    });

    $('disconnectBtn').addEventListener('click', async function () {
      const account = activeAccount();
      if (!account) return;
      if (!window.confirm('Disconnect ' + accountName(account) + '? The stored access token will be removed and sending will stop.')) {
        return;
      }
      try {
        await rows(client.rpc('disconnect_wa_account', { p_account_id: account.id }));
        await loadAccounts();
        await loadActivity();
        renderAll();
        toast('Account disconnected.');
      } catch (error) {
        toast('Could not disconnect: ' + error.message, true);
      }
    });

    $('saveProfileBtn').addEventListener('click', async function () {
      const button = $('saveProfileBtn');
      button.disabled = true;
      try {
        const updated = await auth.updateProfile({
          name: $('profileName').value,
          business: $('profileBusiness').value
        });
        if (updated) {
          session.name = updated.name;
          session.business = updated.business;
          if (updated.business && updated.business !== state.workspaceName) {
            await rows(
              client
                .from('workspaces')
                .update({ name: updated.business })
                .eq('id', state.workspaceId)
            );
            state.workspaceName = updated.business;
          }
          renderHeader();
          renderSettings();
          toast('Profile saved.');
        }
      } catch (error) {
        toast(error.message || 'Could not save the profile.', true);
      } finally {
        button.disabled = false;
      }
    });

    $('healthBtn').addEventListener('click', function () {
      checkHealth(false);
    });

    $('clearLogBtn').addEventListener('click', async function () {
      await loadActivity();
      renderLog();
      toast('Activity log refreshed.');
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Init                                                                  */
  /* ---------------------------------------------------------------------- */
  bind();

  try {
    await loadWorkspace();
    renderAll();
    checkHealth(true);

    if (new URLSearchParams(window.location.search).get('welcome')) {
      toast('Workspace ready. Connect WhatsApp from Settings.');
      switchView('settings');
    }

    /* Keep the inbox fresh while the tab is open. */
    window.setInterval(function () {
      if (document.hidden || !state.activeAccountId) return;
      loadThreadsOnly().catch(function () {});
    }, 30000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.activeAccountId) {
        loadThreadsOnly().catch(function () {});
      }
    });
  } catch (error) {
    state.loadError = error.message;
    renderAll();
    toast('Could not load the workspace: ' + error.message, true);
  }
})();
