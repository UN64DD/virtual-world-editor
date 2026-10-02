export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') {
      node.value = v;
      node.setAttribute('value', v);
    }
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function replace(node, children) {
  clear(node);
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

let toastRoot = null;
export function toast(message, kind = '', ms = 3200) {
  toastRoot = toastRoot || document.getElementById('toasts');
  if (!toastRoot) return () => {};
  const node = el('div', { class: `toast ${kind}`.trim(), text: message });
  toastRoot.append(node);
  const timer = setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  }, ms);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    node.remove();
  });
  return () => {
    clearTimeout(timer);
    node.remove();
  };
}

let modalState = null;

export function openModal({ title, body, actions = [], width, onClose }) {
  const root = document.getElementById('modal-root');
  const bodyNode = document.getElementById('modal-body');
  const footer = document.getElementById('modal-footer');
  if (!root) return { close() {} };
  document.getElementById('modal-title').textContent = title || '';
  if (width) root.querySelector('.modal').style.width = width;
  else root.querySelector('.modal').style.width = '';
  replace(bodyNode, [].concat(body || []));
  replace(
    footer,
    actions.map((a) =>
      el('button', {
        class: `btn ${a.kind || ''}`.trim(),
        text: a.label,
        onclick: () => {
          if (a.onClick?.(api) === false) return;
          if (a.close !== false) api.close();
        },
      })
    )
  );
  root.classList.remove('hidden');
  modalState = { onClose };
  const first = footer.querySelector('.btn.primary') || footer.querySelector('.btn');
  if (first) first.focus();
  return api;
}

export const api = {
  close() {
    const root = document.getElementById('modal-root');
    if (!root || root.classList.contains('hidden')) return;
    root.classList.add('hidden');
    const cb = modalState?.onClose;
    modalState = null;
    cb?.();
  },
  isOpen() {
    const root = document.getElementById('modal-root');
    return !!root && !root.classList.contains('hidden');
  },
};

export function field(label, control) {
  return el('div', { class: 'field' }, [el('span', { text: label }), control]);
}

export function input(value, onInput, opts = {}) {
  return el('input', {
    type: opts.type || 'text',
    value: value === null || value === undefined ? '' : value,
    step: opts.step,
    min: opts.min,
    max: opts.max,
    title: opts.title,
    oninput: (e) => onInput(e.target.value, e),
  });
}

export function checkbox(checked, onChange) {
  return el('input', {
    type: 'checkbox',
    checked: !!checked,
    onchange: (e) => onChange(e.target.checked),
  });
}

export function select(value, options, onChange) {
  return el(
    'select',
    {
      onchange: (e) => onChange(e.target.value),
    },
    options.map((o) => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return el('option', { value: val, text: label, selected: String(val) === String(value) });
    })
  );
}

export function confirmDialog(message, { title = 'Confirm', confirmLabel = 'Delete' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openModal({
      title,
      body: el('p', { text: message, style: { margin: '0' } }),
      actions: [
        { label: 'Cancel', onClick: () => done(false) },
        { label: confirmLabel, kind: 'primary', onClick: () => done(true) },
      ],
      onClose: () => done(false),
    });
  });
}
