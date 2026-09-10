/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export function wireRailOverflow(header, actions) {
  const buttons = [...actions.children];
  if (buttons.length < 2) {
    return;
  }

  const overflowButton = document.createElement('button');
  overflowButton.type = 'button';
  overflowButton.className = 's2-btn rail-overflow-trigger';
  overflowButton.textContent = '…';
  overflowButton.title = 'More actions';
  overflowButton.setAttribute('aria-label', 'More actions');
  overflowButton.setAttribute('aria-haspopup', 'menu');
  overflowButton.setAttribute('aria-expanded', 'false');
  overflowButton.hidden = true;

  const menu = document.createElement('div');
  menu.className = 'rail-overflow-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  actions.append(overflowButton);
  header.append(menu);

  function closeMenu() {
    menu.hidden = true;
    overflowButton.setAttribute('aria-expanded', 'false');
  }

  overflowButton.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    overflowButton.setAttribute('aria-expanded', String(!menu.hidden));
  });

  buttons.forEach((button) => {
    button.addEventListener('click', closeMenu);
  });

  function updateOverflow() {
    buttons.forEach((button) => actions.insertBefore(button, overflowButton));
    menu.replaceChildren();
    overflowButton.hidden = true;
    closeMenu();

    const availableWidth = header.clientWidth - actions.offsetLeft - 8;
    while (
      actions.scrollWidth > availableWidth
      && buttons.some((button) => button.parentElement === actions)
    ) {
      const button = [...buttons].reverse()
        .find((candidate) => candidate.parentElement === actions);
      menu.prepend(button);
      overflowButton.hidden = false;
    }
  }

  const observer = new ResizeObserver(updateOverflow);
  observer.observe(header);
  updateOverflow();
}
