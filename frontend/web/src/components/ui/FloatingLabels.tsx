import { useEffect } from 'react';

type FloatingControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const nonTextInputTypes = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

function isFloatingControl(control: Element | null): control is FloatingControl {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement))
    return false;
  return !(control instanceof HTMLInputElement && nonTextInputTypes.has(control.type));
}

function getFloatingField(label: HTMLLabelElement): { control: FloatingControl; group: HTMLElement | null } | null {
  if (label.closest('[data-static-label]')) return null;
  const nestedControls = Array.from(label.querySelectorAll('input, select, textarea'));
  if (nestedControls.length === 1 && isFloatingControl(nestedControls[0]))
    return { control: nestedControls[0], group: null };
  if (nestedControls.length > 0 || !label.htmlFor) return null;

  const associatedControl = document.getElementById(label.htmlFor);
  const group = label.parentElement;
  if (!isFloatingControl(associatedControl) || !group) return null;
  const groupControls = Array.from(group.querySelectorAll('input, select, textarea'));
  if (groupControls.length !== 1 || groupControls[0] !== associatedControl) return null;
  return { control: associatedControl, group };
}

function getCaption(label: HTMLLabelElement, control: FloatingControl): string {
  const pieces: string[] = [];
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const relation = node.compareDocumentPosition(control);
    if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    if (!node.parentElement?.closest('[aria-hidden="true"]')) pieces.push(node.textContent ?? '');
    node = walker.nextNode();
  }

  return pieces.join(' ').replace(/\s+/g, ' ')
    .replace(/\s*\(\s*nếu\b[^)]*\)/giu, '')
    .replace(/[\s*＊]+$/u, '').trim()
    || control.getAttribute('aria-label')?.trim()
    || control.getAttribute('title')?.trim()
    || '';
}

function syncLabel(label: HTMLLabelElement): void {
  const field = getFloatingField(label);
  if (!field) return;
  const { control, group } = field;

  const caption = getCaption(label, control);
  if (!caption) return;

  label.classList.add('floating-field');
  // The caption drops the visual '*', so required fields get it back through CSS.
  label.classList.toggle('floating-field--required', control.required || Boolean(label.querySelector('.required-mark')));
  label.classList.toggle('floating-field--external', Boolean(group));
  label.dataset.floatingLabel = caption;
  label.classList.toggle('is-filled', Boolean(control.value));
  if (group) {
    group.classList.add('floating-field-group');
    group.classList.toggle('is-filled', Boolean(control.value));
    control.classList.add('floating-field__control');
  }

  const autoLabeled = control.dataset.floatingAriaLabel === 'true';
  if (autoLabeled || (!control.hasAttribute('aria-label') && !control.hasAttribute('aria-labelledby'))) {
    control.setAttribute('aria-label', caption);
    control.dataset.floatingAriaLabel = 'true';
  }

  const textWalker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode) {
    const relation = textNode.compareDocumentPosition(control);
    if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    let child = textNode.parentElement;
    while (child && child.parentElement !== label) child = child.parentElement;
    if (child && child !== control && !child.contains(control)) child.classList.add('floating-field__caption');
    textNode = textWalker.nextNode();
  }

  (group ?? label).querySelectorAll<HTMLElement>('small, [role="alert"], [class*="error"], [class*="hint"], [class*="message"]')
    .forEach((element) => element.classList.add('floating-field__support'));
}

export function FloatingLabels() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const syncAll = (scope: ParentNode = root) => scope.querySelectorAll<HTMLLabelElement>('label').forEach(syncLabel);
    const observer = new MutationObserver((records) => {
      const changedLabels = new Set<HTMLLabelElement>();
      for (const record of records) {
        const target = record.target;
        if (target instanceof Element) {
          const label = target.closest('label');
          if (label instanceof HTMLLabelElement) changedLabels.add(label);
        } else if (target.parentElement) {
          const label = target.parentElement.closest('label');
          if (label instanceof HTMLLabelElement) changedLabels.add(label);
        }

        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLLabelElement) changedLabels.add(node);
          node.querySelectorAll<HTMLLabelElement>('label').forEach((label) => changedLabels.add(label));
        });
      }
      changedLabels.forEach(syncLabel);
    });
    const syncFromControl = (event: Event) => {
      const target = event.target;
      if (target instanceof Element) {
        const label = target.closest('label')
          ?? target.closest('.floating-field-group')?.querySelector('label.floating-field--external');
        if (label instanceof HTMLLabelElement) syncLabel(label);
      }
    };
    const syncAfterButtonClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('button, [role="button"]')) return;
      const form = target.closest('form');
      if (form) window.requestAnimationFrame(() => syncAll(form));
    };
    const syncAfterReset = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement) window.requestAnimationFrame(() => syncAll(form));
    };

    syncAll();
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('input', syncFromControl, true);
    root.addEventListener('change', syncFromControl, true);
    root.addEventListener('click', syncAfterButtonClick, true);
    root.addEventListener('reset', syncAfterReset, true);

    return () => {
      observer.disconnect();
      root.removeEventListener('input', syncFromControl, true);
      root.removeEventListener('change', syncFromControl, true);
      root.removeEventListener('click', syncAfterButtonClick, true);
      root.removeEventListener('reset', syncAfterReset, true);
    };
  }, []);

  return null;
}
