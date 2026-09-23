/**
 * The detail card for whatever is selected in the Solar System: what it is,
 * its numbers, and one fact worth remembering. Docked to the side rather than
 * pinned to the body, so it never hides the thing it describes.
 */
export class BodyCard {
  constructor(parent) {
    this.el = document.createElement('aside');
    this.el.className = 'solar-card glass-card';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <button class="solar-card-close" type="button" aria-label="Close">✕</button>
      <h2 class="solar-card-title"></h2>
      <p class="solar-card-type"></p>
      <dl class="solar-card-rows"></dl>
      <p class="solar-card-fact"></p>
      <button class="control-btn small solar-card-follow" type="button"></button>
    `;
    this.title = this.el.querySelector('.solar-card-title');
    this.type = this.el.querySelector('.solar-card-type');
    this.rows = this.el.querySelector('.solar-card-rows');
    this.fact = this.el.querySelector('.solar-card-fact');
    this.followBtn = this.el.querySelector('.solar-card-follow');
    this.el.querySelector('.solar-card-close').addEventListener('click', () => this.onClose?.());
    this.followBtn.addEventListener('click', () => this.onFollow?.());
    parent.appendChild(this.el);
  }

  show(body, { following = false } = {}) {
    const { info } = body;
    this.title.textContent = body.name;
    this.type.textContent = info.type;
    this.rows.replaceChildren(...info.rows.map(([label, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }));
    this.fact.textContent = info.fact;
    this.followBtn.hidden = !body.followable;
    this.setFollowing(following);
    this.el.hidden = false;
  }

  setFollowing(following) {
    this.followBtn.textContent = following ? 'Stop following' : 'Follow';
  }

  hide() {
    this.el.hidden = true;
  }
}
