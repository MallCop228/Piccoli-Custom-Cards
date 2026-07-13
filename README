# Room Module Card

A modular Home Assistant dashboard card, built Bubble-Card-style: one
lightweight container plus a palette of block types you add, remove,
and reorder freely — any number of each, in any order, entirely from
the visual editor.

## Block types

- **Climate** — thermostat with +/- stepper
- **Light** — toggle + brightness slider (animates open when dimmable
  lights turn on), with an optional shared "All Lights" master control
  across every light block in the card
- **Fan** — toggle + speed presets, spinning icon reflects live speed
- **Media** — now-playing artwork, title/artist, volume, mute,
  transport controls, and speaker grouping (auto-hidden for TVs)
- **Tank** — temperature readout, optional light/filter toggles,
  axolotl or community-fish visual variants, filter-linked bubble
  animation and light-linked brightness

## Installation (HACS)

1. HACS → ⋮ menu → Custom repositories → add this repo URL,
   category **Dashboard**
2. Install "Room Module Card" from HACS
3. Add the resource if HACS doesn't do it automatically:
   Settings → Dashboards → Resources →
   `/hacsfiles/room-module-card/room-module-card.js` (JavaScript Module)
4. Add a card to any dashboard, search **"Room Module Card"**

## Manual installation

1. Copy `room-module-card.js` to `/config/www/`
2. Settings → Dashboards → Resources → Add Resource:
   URL `/local/room-module-card.js`, Type **JavaScript Module**
3. Add a card, search **"Room Module Card"**

## Configuration

Everything is buildable from the GUI editor — add blocks from the
palette, reorder with ▲▼, remove with ✕. Example YAML for reference:

```yaml
type: custom:room-module-card
name: Son's Room
icon: mdi:bunk-bed
presence_entity: binary_sensor.son_room_presence
temperature_entity: sensor.son_room_temperature
humidity_entity: sensor.son_room_humidity
show_all_lights: true
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
```

## Changelog

- **v1.0.0** — Initial modular release: block palette, real
  `ha-entity-picker` fields, dimming with animated expand, spinning
  fan icon, media artwork + auto speaker/TV grouping detection, tank
  light/filter toggles with creature variants.
