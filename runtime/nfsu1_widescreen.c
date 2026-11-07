/* NFSU1 widescreen: port of codepdbh/nfsu1-recompiled src/runtime/widescreen.c
 * to the web CPU* ABI. Patch semantics from ThirteenAG
 * NFSUnderground.WidescreenFix (WidescreenFixesPack, MIT): FixFOV and
 * render-size widening. UI stays in its original logical canvas, fitted by
 * the host per draw. Sites are config/hooks.txt
 * VAs emitted as guest_hook(c, va) before the marked instruction.
 * No translated game instructions are included. */
#include "nfsu1_widescreen.h"
#include <math.h>

static float s_display_aspect;
static unsigned s_device_width, s_device_height;
static float s_aspect = 4.0f / 3.0f;
static double s_fov_scale[3] = {1.0, 0.5, 1.0};

static const struct { uint32_t va; uint8_t reg; } k_hit[] = {
    { 0x00415358u, 2 },
    { 0x00415CADu, 2 },
    { 0x004B7E14u, 2 },
    { 0x004B8C71u, 2 },
    { 0x004C1A39u, 2 },
    { 0x004D1DF9u, 2 },
    { 0x004D516Au, 2 },
    { 0x004D66D1u, 2 },
    { 0x004DC438u, 2 },
    { 0x004E39A8u, 2 },
    { 0x004EAA5Au, 2 },
    { 0x004F7EDFu, 2 },
    { 0x004F7F36u, 2 },
    { 0x0054F09Au, 2 },
    { 0x0054F363u, 2 },
    { 0x005518D8u, 2 },
    { 0x00557EDCu, 2 },
    { 0x00559BAAu, 2 },
    { 0x0055BAEAu, 2 },
    { 0x0055CD90u, 2 },
    { 0x0055D7F8u, 2 },
    { 0x0055F0DAu, 2 },
    { 0x00561C98u, 2 },
    { 0x00562128u, 2 },
    { 0x0056391Au, 2 },
    { 0x00563CFAu, 2 },
    { 0x004B8CF0u, 0 },
    { 0x004D6750u, 0 },
    { 0x004F7D65u, 0 },
    { 0x004F608Bu, 1 },
};

void nfsu1_widescreen_set_display_aspect(float aspect) {
    s_display_aspect = isfinite(aspect) && aspect > 0.0f ? aspect : 0.0f;
    if (s_display_aspect > 0.0f) s_aspect = s_display_aspect;
}

void nfsu1_widescreen_set_resolution(unsigned width, unsigned height) {
    if (width && height) {
        s_device_width = width;
        s_device_height = height;
        s_aspect = (float)width / (float)height;
        if (s_display_aspect > 0.0f) nfsu1_widescreen_set_display_aspect(s_aspect);
    }
}

void nfsu1_widescreen_device_size(unsigned *width, unsigned *height) {
    *width = s_device_width;
    *height = s_device_height;
}

int nfsu1_widescreen_active(void) {
    return s_display_aspect > 0.0f;
}

float nfsu1_widescreen_hud_pos_x(void) {
    return 320.0f;
}

float nfsu1_widescreen_hud_scale_x(void) {
    return 1.0f / 320.0f;
}

/* Resolve authored identity through the original FE group hierarchy. Each
 * traversal retains its source element while text builds nested glyph caches.
 * Guest animation matrices and cached translations never select an edge. */
typedef struct { uint32_t hash, id; uint8_t canvas; } hud_entry;
static const hud_entry k_hud[] = {
#include "widescreen_hud.inc"
};
static uint32_t s_fe_instance, s_fe_element;
static unsigned s_hud_draws;

unsigned nfsu1_widescreen_hud_draws(void) {
    return s_hud_draws;
}

static int readable(uint32_t address, uint32_t last) {
    return address && address <= UINT32_MAX - last &&
        mem_is_committed(address) && mem_is_committed(address + last);
}

static float element_canvas(uint32_t instance, uint32_t element) {
    if (!readable(instance, 0x341Fu)) return 1.f;
    uint32_t seen[65];
    unsigned count = 0;
    float canvas = 1.f;
    for (;;) {
        if (!readable(element, 0x23u) || count == 65u) return 1.f;
        for (unsigned i = 0; i < count; i++)
            if (seen[i] == element) return 1.f;
        seen[count++] = element;
        uint32_t hash = MR32(element + 0x0Cu), id = MR32(element + 0x10u);
        /* The closest explicitly named subcomposite wins. The drag turbo
         * is intentionally on the right inside the left gauge cluster. */
        if (canvas == 1.f) {
            for (unsigned i = 0; i < sizeof k_hud / sizeof k_hud[0]; i++) {
                if (k_hud[i].hash != hash || k_hud[i].id != id) continue;
                /* The noninteractive music banner can cross flow changes
                 * while visible; retain one anchor for its whole animation. */
                int race = readable(0x0077A920u, 3u) && MR32(0x0077A920u) == 6u;
                if (race && hash != 0x82009C1Fu) s_hud_draws++;
                if ((hash == 0x82009C1Fu && id == 0x53F4u) || race)
                    canvas = (float)k_hud[i].canvas;
                break;
            }
        }
        uint32_t group = MR16(element + 0x20u);
        if (!group) return canvas;
        if (group >= 64u) return 1.f;
        /* 0x4F2E30 stores the group's originating element at slot +50.
         * Its own parent index gives the next authored ancestor. */
        uint32_t slot = instance + 0x20u + group * 0xD0u;
        if (!readable(slot, 0x53u)) return 1.f;
        element = MR32(slot + 0x50u);
    }
}

/* 0x4F2CB0 dispatches both cached quads and text using edi = FE instance,
 * eax = originating element. Keep context only while the original executes;
 * the GPU draw record captures its canvas before deferred rendering. */
extern void __real_sub_004f2cb0(CPU *);
void __wrap_sub_004f2cb0(CPU *c) {
    uint32_t previous_instance = s_fe_instance, previous_element = s_fe_element;
    s_fe_instance = c->edi;
    s_fe_element = c->eax;
    if (s_fe_instance && s_fe_element && readable(0x0077A920u, 3u) && MR32(0x0077A920u) == 6u)
        (void)element_canvas(s_fe_instance, s_fe_element);
    __real_sub_004f2cb0(c);
    s_fe_instance = previous_instance;
    s_fe_element = previous_element;
}

float nfsu1_widescreen_ui_canvas(CPU *c) {
    if (!nfsu1_widescreen_active()) return 0.f;
    if (s_device_width * 3ull <= s_device_height * 4ull) return 1.f;
    if (s_fe_instance && s_fe_element)
        return element_canvas(s_fe_instance, s_fe_element);
    /* Immediate minimap geometry has no FE source element. These are its
     * verified submitters; menus, loading screens and the cursor stay centered. */
    if (MR32(0x0077A920u) != 6u) return 1.f;
    if (c->eip == 0x0040C4A8u) {
        if (readable(c->esp, 0x83u) && MR32(c->esp + 0x80u) == 0x00589907u)
            return 2.f;
        return 1.f;
    }
    if (!readable(c->ebp, 7u)) return 1.f;
    uint32_t caller = MR32(c->ebp + 4u);
    if (caller == 0x0058FAFBu || caller == 0x00590AB4u) return 2.f;
    return 1.f;
}

static int known_site(uint32_t va) {
    if (va == 0x00409EB8u || va == 0x00401832u || va == 0x004131B5u) return 1;
    for (unsigned i = 0; i < sizeof k_hit / sizeof k_hit[0]; i++)
        if (k_hit[i].va == va) return 1;
    switch (va) {
    case HOOK_SITE(0x0040875A):
    case HOOK_SITE(0x004F20A7):
    case HOOK_SITE(0x004F2333):
    case HOOK_SITE(0x004F28B3):
    case HOOK_SITE(0x004F1E31):
    case HOOK_SITE(0x004F26E9):
    case HOOK_SITE(0x004F314B):
    case HOOK_SITE(0x0058E5C3):
    case HOOK_SITE(0x00409F75):
    case HOOK_SITE(0x004F18D1):
    case HOOK_SITE(0x00590DDF):
    case HOOK_SITE(0x0058FB1C):
    case HOOK_SITE(0x0058E5B2):
    case HOOK_SITE(0x004F6DAB):
    case HOOK_SITE(0x004F1FD7):
    case HOOK_SITE(0x004F225C):
    case HOOK_SITE(0x004F25D1):
    case HOOK_SITE(0x0040DDE0):
    case HOOK_SITE(0x0040DE49):
    case HOOK_SITE(0x0040DEC1):
    case HOOK_SITE(0x0040DEF2):
        return 1;
    default:
        return 0;
    }
}

int nfsu1_ws_hook(CPU *c, uint32_t va) {
    if (!known_site(va)) return 0;

    /* Keep cached UI transforms, live quads, minimaps and hit tests in the
     * same original units. Moving anchors here persists the old aspect in
     * cached objects across Reset. The host fits both UI submitters together. */
    if (s_display_aspect <= 0.0f) return 1;

    switch (va) {
    case HOOK_SITE(0x0040875A): {
        uint32_t height = MR32(0x0071A970u);
        uint32_t width = (uint32_t)lroundf((float)height * s_display_aspect) & ~1u;
        if (height && width > MR32(0x0071A96Cu)) {
            MR32(0x0071A96Cu) = width;
            MR32(0x00701034u) = width;
            { extern void metal_set_game_size(unsigned, unsigned);
              metal_set_game_size(width, height); }
        }
        /* Live host resolution owns projection constants. Guest dimensions
         * may still describe a previous canvas or a legacy saved mode. */
        break;
    }
    case HOOK_SITE(0x0040DDE0): {
        uint32_t view = MR32(c->ebp + 4u);
        if (view == 1u || view == 4u) {
            s_fov_scale[0] = 1.0 / (s_aspect / (4.0 / 3.0));
            s_fov_scale[1] = 0.4525;
            s_fov_scale[2] = 1.28;
        } else {
            s_fov_scale[0] = 1.0;
            s_fov_scale[1] = 0.5;
            s_fov_scale[2] = 1.0;
        }
        ST(0) = view == 3u ? 0.45 : 1.0;
        MR32(c->esp + 0x20u) = 0x3F800000u;
        break;
    }
    case HOOK_SITE(0x0040DE49): ST(0) *= s_fov_scale[1] / 0.5; break;
    case HOOK_SITE(0x0040DEC1): ST(0) *= s_fov_scale[0]; break;
    case HOOK_SITE(0x0040DEF2): ST(0) *= s_fov_scale[2]; break;
    default:
        break; /* Accepted legacy HUD sites deliberately preserve guest data. */
    }
    return 1;
}
