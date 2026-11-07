/* Original NFSU1 graphics preset adapter for the selected PC 1.4 image.
 * Names, addresses and ranges were verified locally against the settings
 * descriptor table and preset/capability routines; see docs/settings.md.
 * No translated game instructions or original image bytes are included. */
#include "cpu.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const char *name;
    uint32_t address;
    uint32_t cap_address;
    uint32_t level[4];
} GraphicsSetting;

/* Low/medium/high/max correspond to the game's four detail levels, 0..3.
 * Resolution is deliberately independent of the detail preset. */
static const GraphicsSetting graphics_settings[] = {
    { "ENVMAP",          0x700e74u, 0x701040u, {0, 1, 2, 3} },
    { "WORLDENVMAP",     0x700e78u, 0x701044u, {0, 0, 1, 1} },
    { "SHADOW",          0x700e7cu, 0x701048u, {1, 1, 2, 2} },
    { "HEADLIGHTS",      0x700e80u, 0x70104cu, {0, 0, 1, 1} },
    { "CARLIGHTING",     0x700e84u, 0x701050u, {1, 0, 1, 1} },
    { "DAMAGE",          0x700e88u, 0x701054u, {0, 0, 1, 1} },
    { "CROWD",           0x700e8cu, 0x701058u, {0, 0, 1, 1} },
    { "ROADREFLECTION",  0x700e90u, 0x70105cu, {0, 1, 2, 2} },
    { "FOG",             0x700e94u, 0x701060u, {0, 0, 1, 1} },
    { "MOTIONBLUR",      0x700e98u, 0x701064u, {0, 0, 0, 1} },
    { "LIGHTSTREAKS",    0x700e9cu, 0x701068u, {0, 0, 0, 1} },
    { "LIGHTGLOW",       0x700ea0u, 0x70106cu, {1, 1, 1, 1} },
    { "ANIMATEDTEXTURE", 0x700ea4u, 0x701070u, {1, 1, 1, 1} },
    { "PARTICLESYSTEMS", 0x700ea8u, 0x701074u, {0, 1, 1, 1} },
    { "DEPTHOFFIELD",    0x700eacu, 0x701078u, {0, 0, 1, 1} },
    { "WorldLOD",        0x700eb0u, 0x70107cu, {1, 1, 3, 3} },
    { "CarLOD",          0x700eb4u, 0x701080u, {0, 1, 1, 1} },
};

/* Use the current canvas on CreateDevice and Reset. metal_view_size also
 * records the canvas size used here, arming the GPU host's resize detector.
 * With NFSU1_WIDESCREEN (default when dynamic resolution is on), the device
 * matches the canvas and PC aspect hooks own FOV. All UI is fitted
 * in logical units over the scene, with HUD edges selected per element. NFSU1_WIDESCREEN=0 keeps whole multiples of
 * the guest aspect (4:3 / 5:4 letterbox). */
int nfsu1_graphics_size(uint32_t gw, uint32_t gh, uint32_t *dw, uint32_t *dh){
    const char *dynamic = getenv("NFSU1_DYNAMIC_RESOLUTION");
    if (!dynamic || strcmp(dynamic, "1")) return 0;
    unsigned vw, vh;
    extern void metal_view_size(unsigned *, unsigned *);
    extern void nfsu1_widescreen_set_display_aspect(float);
    extern void nfsu1_widescreen_set_resolution(unsigned, unsigned);
    metal_view_size(&vw, &vh);
    *dw = *dh = 0;
    if (!gw || !gh) return 1;
    if (vw > 8192u) vw = 8192u;
    if (vh > 8192u) vh = 8192u;
    if (vw < 2u) vw = 2u;
    if (vh < 2u) vh = 2u;
    vw &= ~1u;
    vh &= ~1u;

    const char *render = getenv("NFSU1_RENDER");
    if (!render || !*render) render = getenv("NFSU2_RENDER");
    double scale = 1.0;
    if (render && *render) {
        if (!strncasecmp(render, "scale:", 6) || (*render >= '0' && *render <= '9') || *render == '.') {
            const char *p = strchr(render, ':');
            double f = atof(p ? p + 1 : render);
            if (f >= 0.25 && f <= 2.0) scale = f;
            else fprintf(stderr, "[nfsu1 graphics] NFSU1_RENDER=%s ignored (scale 0.25..2)\n", render);
        }
    }

    const char *wide = getenv("NFSU1_WIDESCREEN");
    int widescreen = !wide || strcmp(wide, "0");
    if (widescreen) {
        float aspect = (float)vw / (float)vh;
        nfsu1_widescreen_set_display_aspect(aspect);
        unsigned rw = (unsigned)(vw * scale);
        unsigned rh = (unsigned)(vh * scale);
        if (rw > 8192u) rw = 8192u;
        if (rh > 8192u) rh = 8192u;
        if (rw < 2u) rw = 2u;
        if (rh < 2u) rh = 2u;
        rw &= ~1u;
        rh &= ~1u;
        *dw = rw;
        *dh = rh;
        nfsu1_widescreen_set_resolution(rw, rh);
        return 1;
    }
    nfsu1_widescreen_set_display_aspect(0.0f);
    uint32_t a = gw, b = gh;
    while (b){ uint32_t remainder = a % b; a = b; b = remainder; }
    uint32_t aspect_w = gw / a, aspect_h = gh / a;
    uint32_t units_w = vw / aspect_w, units_h = vh / aspect_h;
    uint32_t units = units_w < units_h ? units_w : units_h;
    uint32_t rw = (uint32_t)(aspect_w * units * scale);
    uint32_t rh = (uint32_t)(aspect_h * units * scale);
    *dw = rw & ~1u;
    *dh = rh & ~1u;
    return 1;
}

static void graphics_resolution(void){
    const char *dynamic = getenv("NFSU1_DYNAMIC_RESOLUTION");
    if (dynamic && !strcmp(dynamic, "1")) return;
    const char *resolution = getenv("NFSRES");
    unsigned width, height;
    char extra;
    if (!resolution || sscanf(resolution, "%ux%u%c", &width, &height, &extra) != 2 ||
        width < 640 || height < 480 || width > 8192 || height > 8192 ||
        (uint64_t)width * 3u != (uint64_t)height * 4u)
        return;
    /* The host supplies the selected pixel dimensions. Keep the guest's
     * projection and HUD based on a 4:3 mode even if its saved RES was 5:4.
     * RES=0 selects the first enumerated legacy mode, 640x480. */
    MR32(0x700e70u) = 0;
}

void nfsu1_graphics_apply(void){
    graphics_resolution();
    const char *preset = getenv("NFSU1_GRAPHICS");
    int level = 3;
    int is_mobile = 0;
    if (!preset || !*preset) preset = "max";
    if (!strcmp(preset, "game")) return;
    if (!strcmp(preset, "low")) level = 0;
    else if (!strcmp(preset, "medium")) level = 1;
    else if (!strcmp(preset, "high")) level = 2;
    else if (!strcmp(preset, "mobile")) { level = 1; is_mobile = 1; }
    else if (strcmp(preset, "max")){
        fprintf(stderr, "[nfsu1 graphics] unknown preset '%s'; using max\n", preset);
        preset = "max";
    }
    unsigned limited = 0;
    for (unsigned i = 0; i < sizeof graphics_settings / sizeof graphics_settings[0]; i++){
        const GraphicsSetting *setting = &graphics_settings[i];
        uint32_t requested = setting->level[level];
        if (is_mobile) {
            if (!strcmp(setting->name, "ROADREFLECTION")) requested = 0;
            else if (!strcmp(setting->name, "MOTIONBLUR")) requested = 0;
            else if (!strcmp(setting->name, "DEPTHOFFIELD")) requested = 0;
            else if (!strcmp(setting->name, "LIGHTSTREAKS")) requested = 0;
            else if (!strcmp(setting->name, "WORLDENVMAP")) requested = 0;
            else if (!strcmp(setting->name, "ENVMAP")) requested = 0;
            else if (!strcmp(setting->name, "WorldLOD")) requested = 3;
            else if (!strcmp(setting->name, "CarLOD")) requested = 1;
            else if (!strcmp(setting->name, "CROWD")) requested = 1;
            else if (!strcmp(setting->name, "FOG")) requested = 1;
            else if (!strcmp(setting->name, "LIGHTGLOW")) requested = 1;
            else if (!strcmp(setting->name, "ANIMATEDTEXTURE")) requested = 1;
            else if (!strcmp(setting->name, "PARTICLESYSTEMS")) requested = 1;
            else if (!strcmp(setting->name, "SHADOW")) requested = 1;
            else if (!strcmp(setting->name, "HEADLIGHTS")) requested = 1;
            else if (!strcmp(setting->name, "CARLIGHTING")) requested = 1;
            else if (!strcmp(setting->name, "DAMAGE")) requested = 1;
        }
        uint32_t cap = MR32(setting->cap_address);
        uint32_t applied = requested < cap ? requested : cap;
        limited += applied != requested;
        MR32(setting->address) = applied;
    }
    MR32(0x736334u) = (uint32_t)level; /* PERFORMANCE, used by the graphics menu. */
    fprintf(stderr, "[nfsu1 graphics] applied %s; %u option(s) limited by game capabilities\n",
            preset, limited);
}

/* The linker wraps the real profile settings loader. It still owns parsing,
 * the guest ABI and the return; this adapter changes only graphics globals
 * after it has returned, preserving every CPU field it produced. */
extern void __real_sub_0041c680(CPU *);
void __wrap_sub_0041c680(CPU *c){
    __real_sub_0041c680(c);
    nfsu1_graphics_apply();
}

/* Initial device setup establishes capabilities and an automatic detail
 * level before allocating effect resources. New profiles inherit this level
 * without loading a .cfg, so apply the website choice here as well. Later
 * device resets preserve the current session's in-game graphics choices. */
extern void __real_sub_00410e50(CPU *);
void __wrap_sub_00410e50(CPU *c){
    static int initial_applied;
    __real_sub_00410e50(c);
    if (!initial_applied){
        nfsu1_graphics_apply();
        initial_applied = 1;
    }
}

/* Attribute GPU submissions to the road routine itself. Markers share its
 * polygon helper, so FVF/caller matching alone cannot identify the road. */
static unsigned map_active, map_capture, map_draws;
int nfsu1_minimap_draw(void){
    if (!map_active) return 0;
    map_draws++;
    return map_capture && map_draws <= 4u;
}

extern void __real_sub_0058f090(CPU *);
void __wrap_sub_0058f090(CPU *c){
    static unsigned captures[16];
    uint32_t map = mem_is_committed(c->esp + 7u) ? MR32(c->esp + 4u) : 0;
    int valid = map && mem_is_committed(map) && mem_is_committed(map + 0xc7u);
    uint32_t style = valid ? MR32(map + 0xc4u) : 16u;
    unsigned previous_active = map_active, previous_capture = map_capture;
    unsigned previous_draws = map_draws;
    map_active = 1;
    map_capture = style < 16u && captures[style]++ < 2u;
    map_draws = 0;
    if (map_capture)
        fprintf(stderr, "[nfsu1 road-pass] begin map=%08x style=%u road-texture=%08x\n",
                map, style, valid ? MR32(map + 0x78u) : 0u);
    __real_sub_0058f090(c);
    if (map_capture)
        fprintf(stderr, "[nfsu1 road-pass] end style=%u submissions=%u\n", style, map_draws);
    map_active = previous_active;
    map_capture = previous_capture;
    map_draws = previous_draws;
}
