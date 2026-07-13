/* ============================================================
   room-module-card.js
   Version: 1.1.0

   A modular room dashboard card, built Bubble-Card-style: one
   lightweight container ("room-module-card") plus a palette of
   block types (climate / light / fan / media / tank) that you
   add, remove, and reorder freely — any number of each, in any
   order, entirely from the GUI editor.

   INSTALL:
     1. Copy this file to /config/www/room-module-card.js
     2. Settings -> Dashboards -> Resources -> Add Resource
          URL: /local/room-module-card.js   Type: JavaScript Module
     3. Add a card, search "Room Module Card", and build it
        entirely in the visual editor — no YAML required
        (though YAML works too, see CONFIG SHAPE below).

   CONFIG SHAPE:
     type: custom:room-module-card
     name: Son's Room
     icon: mdi:bunk-bed
     presence_entity: binary_sensor.son_room_presence
     temperature_entity: sensor.son_room_temperature
     humidity_entity: sensor.son_room_humidity
     blocks:
       - type: climate
         entity: climate.son_room_thermostat
       - type: light
         lights:
           - entity: light.son_room_main
             name: Main Lights
             sub:
               - entity: light.son_room_lamp
                 name: Lamp
       - type: fan
         entity: fan.son_room_ceiling
       - type: media
         sources:
           - name: Apple TV
             entity: media_player.son_room_appletv
             icon: mdi:apple
       - type: tank
         label: Concrete
         temperature_entity: sensor.concrete_tank_temp
         variant: axolotl
         light_entity: light.son_room_tank_light
         filter_entity: switch.son_room_tank_filter

   Blocks render in array order. Consecutive blocks of the same
   type share one section label; add a different type in between
   to start a new label. Add as many blocks of any type as you
   want — e.g. two separate "light" blocks for "Overhead" and
   "Lamps" if you want them grouped/dimmed independently, or one
   "light" block with multiple entries if you want them under a
   single "All Lights" master control.
============================================================ */

const BLOCK_LABELS = { climate: 'Climate', light: 'Lights', fan: 'Fan', media: 'Media', tank: 'Fish Tank', custom_card: 'Custom Card' };
const BLOCK_TYPES = ['climate', 'light', 'fan', 'media', 'tank', 'custom_card'];

function defaultBlock(type) {
  switch (type) {
    case 'climate': return { type: 'climate', entity: '' };
    case 'light': return { type: 'light', lights: [{ entity: '', name: 'New Light' }] };
    case 'fan': return { type: 'fan', entity: '' };
    case 'media': return { type: 'media', sources: [{ entity: '', name: 'New Source' }] };
    case 'tank': return { type: 'tank', label: '', temperature_entity: '', variant: 'axolotl' };
    case 'custom_card': return { type: 'custom_card', card_config: { type: 'custom:mediocre-media-player-card', entity: '' } };
    default: return { type };
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function attr(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
}

function mediaIconHtml(source) {
  const explicit = (source.icon || '').trim();
  if (explicit) {
    if (explicit.startsWith('mdi:')) return `<ha-icon icon="${attr(explicit)}"></ha-icon>`;
    return escapeHtml(explicit); // custom emoji/text override
  }
  const n = (source.name || '').toLowerCase();
  let mdi = 'mdi:television';
  if (n.includes('apple')) mdi = 'mdi:apple';
  else if (n.includes('android') || n.includes('google')) mdi = 'mdi:android';
  else if (n.includes('sonos') || n.includes('speaker')) mdi = 'mdi:speaker-wireless';
  else if (n.includes('tv')) mdi = 'mdi:television';
  return `<ha-icon icon="${mdi}"></ha-icon>`;
}

/* ============================================================
   LIVE CARD
============================================================ */
class RoomModuleCard extends HTMLElement {

  setConfig(config) {
    if (!config) throw new Error('room-module-card: config required');
    this._config = config;
    this._activeSourceIdx = {}; // keyed by block index
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
      this._built = true;
    }
    this._updateDynamic();
  }

  getCardSize() { return 6; }

  static getConfigElement() {
    return document.createElement('room-module-card-editor');
  }

  static getStubConfig() {
    return {
      name: 'New Room',
      icon: 'mdi:door',
      blocks: [defaultBlock('light')]
    };
  }

  // ---------- helpers ----------
  _state(entity_id) {
    if (!entity_id || !this._hass || !this._hass.states[entity_id]) return undefined;
    return this._hass.states[entity_id];
  }
  _call(domain, service, data) {
    this._hass.callService(domain, service, data);
  }
  _toggleEntity(entityId) {
    if (!entityId) return;
    const domain = entityId.split('.')[0];
    this._call(domain, 'toggle', { entity_id: entityId });
  }

  // ---------- shell ----------
  _build() {
    const cfg = this._config;
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="popup">
        <div class="header">
          <div class="room-title">
            <div class="eyebrow" id="presencePill"><span class="dot"></span><span id="presenceLabel">—</span></div>
            <h1>${escapeHtml(cfg.name || 'Room')}</h1>
          </div>
          <div class="climate-readout" ${cfg.temperature_entity ? '' : 'style="display:none"'}>
            <div><span class="temp" id="tempVal">--</span><span class="unit">°F</span></div>
            <div class="humidity" id="humVal"></div>
          </div>
        </div>
        <div id="sections"></div>
      </div>
    `;
    const sections = root.getElementById('sections');
    const blocks = cfg.blocks || [];

    // Pre-scan every "light" block so multiple light blocks can share one
    // "All Lights" master control, regardless of how they're split up.
    const allLightEntities = [];
    blocks.forEach(b => {
      if (b.type === 'light' && b.lights) {
        b.lights.forEach(l => {
          if (l.entity) allLightEntities.push(l.entity);
          (l.sub || []).forEach(s => { if (s.entity) allLightEntities.push(s.entity); });
        });
      }
    });
    this._allLightEntities = allLightEntities;
    this._mediaSourcesByBlock = {};

    let lastType = null;
    let masterInserted = false;

    blocks.forEach((block, idx) => {
      if (block.type !== lastType) {
        sections.appendChild(this._label(BLOCK_LABELS[block.type] || block.type));
        lastType = block.type;
      }
      if (block.type === 'light' && !masterInserted && allLightEntities.length > 1 && cfg.show_all_lights !== false) {
        sections.appendChild(this._buildAllLightsRow(allLightEntities));
        masterInserted = true;
      }
      const el = this._buildBlock(block, idx);
      if (el) sections.appendChild(el);
    });
  }

  _label(text) {
    const d = document.createElement('div');
    d.className = 'section-label';
    d.textContent = text;
    return d;
  }

  _buildBlock(block, idx) {
    switch (block.type) {
      case 'climate': return this._buildClimate(block, idx);
      case 'light': return this._buildLightBlock(block, idx);
      case 'fan': return this._buildFan(block, idx);
      case 'media': return this._buildMedia(block, idx);
      case 'tank': return this._buildTank(block, idx);
      case 'custom_card': return this._buildCustomCard(block, idx);
      default: return null;
    }
  }

  // ---------- Custom Card (embed any other Lovelace card, e.g. Mediocre Media Player Card) ----------
  _buildCustomCard(block, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'custom-card-wrap';
    wrap.id = `customCardWrap-${idx}`;
    if (!this._nestedCards) this._nestedCards = {};

    if (!block.card_config || !block.card_config.type) {
      wrap.innerHTML = `<div class="custom-card-empty">Custom card not configured yet — set it up in the editor.</div>`;
      return wrap;
    }

    this._mountCustomCard(wrap, block, idx);
    return wrap;
  }

  async _mountCustomCard(wrap, block, idx) {
    try {
      if (!this._cardHelpers) {
        if (typeof window.loadCardHelpers === 'function') {
          this._cardHelpers = await window.loadCardHelpers();
        }
      }
      let cardEl;
      if (this._cardHelpers) {
        cardEl = this._cardHelpers.createCardElement(block.card_config);
      } else {
        // Fallback: instantiate directly by tag name if card helpers aren't available
        const tag = block.card_config.type.replace(/^custom:/, '');
        cardEl = document.createElement(tag);
        if (cardEl.setConfig) cardEl.setConfig(block.card_config);
      }
      cardEl.hass = this._hass;
      this._nestedCards[idx] = cardEl;
      wrap.innerHTML = '';
      wrap.appendChild(cardEl);
    } catch (err) {
      wrap.innerHTML = `<div class="custom-card-empty">Couldn't load card: ${escapeHtml(block.card_config.type)}. Check it's installed as a resource.</div>`;
    }
  }

  // ---------- Climate ----------
  _buildClimate(block, idx) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="card climate-card">
        <div class="icon-badge">❄</div>
        <div class="card-main">
          <div class="name">Thermostat</div>
          <div class="state" id="climateState-${idx}">—</div>
        </div>
        <div class="stepper">
          <button id="climateDown-${idx}">–</button>
          <span class="target" id="climateTarget-${idx}">--°</span>
          <button id="climateUp-${idx}">+</button>
        </div>
      </div>
    `;
    setTimeout(() => {
      this.shadowRoot.getElementById(`climateDown-${idx}`).onclick = () => this._nudgeClimate(block.entity, -1);
      this.shadowRoot.getElementById(`climateUp-${idx}`).onclick = () => this._nudgeClimate(block.entity, 1);
    });
    return wrap;
  }

  _nudgeClimate(entity, delta) {
    const st = this._state(entity);
    if (!st) return;
    const current = parseFloat(st.attributes.temperature);
    const next = (isNaN(current) ? 70 : current) + delta;
    this._call('climate', 'set_temperature', { entity_id: entity, temperature: next });
  }

  // ---------- Lights (master row) ----------
  _buildAllLightsRow(allEntities) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="card light-card all-lights-card">
        <div class="light-card-top">
          <div class="icon-badge">💡</div>
          <div class="card-main">
            <div class="name">All Lights</div>
            <div class="state" id="allLightsState">—</div>
          </div>
          <div class="switch" id="allLightsSwitch"><div class="knob"></div></div>
        </div>
        <div class="light-dim-wrap" id="allLightsDimWrap">
          <div class="light-dim-inner">
            <div class="light-dim-content">
              <input type="range" min="1" max="100" value="100" class="dim-slider" id="allLightsDim">
            </div>
          </div>
        </div>
      </div>
    `;
    setTimeout(() => {
      this.shadowRoot.getElementById('allLightsSwitch').onclick = () => {
        const anyOn = allEntities.some(e => { const st = this._state(e); return st && st.state === 'on'; });
        this._call('light', anyOn ? 'turn_off' : 'turn_on', { entity_id: allEntities });
      };
      const slider = this.shadowRoot.getElementById('allLightsDim');
      slider.addEventListener('change', () => {
        this._call('light', 'turn_on', { entity_id: allEntities, brightness_pct: parseInt(slider.value, 10) });
      });
    });
    return wrap;
  }

  // ---------- Lights (block) ----------
  _buildLightBlock(block, idx) {
    const wrap = document.createElement('div');
    const lights = block.lights || [];
    lights.forEach((light, i) => {
      const row = document.createElement('div');
      row.className = 'card light-card';
      row.innerHTML = `
        <div class="light-card-top">
          <div class="icon-badge">💡</div>
          <div class="card-main">
            <div class="name">${escapeHtml(light.name || light.entity)}</div>
            <div class="state" id="lightState-${idx}-${i}">—</div>
          </div>
          <div class="switch" id="lightSwitch-${idx}-${i}"><div class="knob"></div></div>
        </div>
        <div class="light-dim-wrap" id="dimWrap-${idx}-${i}">
          <div class="light-dim-inner">
            <div class="light-dim-content">
              <input type="range" min="1" max="100" value="100" class="dim-slider" id="lightDim-${idx}-${i}">
            </div>
          </div>
        </div>
      `;
      wrap.appendChild(row);

      if (light.sub && light.sub.length) {
        const chipRow = document.createElement('div');
        chipRow.className = 'sub-chip-row';
        light.sub.forEach(sub => {
          const chip = document.createElement('div');
          chip.className = 'sub-chip';
          chip.innerHTML = `<span class="mini-dot"></span>${escapeHtml(sub.name || sub.entity)}`;
          chip.onclick = () => this._call('light', 'toggle', { entity_id: sub.entity });
          chipRow.appendChild(chip);
        });
        wrap.appendChild(chipRow);
      }

      setTimeout(() => {
        this.shadowRoot.getElementById(`lightSwitch-${idx}-${i}`).onclick = () =>
          this._call('light', 'toggle', { entity_id: light.entity });
        const slider = this.shadowRoot.getElementById(`lightDim-${idx}-${i}`);
        slider.addEventListener('change', () => {
          this._call('light', 'turn_on', { entity_id: light.entity, brightness_pct: parseInt(slider.value, 10) });
        });
      });
    });
    return wrap;
  }

  // ---------- Fan ----------
  _buildFan(block, idx) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="card fan-card">
        <div class="icon-badge">
          <svg class="fan-icon" id="fanIcon-${idx}" viewBox="0 0 24 24" width="22" height="22">
            <g fill="currentColor">
              <ellipse cx="12" cy="7" rx="2.6" ry="5" />
              <ellipse cx="12" cy="7" rx="2.6" ry="5" transform="rotate(120 12 12)" />
              <ellipse cx="12" cy="7" rx="2.6" ry="5" transform="rotate(240 12 12)" />
            </g>
          </svg>
        </div>
        <div class="card-main">
          <div class="name">Fan</div>
          <div class="state" id="fanState-${idx}">—</div>
        </div>
        <div class="speed-pills">
          <div class="speed-pill" data-pct="33" data-blockidx="${idx}">Lo</div>
          <div class="speed-pill" data-pct="66" data-blockidx="${idx}">Med</div>
          <div class="speed-pill" data-pct="100" data-blockidx="${idx}">Hi</div>
        </div>
      </div>
    `;
    setTimeout(() => {
      this.shadowRoot.querySelectorAll(`.speed-pill[data-blockidx="${idx}"]`).forEach(pill => {
        pill.onclick = () => this._call('fan', 'set_percentage', {
          entity_id: block.entity, percentage: parseInt(pill.dataset.pct, 10)
        });
      });
    });
    return wrap;
  }

  // ---------- Media ----------
  _buildMedia(block, idx) {
    const wrap = document.createElement('div');
    const sources = block.sources || [];
    this._mediaSourcesByBlock[idx] = sources;
    if (this._activeSourceIdx[idx] === undefined) this._activeSourceIdx[idx] = 0;

    const chips = sources.map((s, i) =>
      `<div class="source-chip ${i === 0 ? 'active' : ''}" data-idx="${i}" data-blockidx="${idx}"><span class="chip-icon">${mediaIconHtml(s)}</span>${escapeHtml(s.name)}</div>`
    ).join('');
    const showChips = sources.length > 1;

    wrap.innerHTML = `
      <div class="card media-card">
        <div class="media-now-playing">
          <div class="media-art" id="mediaArt-${idx}">
            <div class="media-art-fallback" id="mediaArtFallback-${idx}">${sources[0] ? mediaIconHtml(sources[0]) : ''}</div>
          </div>
          <div class="media-now-info">
            <div class="media-source-name" id="mediaSourceName-${idx}">${sources[0] ? escapeHtml(sources[0].name) : ''}</div>
            <div class="media-title" id="mediaTitle-${idx}">Nothing playing</div>
            <div class="media-subtitle" id="mediaSubtitle-${idx}"></div>
          </div>
          <button class="mute-btn" id="mediaMute-${idx}" title="Mute">🔊</button>
        </div>
        <div class="volume-row">
          <span class="vol-icon">🔈</span>
          <input type="range" min="0" max="100" value="50" class="dim-slider vol-slider" id="mediaVolume-${idx}">
        </div>
        ${showChips ? `<div class="source-pick">${chips}</div>` : ''}
        <div class="transport">
          <button id="mediaPrev-${idx}">⏮</button>
          <button class="play" id="mediaPlay-${idx}">▶</button>
          <button id="mediaNext-${idx}">⏭</button>
        </div>
        <div class="group-row" id="groupRow-${idx}" style="display:none">
          <div class="group-label">Group with</div>
          <div class="group-chips">
            ${sources.map((s, i) => `<div class="group-chip" data-idx="${i}" data-blockidx="${idx}" data-entity="${attr(s.entity)}">${escapeHtml(s.name)}</div>`).join('')}
          </div>
        </div>
      </div>
    `;

    if (!this._groupedEntitiesByBlock) this._groupedEntitiesByBlock = {};
    this._groupedEntitiesByBlock[idx] = new Set();

    setTimeout(() => {
      this.shadowRoot.querySelectorAll(`.source-chip[data-blockidx="${idx}"]`).forEach(chip => {
        chip.onclick = () => {
          this._activeSourceIdx[idx] = parseInt(chip.dataset.idx, 10);
          this.shadowRoot.querySelectorAll(`.source-chip[data-blockidx="${idx}"]`).forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          const src = this._mediaSourcesByBlock[idx][this._activeSourceIdx[idx]];
          this.shadowRoot.getElementById(`mediaSourceName-${idx}`).textContent = src.name;
          this.shadowRoot.getElementById(`mediaArtFallback-${idx}`).innerHTML = mediaIconHtml(src);
          this._updateDynamic();
        };
      });
      this.shadowRoot.getElementById(`mediaPlay-${idx}`).onclick = () =>
        this._call('media_player', 'media_play_pause', { entity_id: this._currentMediaEntity(idx) });
      this.shadowRoot.getElementById(`mediaPrev-${idx}`).onclick = () =>
        this._call('media_player', 'media_previous_track', { entity_id: this._currentMediaEntity(idx) });
      this.shadowRoot.getElementById(`mediaNext-${idx}`).onclick = () =>
        this._call('media_player', 'media_next_track', { entity_id: this._currentMediaEntity(idx) });
      this.shadowRoot.getElementById(`mediaMute-${idx}`).onclick = () => {
        const st = this._state(this._currentMediaEntity(idx));
        const muted = !!(st && st.attributes.is_volume_muted);
        this._call('media_player', 'volume_mute', { entity_id: this._currentMediaEntity(idx), is_volume_muted: !muted });
      };
      const volSlider = this.shadowRoot.getElementById(`mediaVolume-${idx}`);
      volSlider.addEventListener('change', () => {
        this._call('media_player', 'volume_set', { entity_id: this._currentMediaEntity(idx), volume_level: parseInt(volSlider.value, 10) / 100 });
      });
      this.shadowRoot.querySelectorAll(`.group-chip[data-blockidx="${idx}"]`).forEach(chip => {
        chip.onclick = () => {
          const entity = chip.dataset.entity;
          const current = this._currentMediaEntity(idx);
          if (entity === current) return;
          chip.classList.toggle('active');
          const grouped = this._groupedEntitiesByBlock[idx];
          if (chip.classList.contains('active')) grouped.add(entity);
          else grouped.delete(entity);
          if (grouped.size > 0) {
            this._call('media_player', 'join', { entity_id: current, group_members: Array.from(grouped) });
          } else {
            this._call('media_player', 'unjoin', { entity_id: entity });
          }
        };
      });
    });
    return wrap;
  }

  _currentMediaEntity(idx) {
    const sources = this._mediaSourcesByBlock[idx];
    return sources[this._activeSourceIdx[idx]].entity;
  }

  // Auto-detect whether a media_player is a groupable speaker (vs. a TV/display).
  // device_class is the most reliable signal when the integration sets it;
  // presence of a group_members attribute (even empty) is the fallback signal
  // used by most cast/Sonos-style speaker integrations. A per-source
  // "Group control" override in the editor beats both if set.
  _isGroupableSpeaker(source, state) {
    if (source && source.group_mode === 'show') return true;
    if (source && source.group_mode === 'hide') return false;
    if (!state) return false;
    const dc = state.attributes.device_class;
    if (dc === 'tv') return false;
    if (dc === 'speaker' || dc === 'receiver') return true;
    return Array.isArray(state.attributes.group_members);
  }

  // ---------- Tank ----------
  _buildTank(block, idx) {
    const wrap = document.createElement('div');
    if (!this._tankVariantByBlock) this._tankVariantByBlock = {};
    this._tankVariantByBlock[idx] = block.variant === 'community' ? 'community' : 'axolotl';

    const controlsHtml = `
      ${block.light_entity ? `<button class="tank-ctrl-btn" id="tankLightBtn-${idx}" title="Tank light">💡</button>` : ''}
      ${block.filter_entity ? `<button class="tank-ctrl-btn" id="tankFilterBtn-${idx}" title="Filter">💧</button>` : ''}
      <button class="tank-ctrl-btn" id="tankVariantBtn-${idx}" title="Switch tank design">🔄</button>
    `;

    wrap.innerHTML = `
      <div class="card tank-card">
        <div class="tank-badge">${escapeHtml((block.label || 'TANK').toUpperCase())}</div>
        <div class="tank-visual tank-dark" id="tankVisual-${idx}">
          <div class="tank-creature" id="tankCreature-${idx}"></div>
        </div>
        <div class="tank-info">
          <div>
            <div class="name">${escapeHtml(block.label || 'Fish Tank')}</div>
            <div class="sub" id="tankSub-${idx}">—</div>
          </div>
          <div class="tank-temp" id="tankTemp-${idx}">--°F</div>
        </div>
        <div class="tank-controls">${controlsHtml}</div>
      </div>
    `;

    setTimeout(() => {
      this._renderCreature(idx);
      this._spawnBubbles(idx);
      const lightBtn = this.shadowRoot.getElementById(`tankLightBtn-${idx}`);
      if (lightBtn) lightBtn.onclick = () => this._toggleEntity(block.light_entity);
      const filterBtn = this.shadowRoot.getElementById(`tankFilterBtn-${idx}`);
      if (filterBtn) filterBtn.onclick = () => this._toggleEntity(block.filter_entity);
      const variantBtn = this.shadowRoot.getElementById(`tankVariantBtn-${idx}`);
      if (variantBtn) variantBtn.onclick = () => {
        this._tankVariantByBlock[idx] = this._tankVariantByBlock[idx] === 'axolotl' ? 'community' : 'axolotl';
        this._renderCreature(idx);
      };
    });
    return wrap;
  }

  _renderCreature(idx) {
    const el = this.shadowRoot.getElementById(`tankCreature-${idx}`);
    if (!el) return;
    const variant = this._tankVariantByBlock[idx];
    if (variant === 'axolotl') {
      el.className = 'tank-creature axolotl';
      el.innerHTML = `
        <svg viewBox="0 0 100 50" class="creature-svg axolotl-svg">
          <path d="M70 26 Q92 18 94 28 Q92 38 70 30 Z" fill="#f2a6c6"/>
          <ellipse cx="48" cy="26" rx="24" ry="13" fill="#f2a6c6"/>
          <circle cx="28" cy="22" r="2.6" fill="#3a2530"/>
          <g stroke="#f2a6c6" stroke-width="3" fill="none" stroke-linecap="round">
            <path d="M26 12 Q19 3 24 -1"/>
            <path d="M31 10 Q27 1 32 -3"/>
            <path d="M36 11 Q34 2 40 0"/>
          </g>
        </svg>
      `;
    } else {
      el.className = 'tank-creature community';
      el.innerHTML = `
        <svg viewBox="0 0 40 20" class="creature-svg fish-svg fish-1"><path d="M2 8 Q14 0 22 8 L17 10 L22 12 Q14 20 2 12 Z" fill="#7fd9d1"/></svg>
        <svg viewBox="0 0 40 20" class="creature-svg fish-svg fish-2"><path d="M2 8 Q14 0 22 8 L17 10 L22 12 Q14 20 2 12 Z" fill="#f0b35e"/></svg>
        <svg viewBox="0 0 40 20" class="creature-svg fish-svg fish-3"><path d="M2 8 Q14 0 22 8 L17 10 L22 12 Q14 20 2 12 Z" fill="#8ea9f2"/></svg>
      `;
    }
  }

  _spawnBubbles(idx) {
    const el = this.shadowRoot.getElementById(`tankVisual-${idx}`);
    if (!el || el.dataset.seeded) return;
    el.dataset.seeded = '1';
    for (let i = 0; i < 14; i++) {
      const b = document.createElement('div');
      b.className = 'bubble';
      const left = 8 + Math.random() * 84;
      const size = 3 + Math.random() * 5;
      const dur = 3 + Math.random() * 3.5;
      const delay = Math.random() * 5;
      b.style.left = left + '%';
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.animationDuration = dur + 's';
      b.style.animationDelay = delay + 's';
      el.appendChild(b);
    }
  }

  // ---------- dynamic state refresh (called on every hass update) ----------
  _updateDynamic() {
    const cfg = this._config;
    const root = this.shadowRoot;
    if (!root || !this._hass) return;
    const blocks = cfg.blocks || [];

    // Presence
    if (cfg.presence_entity) {
      const st = this._state(cfg.presence_entity);
      const on = st && st.state === 'on';
      root.getElementById('presencePill').querySelector('.dot').style.background = on ? 'var(--accent-presence)' : 'var(--text-low)';
      root.getElementById('presenceLabel').textContent = on ? 'Occupied' : 'Empty';
    } else {
      const label = root.getElementById('presenceLabel');
      if (label) label.textContent = '';
    }

    // Temp / humidity
    if (cfg.temperature_entity) {
      const st = this._state(cfg.temperature_entity);
      const el = root.getElementById('tempVal');
      if (el) el.textContent = st ? Math.round(parseFloat(st.state)) : '--';
    }
    if (cfg.humidity_entity) {
      const st = this._state(cfg.humidity_entity);
      const el = root.getElementById('humVal');
      if (el) el.textContent = st ? `${Math.round(parseFloat(st.state))}% RH` : '';
    }

    blocks.forEach((block, idx) => {
      if (block.type === 'climate') this._updateClimate(block, idx);
      else if (block.type === 'light') this._updateLightBlock(block, idx);
      else if (block.type === 'fan') this._updateFan(block, idx);
      else if (block.type === 'media') this._updateMedia(block, idx);
      else if (block.type === 'tank') this._updateTank(block, idx);
      else if (block.type === 'custom_card') this._updateCustomCard(block, idx);
    });

    // All-lights master row (aggregate across every light block)
    if (this._allLightEntities && this._allLightEntities.length > 1) {
      const states = this._allLightEntities.map(e => this._state(e)).filter(Boolean);
      const anyOn = states.some(s => s.state === 'on');
      const sw = root.getElementById('allLightsSwitch');
      const stateEl = root.getElementById('allLightsState');
      const dimWrap = root.getElementById('allLightsDimWrap');
      if (sw) sw.classList.toggle('on', anyOn);
      if (stateEl) {
        const onCount = states.filter(s => s.state === 'on').length;
        stateEl.textContent = anyOn ? `${onCount}/${states.length} on` : 'All off';
      }
      if (dimWrap) dimWrap.classList.toggle('expanded', anyOn);
    }
  }

  _updateClimate(block, idx) {
    const root = this.shadowRoot;
    const st = this._state(block.entity);
    if (!st) return;
    const target = root.getElementById(`climateTarget-${idx}`);
    const state = root.getElementById(`climateState-${idx}`);
    if (target) target.textContent = `${Math.round(st.attributes.temperature || 0)}°`;
    if (state) state.textContent = st.state.charAt(0).toUpperCase() + st.state.slice(1);
  }

  _updateLightBlock(block, idx) {
    const root = this.shadowRoot;
    (block.lights || []).forEach((light, i) => {
      const st = this._state(light.entity);
      const on = st && st.state === 'on';
      const sw = root.getElementById(`lightSwitch-${idx}-${i}`);
      const stateEl = root.getElementById(`lightState-${idx}-${i}`);
      const dimWrap = root.getElementById(`dimWrap-${idx}-${i}`);
      const dimSlider = root.getElementById(`lightDim-${idx}-${i}`);
      const dimmable = !!(st && st.attributes && st.attributes.supported_color_modes &&
        st.attributes.supported_color_modes.some(m => m !== 'onoff'));
      if (sw) sw.classList.toggle('on', !!on);
      if (dimWrap) dimWrap.classList.toggle('expanded', !!(dimmable && on));
      if (dimSlider && st && st.attributes.brightness && root.activeElement !== dimSlider) {
        dimSlider.value = Math.round((st.attributes.brightness / 255) * 100);
      }
      if (stateEl) {
        const bri = st && st.attributes && st.attributes.brightness
          ? ` · ${Math.round((st.attributes.brightness / 255) * 100)}%`
          : '';
        stateEl.textContent = st ? `${on ? 'On' : 'Off'}${on ? bri : ''}` : '—';
      }
    });
  }

  _updateFan(block, idx) {
    const root = this.shadowRoot;
    const st = this._state(block.entity);
    const stateEl = root.getElementById(`fanState-${idx}`);
    if (stateEl) stateEl.textContent = st ? (st.state === 'on' ? `On${st.attributes.percentage ? ' · ' + st.attributes.percentage + '%' : ''}` : 'Off') : '—';
    root.querySelectorAll(`.speed-pill[data-blockidx="${idx}"]`).forEach(pill => {
      const pct = parseInt(pill.dataset.pct, 10);
      const current = st ? st.attributes.percentage : null;
      pill.classList.toggle('active', current !== null && Math.abs(current - pct) < 20);
    });
    const icon = root.getElementById(`fanIcon-${idx}`);
    if (icon) {
      icon.classList.remove('spin-low', 'spin-med', 'spin-high');
      if (st && st.state === 'on') {
        const pct = st.attributes.percentage || 50;
        if (pct <= 40) icon.classList.add('spin-low');
        else if (pct <= 75) icon.classList.add('spin-med');
        else icon.classList.add('spin-high');
      }
    }
  }

  _updateMedia(block, idx) {
    const root = this.shadowRoot;
    const sources = this._mediaSourcesByBlock[idx];
    if (!sources || !sources.length) return;
    const activeSource = sources[this._activeSourceIdx[idx]];
    const ent = this._currentMediaEntity(idx);
    const st = this._state(ent);
    const titleEl = root.getElementById(`mediaTitle-${idx}`);
    const subtitleEl = root.getElementById(`mediaSubtitle-${idx}`);
    const playBtn = root.getElementById(`mediaPlay-${idx}`);
    const muteBtn = root.getElementById(`mediaMute-${idx}`);
    const volSlider = root.getElementById(`mediaVolume-${idx}`);
    const artEl = root.getElementById(`mediaArt-${idx}`);
    const artFallback = root.getElementById(`mediaArtFallback-${idx}`);
    const groupRow = root.getElementById(`groupRow-${idx}`);

    if (titleEl) {
      titleEl.textContent = st
        ? (st.attributes.media_title || (st.state === 'idle' || st.state === 'off' ? 'Nothing playing' : capitalize(st.state)))
        : 'Unavailable';
    }
    if (subtitleEl) {
      const bits = [];
      if (st && st.attributes.media_artist) bits.push(st.attributes.media_artist);
      else if (st && st.attributes.media_series_title) bits.push(st.attributes.media_series_title);
      else if (st && st.attributes.app_name) bits.push(st.attributes.app_name);
      if (st && st.state && st.attributes.media_title) bits.push(capitalize(st.state));
      subtitleEl.textContent = bits.join(' · ');
    }
    if (playBtn) playBtn.textContent = st && st.state === 'playing' ? '⏸' : '▶';
    if (muteBtn) muteBtn.textContent = st && st.attributes.is_volume_muted ? '🔇' : '🔊';
    if (volSlider && st && typeof st.attributes.volume_level === 'number' && root.activeElement !== volSlider) {
      volSlider.value = Math.round(st.attributes.volume_level * 100);
    }

    // Artwork: show entity_picture when available, otherwise fall back to the icon
    if (artEl) {
      const picture = st && st.attributes.entity_picture;
      if (picture) {
        const url = this._hass && this._hass.hassUrl ? this._hass.hassUrl(picture) : picture;
        artEl.style.backgroundImage = `url("${url}")`;
        artEl.classList.add('has-art');
        if (artFallback) artFallback.style.display = 'none';
      } else {
        artEl.style.backgroundImage = '';
        artEl.classList.remove('has-art');
        if (artFallback) artFallback.style.display = '';
      }
    }

    // Grouping only makes sense for speakers, not TVs — auto-detected from
    // device_class / group_members, or overridden per source in the editor.
    if (groupRow) {
      const showGroup = sources.length > 1 && this._isGroupableSpeaker(activeSource, st);
      groupRow.style.display = showGroup ? '' : 'none';
    }
    root.querySelectorAll(`.group-chip[data-blockidx="${idx}"]`).forEach(chip => {
      const entity = chip.dataset.entity;
      const isGrouped = !!(st && st.attributes.group_members && st.attributes.group_members.includes(entity));
      chip.classList.toggle('active', isGrouped && entity !== ent);
    });
  }

  _updateTank(block, idx) {
    const root = this.shadowRoot;
    const st = this._state(block.temperature_entity);
    const tempEl = root.getElementById(`tankTemp-${idx}`);
    if (tempEl) tempEl.textContent = st ? `${parseFloat(st.state).toFixed(1)}°F` : '--°F';

    let lit = false;
    if (block.light_entity) {
      const lst = this._state(block.light_entity);
      lit = !!(lst && lst.state === 'on');
    }
    const visual = root.getElementById(`tankVisual-${idx}`);
    if (visual) {
      visual.classList.toggle('tank-lit', lit);
      visual.classList.toggle('tank-dark', !lit);
    }
    const lightBtn = root.getElementById(`tankLightBtn-${idx}`);
    if (lightBtn) lightBtn.classList.toggle('active', lit);

    let filterOn = true;
    if (block.filter_entity) {
      const fst = this._state(block.filter_entity);
      filterOn = !!(fst && fst.state === 'on');
    }
    const filterBtn = root.getElementById(`tankFilterBtn-${idx}`);
    if (filterBtn) filterBtn.classList.toggle('active', filterOn);
    root.querySelectorAll(`#tankVisual-${idx} .bubble`).forEach(b => {
      b.style.display = filterOn ? '' : 'none';
    });

    const sub = root.getElementById(`tankSub-${idx}`);
    if (sub) {
      const parts = [];
      if (block.filter_entity) parts.push(filterOn ? 'Filter running' : 'Filter off');
      if (block.light_entity) parts.push(lit ? 'Light on' : 'Light off');
      sub.textContent = parts.length ? parts.join(' · ') : 'Ambient';
    }
  }

  _updateCustomCard(block, idx) {
    const cardEl = this._nestedCards && this._nestedCards[idx];
    if (cardEl) cardEl.hass = this._hass;
  }
}

const STYLE = `
:host{
  --bg-surface: rgba(255,255,255,0.055);
  --surface-border: rgba(255,255,255,0.09);
  --surface-hover: rgba(255,255,255,0.09);
  --text-hi: #eef1f0;
  --text-mid: #9aa5a3;
  --text-low: #5c6664;
  --accent-climate: #5ec8c0;
  --accent-light: #f0b35e;
  --accent-fan: #8ea9f2;
  --accent-media: #d98fd6;
  --accent-tank: #7fd9d1;
  --accent-presence: #7fd98a;
  font-family:'Inter', sans-serif;
  color:var(--text-hi);
  display:block;
}
.popup{
  width:100%;
  background:linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
  border:1px solid var(--surface-border);
  border-radius:28px;
  padding:22px;
  backdrop-filter:blur(20px);
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06);
  box-sizing:border-box;
}
.header{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 18px;}
.room-title{display:flex;flex-direction:column;gap:3px;}
.eyebrow{font-family:'JetBrains Mono', monospace, monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-presence);display:flex;align-items:center;gap:6px;}
.dot{width:6px;height:6px;border-radius:50%;display:inline-block;background:var(--accent-presence);}
h1{font-family:'Space Grotesk', sans-serif, sans-serif;font-size:22px;font-weight:600;margin:0;letter-spacing:-.01em;}
.climate-readout{display:flex;flex-direction:column;align-items:flex-end;font-family:'Space Grotesk', sans-serif;}
.climate-readout .temp{font-size:26px;font-weight:600;}
.climate-readout .unit{font-size:13px;color:var(--text-mid);margin-left:1px;}
.climate-readout .humidity{font-size:11px;color:var(--text-low);font-family:'Inter', sans-serif;}
.section-label{font-family:'JetBrains Mono', monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-low);margin:18px 4px 8px;}
.card{display:flex;align-items:center;gap:14px;background:var(--bg-surface);border:1px solid var(--surface-border);border-radius:18px;padding:14px 16px;margin-bottom:10px;transition:background .2s;}
.card:hover{background:var(--surface-hover);}
.icon-badge{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:19px;}
.icon-badge ha-icon{--mdc-icon-size:20px;}
.source-chip .chip-icon{display:inline-flex;align-items:center;margin-right:2px;}
.source-chip ha-icon{--mdc-icon-size:14px;}
.card-main{flex:1;min-width:0;}
.card-main .name{font-size:14px;font-weight:500;}
.card-main .state{font-size:12px;color:var(--text-mid);margin-top:1px;}
.climate-card .icon-badge{background:rgba(94,200,192,.16);color:var(--accent-climate);}
.climate-card .target{font-family:'Space Grotesk', sans-serif;font-size:18px;font-weight:600;color:var(--accent-climate);}
.stepper{display:flex;align-items:center;gap:10px;}
.stepper button{width:28px;height:28px;border-radius:50%;border:1px solid var(--surface-border);background:rgba(255,255,255,0.04);color:var(--text-hi);font-size:15px;cursor:pointer;}
.switch{width:42px;height:24px;border-radius:20px;background:rgba(255,255,255,0.08);position:relative;flex-shrink:0;cursor:pointer;}
.switch.on{background:var(--accent-light);}
.switch .knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);}
.switch.on .knob{left:21px;}
.light-card{flex-direction:column;align-items:stretch;padding:0;}
.light-card-top{display:flex;align-items:center;gap:14px;padding:14px 16px;}
.light-card .icon-badge{background:rgba(240,179,94,.16);color:var(--accent-light);}
.all-lights-card .icon-badge{background:rgba(240,179,94,.28);}
.light-dim-wrap{display:grid;grid-template-rows:0fr;transition:grid-template-rows .35s ease;}
.light-dim-wrap.expanded{grid-template-rows:1fr;}
.light-dim-inner{overflow:hidden;}
.light-dim-content{padding:0 16px 16px;}
.dim-slider{width:100%;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);outline:none;}
.dim-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent-light);cursor:pointer;border:2px solid rgba(0,0,0,.3);}
.dim-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--accent-light);cursor:pointer;border:2px solid rgba(0,0,0,.3);border:none;}
.sub-chip-row{display:flex;gap:8px;margin:-2px 0 10px;padding-left:54px;flex-wrap:wrap;}
.sub-chip{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.04);border:1px solid var(--surface-border);border-radius:12px;padding:6px 10px;font-size:11.5px;color:var(--text-mid);cursor:pointer;}
.sub-chip .mini-dot{width:6px;height:6px;border-radius:50%;background:var(--accent-light);}
.fan-card .icon-badge{background:rgba(142,169,242,.16);color:var(--accent-fan);}
.fan-icon{transform-origin:12px 12px;}
.fan-icon.spin-low{animation:fanspin 3.2s linear infinite;}
.fan-icon.spin-med{animation:fanspin 1.6s linear infinite;}
.fan-icon.spin-high{animation:fanspin 0.7s linear infinite;}
@keyframes fanspin{to{transform:rotate(360deg);}}
.speed-pills{display:flex;gap:6px;}
.speed-pill{padding:6px 10px;border-radius:10px;font-size:11px;font-family:'JetBrains Mono', monospace;border:1px solid var(--surface-border);color:var(--text-mid);cursor:pointer;}
.speed-pill.active{background:rgba(142,169,242,.18);border-color:rgba(142,169,242,.4);color:var(--accent-fan);}
.media-card{flex-direction:column;align-items:stretch;padding:16px;}
.media-now-playing{display:flex;align-items:center;gap:14px;}
.media-art{
  width:52px;height:52px;border-radius:12px;flex-shrink:0;
  background-color:rgba(217,143,214,.16);
  background-size:cover;background-position:center;
  display:flex;align-items:center;justify-content:center;
  color:var(--accent-media);
  transition:background-image .3s ease;
}
.media-art ha-icon{--mdc-icon-size:24px;}
.media-art.has-art .media-art-fallback{display:none;}
.media-now-info{flex:1;min-width:0;}
.media-source-name{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-low);margin-bottom:2px;}
.media-title{font-size:14px;font-weight:500;color:var(--text-hi);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.media-subtitle{font-size:12px;color:var(--text-mid);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.mute-btn{background:none;border:none;font-size:17px;cursor:pointer;flex-shrink:0;color:var(--text-mid);padding:6px;}
.volume-row{display:flex;align-items:center;gap:8px;padding:12px 0 12px;}
.volume-row .vol-icon{font-size:13px;color:var(--text-mid);flex-shrink:0;}
.vol-slider{flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);outline:none;}
.vol-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent-media);cursor:pointer;border:2px solid rgba(0,0,0,.3);}
.vol-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--accent-media);cursor:pointer;border:none;}
.source-pick{display:flex;gap:6px;margin-top:2px;flex-wrap:wrap;}
.source-chip{display:flex;align-items:center;gap:5px;font-size:11px;padding:6px 11px;border-radius:20px;border:1px solid var(--surface-border);color:var(--text-mid);cursor:pointer;}
.source-chip.active{background:rgba(217,143,214,.16);border-color:rgba(217,143,214,.4);color:var(--accent-media);}
.transport{display:flex;gap:16px;justify-content:center;margin-top:14px;}
.transport button{background:none;border:none;color:var(--text-mid);font-size:17px;cursor:pointer;}
.transport button.play{width:38px;height:38px;border-radius:50%;background:rgba(217,143,214,.16);color:var(--accent-media);display:flex;align-items:center;justify-content:center;}
.group-row{margin-top:14px;padding-top:12px;border-top:1px solid var(--surface-border);}
.group-label{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-low);margin-bottom:8px;}
.group-chips{display:flex;gap:6px;flex-wrap:wrap;}
.group-chip{font-size:11px;padding:6px 11px;border-radius:20px;border:1px solid var(--surface-border);color:var(--text-mid);cursor:pointer;}
.group-chip.active{background:rgba(217,143,214,.16);border-color:rgba(217,143,214,.4);color:var(--accent-media);}
.tank-card{position:relative;flex-direction:column;align-items:stretch;padding:0;overflow:hidden;border-color:rgba(127,217,209,.25);}
.tank-visual{position:relative;height:120px;overflow:hidden;transition:background 1.2s ease;}
.tank-visual.tank-lit{background:linear-gradient(180deg, rgba(127,217,209,.30), rgba(30,45,48,.4));}
.tank-visual.tank-dark{background:linear-gradient(180deg, rgba(127,217,209,.08), rgba(10,14,16,.6));}
.tank-creature{position:absolute; inset:0;}
.axolotl-svg{position:absolute;width:78px;left:18%;top:32%;animation:bob 4.5s ease-in-out infinite;}
@keyframes bob{0%,100%{transform:translateY(0) rotate(0deg);}50%{transform:translateY(-6px) rotate(-3deg);}}
.fish-svg{position:absolute;width:34px;}
.fish-1{top:18%;animation:swim 7s linear infinite;}
.fish-2{top:48%;animation:swim 9s linear infinite reverse;}
.fish-3{top:72%;animation:swim 6s linear infinite;animation-delay:-3s;}
@keyframes swim{0%{left:-15%;}100%{left:110%;}}
.bubble{position:absolute;bottom:-10px;width:6px;height:6px;border-radius:50%;background:rgba(200,240,235,.5);animation:rise linear infinite;}
@keyframes rise{to{transform:translateY(-140px) translateX(6px);opacity:0;}}
.tank-info{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px;}
.tank-info .name{font-size:14px;font-weight:500;}
.tank-info .sub{font-size:11px;color:var(--text-mid);margin-top:2px;}
.tank-temp{font-family:'Space Grotesk', sans-serif;font-size:20px;font-weight:600;color:var(--accent-tank);}
.tank-badge{position:absolute;top:12px;right:14px;font-family:'JetBrains Mono', monospace;font-size:10px;background:rgba(0,0,0,.35);color:var(--accent-tank);padding:4px 8px;border-radius:10px;border:1px solid rgba(127,217,209,.3);}
.tank-controls{display:flex;gap:8px;padding:0 16px 14px;}
.tank-ctrl-btn{width:34px;height:34px;border-radius:10px;border:1px solid var(--surface-border);background:rgba(255,255,255,0.04);color:var(--text-mid);font-size:15px;cursor:pointer;}
.tank-ctrl-btn.active{background:rgba(127,217,209,.18);border-color:rgba(127,217,209,.4);color:var(--accent-tank);}
.custom-card-wrap{margin-bottom:10px;}
.custom-card-empty{
  background:var(--bg-surface);border:1px dashed var(--surface-border);border-radius:18px;
  padding:16px;font-size:12.5px;color:var(--text-mid);text-align:center;
}
`;

customElements.define('room-module-card', RoomModuleCard);

/* ============================================================
   EDITOR
   Same focus-safe rendering pattern as before (HA echoes config
   back into setConfig after every 'config-changed' event; we
   suppress the resulting re-render so typing doesn't lose focus
   or close the iPad keyboard). Entity fields use HA's own
   <ha-entity-picker> for real search. Blocks can be added from a
   palette, removed, and reordered with move up/down buttons.
============================================================ */
class RoomModuleCardEditor extends HTMLElement {

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    if (!this._config.blocks) this._config.blocks = [];
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

    if (this._suppressNextRender) {
      this._suppressNextRender = false;
      return;
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();
    else this._refreshPickerHass();
  }

  _emitChange() {
    this._suppressNextRender = true;
    clearTimeout(this._suppressTimer);
    this._suppressTimer = setTimeout(() => { this._suppressNextRender = false; }, 1000);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    }));
  }

  _setPath(path, value) {
    const parts = path.split('.');
    let obj = this._config;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const isIdx = /^\d+$/.test(parts[i + 1]);
      if (obj[key] === undefined) obj[key] = isIdx ? [] : {};
      obj = obj[key];
    }
    const last = parts[parts.length - 1];
    if (value === '' || value === undefined) delete obj[last];
    else obj[last] = value;
  }

  _createEntityPicker(currentValue, domain, onChange) {
    const picker = document.createElement('ha-entity-picker');
    picker.hass = this._hass;
    picker.value = currentValue || '';
    picker.allowCustomEntity = true;
    if (domain) picker.includeDomains = [domain];
    picker.style.display = 'block';
    picker.addEventListener('value-changed', (e) => {
      e.stopPropagation();
      onChange(e.detail.value || '');
    });
    return picker;
  }

  _refreshPickerHass() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(p => { p.hass = this._hass; });
  }

  _moveInArray(arr, idx, dir) {
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= arr.length) return false;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    return true;
  }

  // ---------- render ----------
  _render() {
    if (!this.shadowRoot) return;
    const c = this._config || {};
    const root = this.shadowRoot;
    this._rendered = true;

    const blocksHtml = (c.blocks || []).map((block, idx) => this._blockHtml(block, idx)).join('');

    root.innerHTML = `
      <style>${EDITOR_STYLE}</style>
      <div class="form">

        <div class="group">
          <div class="group-title">Basics</div>
          <label>Name
            <input id="f-name" type="text" value="${attr(c.name)}" placeholder="Son's Room">
          </label>
          <label>Icon (mdi)
            <input id="f-icon" type="text" value="${attr(c.icon)}" placeholder="mdi:bunk-bed">
          </label>
          <label class="toggle-inline">
            <input type="checkbox" id="f-show-all-lights" ${c.show_all_lights !== false ? 'checked' : ''}>
            Show "All Lights" master control (when 2+ lights)
          </label>
        </div>

        <div class="group">
          <div class="group-title">Sensors</div>
          <label>Presence sensor
            <div class="picker-slot" data-slot="presence"></div>
          </label>
          <label>Temperature sensor
            <div class="picker-slot" data-slot="temperature"></div>
          </label>
          <label>Humidity sensor
            <div class="picker-slot" data-slot="humidity"></div>
          </label>
        </div>

        <div id="blocks-list">${blocksHtml}</div>

        <div class="group palette-group">
          <div class="group-title">Add block</div>
          <div class="palette-row">
            ${BLOCK_TYPES.map(t => `<button class="palette-btn" data-addtype="${t}">+ ${BLOCK_LABELS[t]}</button>`).join('')}
          </div>
        </div>

      </div>
    `;

    this._mountPickers();
    this._mountYamlEditors();
    this._bindEvents();
  }

  _blockHeader(title, idx) {
    return `
      <div class="row-between">
        <div class="group-title">${escapeHtml(title)} <span class="block-index">#${idx + 1}</span></div>
        <div class="header-controls">
          <button class="move-btn" data-move-idx="${idx}" data-dir="up" title="Move block up">▲</button>
          <button class="move-btn" data-move-idx="${idx}" data-dir="down" title="Move block down">▼</button>
          <button class="remove-block-btn" data-remove-idx="${idx}" title="Remove block">✕</button>
        </div>
      </div>
    `;
  }

  _blockHtml(block, idx) {
    switch (block.type) {
      case 'climate': return this._climateBlockHtml(block, idx);
      case 'light': return this._lightBlockHtml(block, idx);
      case 'fan': return this._fanBlockHtml(block, idx);
      case 'media': return this._mediaBlockHtml(block, idx);
      case 'tank': return this._tankBlockHtml(block, idx);
      case 'custom_card': return this._customCardBlockHtml(block, idx);
      default: return '';
    }
  }

  _customCardBlockHtml(block, idx) {
    return `
      <div class="group block-group">
        ${this._blockHeader('Custom Card', idx)}
        <p class="hint-text">
          Embed any other installed Lovelace card here — e.g. install
          "Mediocre Media Player Card" via HACS first, then paste its
          config below the same way you would in a dashboard's YAML editor.
        </p>
        <label>Card configuration
          <div class="yaml-slot" data-slot="card-config-${idx}"></div>
        </label>
      </div>
    `;
  }

  _climateBlockHtml(block, idx) {
    return `
      <div class="group block-group">
        ${this._blockHeader('Climate', idx)}
        <label>Thermostat entity
          <div class="picker-slot" data-slot="block-entity-${idx}"></div>
        </label>
      </div>
    `;
  }

  _fanBlockHtml(block, idx) {
    return `
      <div class="group block-group">
        ${this._blockHeader('Fan', idx)}
        <label>Fan entity
          <div class="picker-slot" data-slot="block-entity-${idx}"></div>
        </label>
      </div>
    `;
  }

  _lightBlockHtml(block, idx) {
    const lights = block.lights || [];
    const items = lights.map((light, i) => `
      <div class="item-card">
        <div class="item-row">
          <input class="light-name" data-blockidx="${idx}" data-idx="${i}" type="text" value="${attr(light.name)}" placeholder="Main Lights" style="flex:1">
          <button class="item-move" data-arr="lights" data-blockidx="${idx}" data-idx="${i}" data-dir="up" title="Move up">▲</button>
          <button class="item-move" data-arr="lights" data-blockidx="${idx}" data-idx="${i}" data-dir="down" title="Move down">▼</button>
          <button class="remove-btn" data-remove="light" data-blockidx="${idx}" data-idx="${i}" title="Remove">✕</button>
        </div>
        <label class="tight-label">Entity
          <div class="picker-slot" data-slot="light-entity-${idx}-${i}"></div>
        </label>
        <div class="sub-lights">
          ${(light.sub || []).map((s, j) => `
            <div class="sub-row">
              <input class="sublight-name" data-blockidx="${idx}" data-idx="${i}" data-subidx="${j}" type="text" value="${attr(s.name)}" placeholder="Lamp" style="width:90px">
              <div class="picker-slot" style="flex:1" data-slot="sublight-entity-${idx}-${i}-${j}"></div>
              <button class="item-move" data-arr="sublights" data-blockidx="${idx}" data-idx="${i}" data-subidx="${j}" data-dir="up" title="Move up">▲</button>
              <button class="item-move" data-arr="sublights" data-blockidx="${idx}" data-idx="${i}" data-subidx="${j}" data-dir="down" title="Move down">▼</button>
              <button class="remove-btn" data-remove="sublight" data-blockidx="${idx}" data-idx="${i}" data-subidx="${j}">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="add-sub-btn" data-blockidx="${idx}" data-idx="${i}">+ Add sub-light</button>
      </div>
    `).join('');

    return `
      <div class="group block-group">
        ${this._blockHeader('Lights', idx)}
        <div class="lights-list">${items}</div>
        <button class="add-btn add-light-btn" data-blockidx="${idx}">+ Add light to this block</button>
      </div>
    `;
  }

  _mediaBlockHtml(block, idx) {
    const sources = block.sources || [];
    const items = sources.map((s, i) => `
      <div class="item-card">
        <div class="item-row">
          <input class="media-name" data-blockidx="${idx}" data-idx="${i}" type="text" value="${attr(s.name)}" placeholder="Apple TV" style="flex:1">
          <button class="item-move" data-arr="media" data-blockidx="${idx}" data-idx="${i}" data-dir="up" title="Move up">▲</button>
          <button class="item-move" data-arr="media" data-blockidx="${idx}" data-idx="${i}" data-dir="down" title="Move down">▼</button>
          <button class="remove-btn" data-remove="media" data-blockidx="${idx}" data-idx="${i}" title="Remove">✕</button>
        </div>
        <label class="tight-label">Entity
          <div class="picker-slot" data-slot="media-entity-${idx}-${i}"></div>
        </label>
        <label class="tight-label">Icon override (mdi:name, blank = auto-pick by name)
          <input class="media-icon" data-blockidx="${idx}" data-idx="${i}" type="text" value="${attr(s.icon)}" placeholder="mdi:apple">
        </label>
        <label class="tight-label">Group control (speaker grouping)
          <select class="media-group-mode" data-blockidx="${idx}" data-idx="${i}">
            <option value="auto" ${(!s.group_mode || s.group_mode === 'auto') ? 'selected' : ''}>Auto-detect from entity</option>
            <option value="show" ${s.group_mode === 'show' ? 'selected' : ''}>Always show</option>
            <option value="hide" ${s.group_mode === 'hide' ? 'selected' : ''}>Never show (e.g. TVs)</option>
          </select>
        </label>
      </div>
    `).join('');

    return `
      <div class="group block-group">
        ${this._blockHeader('Media', idx)}
        <div class="media-list">${items}</div>
        <button class="add-btn add-source-btn" data-blockidx="${idx}">+ Add source to this block</button>
      </div>
    `;
  }

  _tankBlockHtml(block, idx) {
    const variant = block.variant || 'axolotl';
    return `
      <div class="group block-group">
        ${this._blockHeader('Fish tank', idx)}
        <label>Label
          <input class="tank-label" data-blockidx="${idx}" type="text" value="${attr(block.label)}" placeholder="Concrete">
        </label>
        <label>Tank temperature sensor
          <div class="picker-slot" data-slot="tank-temp-${idx}"></div>
        </label>
        <label>Tank design
          <select class="tank-variant" data-blockidx="${idx}">
            <option value="axolotl" ${variant === 'axolotl' ? 'selected' : ''}>Axolotl</option>
            <option value="community" ${variant === 'community' ? 'selected' : ''}>Community fish</option>
          </select>
        </label>
        <label>Tank light (optional — leave blank to hide toggle)
          <div class="picker-slot" data-slot="tank-light-${idx}"></div>
        </label>
        <label>Filter / pump (optional — leave blank to hide toggle)
          <div class="picker-slot" data-slot="tank-filter-${idx}"></div>
        </label>
      </div>
    `;
  }

  // ---- mount ha-entity-picker elements ----
  _mountPickers() {
    const r = this.shadowRoot;
    const c = this._config;
    const mount = (slotName, domain, value, onChange) => {
      const slot = r.querySelector(`.picker-slot[data-slot="${slotName}"]`);
      if (!slot) return;
      slot.appendChild(this._createEntityPicker(value, domain, onChange));
    };

    mount('presence', 'binary_sensor', c.presence_entity, v => { this._setPath('presence_entity', v); this._emitChange(); });
    mount('temperature', 'sensor', c.temperature_entity, v => { this._setPath('temperature_entity', v); this._emitChange(); });
    mount('humidity', 'sensor', c.humidity_entity, v => { this._setPath('humidity_entity', v); this._emitChange(); });

    (c.blocks || []).forEach((block, idx) => {
      if (block.type === 'climate') {
        mount(`block-entity-${idx}`, 'climate', block.entity, v => { this._config.blocks[idx].entity = v; this._emitChange(); });
      } else if (block.type === 'fan') {
        mount(`block-entity-${idx}`, 'fan', block.entity, v => { this._config.blocks[idx].entity = v; this._emitChange(); });
      } else if (block.type === 'light') {
        (block.lights || []).forEach((light, i) => {
          mount(`light-entity-${idx}-${i}`, 'light', light.entity, v => { this._config.blocks[idx].lights[i].entity = v; this._emitChange(); });
          (light.sub || []).forEach((s, j) => {
            mount(`sublight-entity-${idx}-${i}-${j}`, 'light', s.entity, v => { this._config.blocks[idx].lights[i].sub[j].entity = v; this._emitChange(); });
          });
        });
      } else if (block.type === 'media') {
        (block.sources || []).forEach((s, i) => {
          mount(`media-entity-${idx}-${i}`, 'media_player', s.entity, v => { this._config.blocks[idx].sources[i].entity = v; this._emitChange(); });
        });
      } else if (block.type === 'tank') {
        mount(`tank-temp-${idx}`, 'sensor', block.temperature_entity, v => { this._config.blocks[idx].temperature_entity = v; this._emitChange(); });
        mount(`tank-light-${idx}`, 'light', block.light_entity, v => { this._config.blocks[idx].light_entity = v; this._emitChange(); });
        mount(`tank-filter-${idx}`, null, block.filter_entity, v => { this._config.blocks[idx].filter_entity = v; this._emitChange(); });
      }
    });
  }

  // ---- mount ha-yaml-editor (or JSON textarea fallback) for custom_card blocks ----
  _mountYamlEditors() {
    const r = this.shadowRoot;
    const c = this._config;
    (c.blocks || []).forEach((block, idx) => {
      if (block.type !== 'custom_card') return;
      const slot = r.querySelector(`.yaml-slot[data-slot="card-config-${idx}"]`);
      if (!slot) return;

      const onChange = (newConfig) => {
        this._config.blocks[idx].card_config = newConfig;
        this._emitChange();
      };

      if (customElements.get('ha-yaml-editor')) {
        const editor = document.createElement('ha-yaml-editor');
        editor.hass = this._hass;
        editor.defaultValue = block.card_config || {};
        editor.addEventListener('value-changed', (e) => {
          if (e.detail.isValid !== false) onChange(e.detail.value);
        });
        slot.appendChild(editor);
      } else {
        // Fallback: plain JSON textarea if ha-yaml-editor isn't available
        const textarea = document.createElement('textarea');
        textarea.className = 'json-fallback';
        textarea.rows = 6;
        textarea.value = JSON.stringify(block.card_config || {}, null, 2);
        textarea.addEventListener('change', () => {
          try {
            onChange(JSON.parse(textarea.value));
          } catch (err) {
            // leave config unchanged if it doesn't parse; user is still typing
          }
        });
        slot.appendChild(textarea);
        const note = document.createElement('div');
        note.className = 'hint-text';
        note.textContent = 'YAML editor unavailable in this HA version — paste JSON here instead (quotes required around keys).';
        slot.appendChild(note);
      }
    });
  }

  // ---- events ----
  _bindEvents() {
    const r = this.shadowRoot;
    const on = (id, evt, fn) => { const el = r.getElementById(id); if (el) el.addEventListener(evt, fn); };

    on('f-name', 'input', e => { this._setPath('name', e.target.value); this._emitChange(); });
    on('f-icon', 'input', e => { this._setPath('icon', e.target.value); this._emitChange(); });
    on('f-show-all-lights', 'change', e => { this._setPath('show_all_lights', e.target.checked); this._emitChange(); });

    // Add block from palette
    r.querySelectorAll('.palette-btn').forEach(btn => btn.addEventListener('click', () => {
      this._config.blocks.push(defaultBlock(btn.dataset.addtype));
      this._emitChange(); this._render();
    }));

    // Reorder / remove blocks
    r.querySelectorAll('.move-btn').forEach(btn => btn.addEventListener('click', () => {
      if (this._moveInArray(this._config.blocks, +btn.dataset.moveIdx, btn.dataset.dir)) { this._emitChange(); this._render(); }
    }));
    r.querySelectorAll('.remove-block-btn').forEach(btn => btn.addEventListener('click', () => {
      this._config.blocks.splice(+btn.dataset.removeIdx, 1); this._emitChange(); this._render();
    }));

    // Climate / Fan entity blocks are handled entirely by ha-entity-picker mounts above.

    // Lights
    r.querySelectorAll('.add-light-btn').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.blockidx;
      this._config.blocks[idx].lights = this._config.blocks[idx].lights || [];
      this._config.blocks[idx].lights.push({ entity: '', name: 'New Light' });
      this._emitChange(); this._render();
    }));
    r.querySelectorAll('.light-name').forEach(el => el.addEventListener('input', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      this._config.blocks[idx].lights[i].name = e.target.value; this._emitChange();
    }));
    r.querySelectorAll('[data-remove="light"]').forEach(el => el.addEventListener('click', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      this._config.blocks[idx].lights.splice(i, 1); this._emitChange(); this._render();
    }));
    r.querySelectorAll('.add-sub-btn').forEach(el => el.addEventListener('click', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      const light = this._config.blocks[idx].lights[i];
      light.sub = light.sub || [];
      light.sub.push({ entity: '', name: 'New Sub-light' });
      this._emitChange(); this._render();
    }));
    r.querySelectorAll('.sublight-name').forEach(el => el.addEventListener('input', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx, j = +e.target.dataset.subidx;
      this._config.blocks[idx].lights[i].sub[j].name = e.target.value; this._emitChange();
    }));
    r.querySelectorAll('[data-remove="sublight"]').forEach(el => el.addEventListener('click', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx, j = +e.target.dataset.subidx;
      this._config.blocks[idx].lights[i].sub.splice(j, 1); this._emitChange(); this._render();
    }));
    r.querySelectorAll('.item-move[data-arr="lights"]').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.blockidx;
      if (this._moveInArray(this._config.blocks[idx].lights, +btn.dataset.idx, btn.dataset.dir)) { this._emitChange(); this._render(); }
    }));
    r.querySelectorAll('.item-move[data-arr="sublights"]').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.blockidx, i = +btn.dataset.idx;
      if (this._moveInArray(this._config.blocks[idx].lights[i].sub, +btn.dataset.subidx, btn.dataset.dir)) { this._emitChange(); this._render(); }
    }));

    // Media
    r.querySelectorAll('.add-source-btn').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.blockidx;
      this._config.blocks[idx].sources = this._config.blocks[idx].sources || [];
      this._config.blocks[idx].sources.push({ entity: '', name: 'New Source' });
      this._emitChange(); this._render();
    }));
    r.querySelectorAll('.media-name').forEach(el => el.addEventListener('input', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      this._config.blocks[idx].sources[i].name = e.target.value; this._emitChange();
    }));
    r.querySelectorAll('.media-icon').forEach(el => el.addEventListener('input', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      this._config.blocks[idx].sources[i].icon = e.target.value; this._emitChange();
    }));
    r.querySelectorAll('.media-group-mode').forEach(el => el.addEventListener('change', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      this._config.blocks[idx].sources[i].group_mode = e.target.value; this._emitChange();
    }));
    r.querySelectorAll('[data-remove="media"]').forEach(el => el.addEventListener('click', e => {
      const idx = +e.target.dataset.blockidx, i = +e.target.dataset.idx;
      this._config.blocks[idx].sources.splice(i, 1); this._emitChange(); this._render();
    }));
    r.querySelectorAll('.item-move[data-arr="media"]').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.blockidx;
      if (this._moveInArray(this._config.blocks[idx].sources, +btn.dataset.idx, btn.dataset.dir)) { this._emitChange(); this._render(); }
    }));

    // Tank
    r.querySelectorAll('.tank-label').forEach(el => el.addEventListener('input', e => {
      this._config.blocks[+e.target.dataset.blockidx].label = e.target.value; this._emitChange();
    }));
    r.querySelectorAll('.tank-variant').forEach(el => el.addEventListener('change', e => {
      this._config.blocks[+e.target.dataset.blockidx].variant = e.target.value; this._emitChange();
    }));
  }
}

const EDITOR_STYLE = `
:host{ display:block; font-family: 'Inter', sans-serif; }
.form{ display:flex; flex-direction:column; gap:18px; padding:4px 2px 16px; }
.group{
  border:1px solid rgba(0,0,0,0.1);
  border-radius:12px;
  padding:12px 14px;
  background: rgba(0,0,0,0.02);
}
.block-group{ border-color: rgba(0,0,0,0.16); }
.group-title{
  font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
  color: var(--secondary-text-color, #6a6a6a);
  margin-bottom:8px;
}
.block-index{ opacity:0.55; font-weight:400; }
.row-between{ display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
.header-controls{ display:flex; align-items:center; gap:8px; }
.toggle-inline{ display:flex; align-items:center; gap:6px; font-size:13px; color: var(--secondary-text-color, #6a6a6a); }
label{ display:flex; flex-direction:column; gap:4px; font-size:12.5px; color: var(--secondary-text-color, #6a6a6a); margin-bottom:8px; }
label.tight-label{ margin-bottom:6px; }
input[type="text"], select{
  font-size:14px;
  padding:8px 10px;
  border-radius:8px;
  border:1px solid rgba(0,0,0,0.15);
  background: var(--card-background-color, #fff);
  color: var(--primary-text-color, #1a1a1a);
}
ha-entity-picker{ width:100%; }
ha-yaml-editor{ width:100%; display:block; }
.json-fallback{
  width:100%; font-family:monospace; font-size:12.5px;
  border-radius:8px; border:1px solid rgba(0,0,0,0.15); padding:8px 10px;
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #1a1a1a);
}
.hint-text{ font-size:12px; color: var(--secondary-text-color, #6a6a6a); margin:-2px 0 10px; line-height:1.5; }
.item-card{
  border:1px solid rgba(0,0,0,0.1);
  border-radius:10px;
  padding:10px;
  margin-bottom:10px;
  display:flex;
  flex-direction:column;
  gap:8px;
}
.item-row{ display:flex; gap:6px; align-items:center; }
.sub-lights{ display:flex; flex-direction:column; gap:6px; padding-left:12px; border-left:2px solid rgba(0,0,0,0.08); }
.sub-row{ display:flex; gap:6px; align-items:center; }
.move-btn, .item-move{
  border:1px solid rgba(0,0,0,0.12);
  background:rgba(0,0,0,0.03);
  color: var(--secondary-text-color, #6a6a6a);
  width:26px; height:26px; border-radius:8px; cursor:pointer; font-size:11px;
  flex-shrink:0;
}
.remove-btn, .remove-block-btn{
  border:none; background:rgba(200,60,60,0.1); color:#c83c3c;
  width:26px; height:26px; border-radius:8px; cursor:pointer; font-size:13px;
  flex-shrink:0;
}
.add-btn, .add-sub-btn{
  border:1px dashed rgba(0,0,0,0.2);
  background:none;
  color: var(--primary-color, #03a9f4);
  padding:8px 12px;
  border-radius:8px;
  font-size:13px;
  cursor:pointer;
  align-self:flex-start;
}
.palette-group{ background: rgba(3,169,244,0.04); border-style:dashed; }
.palette-row{ display:flex; gap:8px; flex-wrap:wrap; }
.palette-btn{
  border:1px solid rgba(3,169,244,0.3);
  background: rgba(3,169,244,0.08);
  color: var(--primary-color, #03a9f4);
  padding:10px 14px;
  border-radius:10px;
  font-size:13px;
  font-weight:500;
  cursor:pointer;
}
`;

customElements.define('room-module-card-editor', RoomModuleCardEditor);

// Register in the card picker (optional, cosmetic)
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'room-module-card',
  name: 'Room Module Card',
  description: 'Modular room dashboard: add climate, light, fan, media, and tank blocks in any order.'
});
