// C seam between the Swift ExactModule adapter and the NativeScript VM.
// Every function runs on the main thread; replies may be sent later, also on main.
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NSXRuntime NSXRuntime;

typedef struct NSXHost {
  void *ctx;
  void (*log)(void *ctx, const char *line);
  void (*changed)(void *ctx, const char *topic);
  double (*now)(void *ctx);
  void (*frames)(void *ctx, uint64_t token, int start);
  void (*after)(void *ctx, uint64_t token, double ms);
  void (*cancel_after)(void *ctx, uint64_t token);
  void (*reply)(void *ctx, uint64_t token, int status, const char *body);
  void (*event)(void *ctx, uint64_t view, uint32_t kind, const char *text);
  void (*act)(void *ctx, uint64_t element, const char *action, const char *text);
} NSXHost;

// Null with *error set (free with nsx_free) when the VM or module could not start.
NSXRuntime *nsx_create(const NSXHost *host, char **error);
void nsx_destroy(NSXRuntime *rt);
void nsx_free(char *text);

// Null with *error set on a refusal; otherwise a JSON string to free.
char *nsx_call(NSXRuntime *rt, const char *request, char **error);
void nsx_later(NSXRuntime *rt, const char *request, uint64_t token);

// The module's UIView or NSView for a new instance, retained by the VM until
// nsx_view_destroy; null with *error set on a refusal.
void *nsx_view_create(NSXRuntime *rt, uint64_t view, const char *tag, const char *props, char **error);
void nsx_view_set_props(NSXRuntime *rt, uint64_t view, const char *props);
void nsx_view_destroy(NSXRuntime *rt, uint64_t view);

// phase is "element" or "ended". info is JSON: word, id, isNew, data.
void nsx_element(NSXRuntime *rt, const char *phase, uint64_t element, const char *info, void *view, void *platform);

void nsx_tick(NSXRuntime *rt, uint64_t token, double now, double seq);
void nsx_fire_after(NSXRuntime *rt, uint64_t token);

// Whether the development bytecode changed; when it did, re-evaluates it and returns 1.
int nsx_reload_if_changed(NSXRuntime *rt);
const char *nsx_dev_bytecode_path(void);

#ifdef __cplusplus
}
#endif
