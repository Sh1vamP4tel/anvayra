/* ==========================================================================
   Anvayra — main.js
   Mobile nav, FAQ accordion, scroll reveal, contact form (Supabase lead intake)
   ========================================================================== */

const SITE = {
  // Public lead intake (Supabase Edge Function — no secrets in the browser)
  leadWebhookUrl: 'https://nbxsebcrcussmmxismsa.supabase.co/functions/v1/wa-lead',
  fallbackEmail: 'shivamkushwahsironj@gmail.com'
};

/* ---------- Mobile menu ---------- */
const burger = document.getElementById('burger');
const mobileMenu = document.getElementById('mobileMenu');

if (burger && mobileMenu) {
  burger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });

  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) {
      mobileMenu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ---------- FAQ accordion ---------- */
document.querySelectorAll('.faq-item').forEach((item) => {
  const button = item.querySelector('.faq-q');
  const panel = item.querySelector('.faq-a');
  if (!button || !panel) return;

  button.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');

    document.querySelectorAll('.faq-item.open').forEach((other) => {
      other.classList.remove('open');
      const otherButton = other.querySelector('.faq-q');
      const otherPanel = other.querySelector('.faq-a');
      if (otherButton) otherButton.setAttribute('aria-expanded', 'false');
      if (otherPanel) otherPanel.style.maxHeight = null;
    });

    if (!isOpen) {
      item.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      panel.style.maxHeight = panel.scrollHeight + 'px';
    }
  });
});

/* ---------- Scroll reveal ---------- */
const revealItems = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && revealItems.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  revealItems.forEach((el) => observer.observe(el));
} else {
  revealItems.forEach((el) => el.classList.add('in'));
}

/* ---------- Contact form ---------- */
const form = document.getElementById('leadForm');
if (form) {
  const status = document.getElementById('formStatus');
  const submitBtn = document.getElementById('submitBtn');

  const showStatus = (message) => {
    if (!status) return;
    status.textContent = message;
    status.classList.add('show');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const value = (id) => {
      const field = document.getElementById(id);
      return field ? String(field.value || '').trim() : '';
    };

    const name = value('name');
    const email = value('email');
    const phone = value('phone');
    const business = value('business');
    const service = value('service');
    const message = value('message');
    const consentField = document.getElementById('consent');
    const consent = Boolean(consentField && consentField.checked);

    if (!name || !email || !phone) {
      showStatus('Please add your name, email and WhatsApp number.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus('Please enter a valid email address.');
      return;
    }
    if (!consent) {
      showStatus('Please tick the WhatsApp consent box so we can reply to you.');
      return;
    }

    const payload = {
      name,
      business,
      email,
      phone,
      service,
      message,
      consent: true,
      consentText: 'I agree to be contacted on WhatsApp about my enquiry.',
      consentAt: new Date().toISOString(),
      source: 'meta-app-verification-site',
      page: window.location.pathname
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    }
    showStatus('Sending your enquiry…');

    try {
      const response = await fetch(SITE.leadWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('HTTP ' + response.status);

      window.location.href = './thank-you/?name=' + encodeURIComponent(name);
    } catch (error) {
      console.error('Lead submit failed:', error);
      showStatus(
        'We could not submit the form automatically. Please email ' +
          SITE.fallbackEmail +
          ' or message us on WhatsApp — your details were not lost.'
      );
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Try again <span class="arr">→</span>';
      }
    }
  });
}

/* ---------- Home dashboard preview: tabs + live log typing ---------- */
const preview = document.getElementById('homePreview');

if (preview) {
  const previewTabs = Array.from(preview.querySelectorAll('.mock-tab'));
  const previewPanels = Array.from(preview.querySelectorAll('.mock-panel'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let typingToken = 0;
  let previewStarted = false;
  const logSource = new WeakMap();

  preview.querySelectorAll('[data-typing]').forEach((log) => {
    logSource.set(
      log,
      Array.from(log.children).map((line) => ({
        html: line.innerHTML,
        text: line.textContent.replace(/\s+/g, ' ').trim(),
        className: line.className
      }))
    );
  });

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function typeLog(log) {
    if (!log || reduceMotion) return;

    const token = ++typingToken;
    const lines = logSource.get(log) || [];
    if (!lines.length) return;
    log.innerHTML = '';

    for (const line of lines) {
      if (token !== typingToken) return;

      const row = document.createElement('div');
      if (line.className) row.className = line.className;
      row.classList.add('typing-cursor');
      log.appendChild(row);

      for (let index = 1; index <= line.text.length; index += 1) {
        if (token !== typingToken) return;
        row.textContent = line.text.slice(0, index);
        await sleep(line.text.length > 42 ? 9 : 14);
      }

      row.classList.remove('typing-cursor');
      row.innerHTML = line.html;
      await sleep(220);
    }
  }

  function activatePanel(view) {
    previewTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
    previewPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === view));

    const activeLog = preview.querySelector('.mock-panel.active [data-typing]');
    if (activeLog) typeLog(activeLog);
  }

  previewTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      previewStarted = true;
      activatePanel(tab.dataset.view);
    });
  });

  function startPreview() {
    if (previewStarted) return;
    previewStarted = true;
    const activeLog = preview.querySelector('.mock-panel.active [data-typing]');
    if (activeLog) typeLog(activeLog);
  }

  if ('IntersectionObserver' in window) {
    const previewObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          startPreview();
          previewObserver.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    previewObserver.observe(preview);
  } else {
    startPreview();
  }
}

/* ---------- Footer year ---------- */
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = new Date().getFullYear();
});
