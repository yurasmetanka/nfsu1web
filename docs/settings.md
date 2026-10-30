# Settings and optional fonts

## Browser controls

Use the launcher's Options and Controls screens. Most settings apply on the
next game launch; keyboard aliases apply immediately. In-game Options still
control difficulty, transmission and camera.

| Setting | Behavior |
| --- | --- |
| Graphics quality | Game, Low, Medium, High or Maximum; Maximum is the default. Game uses the saved profile's choices. |
| Resolution | Automatic canvas device pixels, with an 8192-pixel dimension limit. Resize/fullscreen triggers a device reset. |
| Widescreen | On by default; turn it off in Options for the original 4:3 view. |
| Startup movies | Skippable by default; Original keeps the game's usual behavior, Off skips them automatically. |
| Movie playback | Turn in-game movie playback on or off. |
| Audio | Sound output and audio response. |
| When the game loses focus | Pause (default) freezes the game and sound when switching tabs or windows, then resumes on return. Keep running continues the game. The game’s network background-run flag can keep its network screens running with sound muted. Applies on the next launch. |
| Touch controls | Steering mode (Buttons, Thumb stick, Tilt), Level horizon (during Tilt steering) and Touch controls size (Small, Medium, Large) on mobile/touch devices. |
| Controller | Device policy, dead zones, trigger threshold and vibration permission. |

Open **Game data** to download or restore a ZIP backup of profiles and settings.
The game data cache is separate from these backups.

Graphics presets use NFSU1's own detail levels and capability limits; they do
not enable the upstream NFSU2 enhancement system. Their exact mapping is in
[`runtime/nfsu1_graphics.c`](../runtime/nfsu1_graphics.c).

Menus, loading screens, pause screens and results keep their original proportions
on one centered canvas. Recognized race HUD components and music banners anchor
as complete groups to the screen edges, including their text and backings.
Music banners retain their alignment through loading transitions. Pointer
mapping follows the centered canvas used by interactive screens.

**F9** opens the game overlay. **F10** temporarily disables custom driving
bindings. Remapping applies only to NFSU1's race action map. Menus, raw keyboard
capture and text entry receive the original physical keys and characters, so
WASD can drive without replacing the letters typed in chat.
Website controls target NFSU1's default driving bindings: handbrake uses Right
Shift, nitrous uses Space, shift up uses Insert, and shift down uses Delete.
Reset keyboard restores these same
NFSU1 keys in the website. Existing custom website remaps are preserved.
Use the game's default
keyboard bindings when using website remaps; custom in-game bindings can change
the resulting actions.
The game's **Options → Controller → Controller Setup** entry opens keyboard
configuration too; the original English menu calls the category “Controller”.
Aliases are stored separately from save backups in browser local storage.
On phones and tablets, on-screen touch controls automatically switch between
menu navigation (including a mobile text-entry keyboard button) and driving
controls (with Buttons, Thumb stick or Tilt steering, Gas-to-Nitro pedal slide
and gear shift buttons).

Saves use `save-nfsu1`, game-data caching uses `cache-nfsu1`. Keep the same
host and port to retain the same browser storage.

## HD fonts

The optional importer uses four DDS atlases from Raze's
[NFSU-HD FONTS](https://nfsmods.xyz/mod/6370), archive `13d395-MOD.7z`.
It replaces fonts used in menus and race text at 4× atlas resolution while
preserving text size. Other font atlases and gauge artwork remain stock.
No ASI, Binary or TexWizard executable is run.

Extract the archive locally, preserving its `Textures` folder:

```sh
python3 tools/prepare_hd_fonts.py --mod /path/to/extracted-hd-fonts
./start.sh --hd-fonts work/mods/hd-fonts --check
./start.sh --hd-fonts work/mods/hd-fonts
```

Preparation reads `work/data` and writes two replacement containers and a hash
manifest under `work/mods/hd-fonts`. It refuses a nonempty output directory;
use a fresh `--output` for another import. Original game files stay unchanged.
Rebuild an older Wasm module with the current tools before enabling fonts.

To use stock fonts, restart without `--hd-fonts`. Restart after replacing
assets, then reload the same browser address. Cache versions derive from
content hashes; deleting saves or clearing storage is unnecessary.

If menu or race text disappears, restart without `--hd-fonts`. Gauges remain
stock.

Focus-loss parking follows PC 1.4's own background polling flag, rather than
the upstream Winsock initialization count: NFSU1 initializes Winsock even in
single-player. The native synthetic check is
`python3 tools/lifecycle_runtime_smoke.py` after applying the runtime overlay;
it checks lifecycle policy, not rendered game behavior.
