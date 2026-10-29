export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'action-confirm-dialog';
    dialog.setAttribute('aria-labelledby', 'action-confirm-title');
    dialog.setAttribute('aria-describedby', 'action-confirm-message');

    const content = document.createElement('div');
    content.className = 'action-confirm-content';
    const icon = document.createElement('img');
    icon.className = 'action-confirm-logo';
    icon.src = '/reliva-logo.png';
    icon.alt = 'Reliva';
    const title = document.createElement('h2');
    title.id = 'action-confirm-title';
    title.textContent = 'Xác nhận thao tác';
    const description = document.createElement('p');
    description.id = 'action-confirm-message';
    description.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'action-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button secondary';
    cancel.textContent = 'Quay lại';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'button';
    confirm.textContent = 'Xác nhận';
    actions.append(cancel, confirm);
    content.append(icon, title, description, actions);
    dialog.append(content);
    document.body.append(dialog);
    let answered = false;
    const finish = (result: boolean) => {
      if (answered) return;
      answered = true;
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });
    dialog.showModal();
    cancel.focus();
  });
}
