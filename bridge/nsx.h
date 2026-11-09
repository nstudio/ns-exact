// C seam between Exact's Swift adapters and the NativeScript VM. One VM serves the
// process; the app's module and each package instance attach to it as a client.
// Every function runs on the main thread; replies may be sent later, also on main.
// Each entry into JavaScript is stopped after 100 ms, Exact's budget for a turn: a call
// then refuses and a later's reply fails.
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*NSXLogFn)(void *ctx, const char *line);
typedef void (*NSXTopicFn)(void *ctx, const char *topic);
typedef double (*NSXNowFn)(void *ctx);
typedef void (*NSXFramesFn)(void *ctx, uint64_t token, int start);
typedef void (*NSXAfterFn)(void *ctx, uint64_t token, double ms);
typedef void (*NSXCancelFn)(void *ctx, uint64_t token);
typedef void (*NSXReplyFn)(void *ctx, uint64_t token, int status, const char *body);
typedef void (*NSXEventFn)(void *ctx, uint64_t view, uint32_t kind, const char *text);
typedef void (*NSXActFn)(void *ctx, uint64_t element, const char *action, const char *text);
// kind is ExactDiagnostics' record kind: 1 count (value: by), 2 measure (value: ms), 3 begin
// (returns the span's token), 4 end (value: that token), 5 publish (text: the value as JSON).
typedef uint64_t (*NSXDiagFn)(void *ctx, uint32_t kind, const char *name, double value, const char *text);

typedef struct NSXHost {
  void *ctx;
  NSXLogFn log;
  NSXTopicFn changed;
  NSXNowFn now;
  NSXFramesFn frames;
  NSXAfterFn after;
  NSXCancelFn cancel_after;
  NSXReplyFn reply;
  NSXEventFn event;
  NSXActFn act;
  // Null where the host keeps no diagnostics, as for a package.
  NSXDiagFn diag;
} NSXHost;

// `module` is "app" for the app's own module, or a package's name. Returns 0 with
// *error set (free with nsx_free) when the VM did not start or no such module is defined.
uint64_t nsx_attach(const char *module, const NSXHost *host, char **error);
// The same, for Swift that cannot import this header: a package adapter is
// compiled as a Swift module of its own.
uint64_t nsx_attach_flat(const char *module, void *ctx, NSXLogFn log, NSXTopicFn changed, NSXNowFn now,
                         NSXFramesFn frames, NSXAfterFn after, NSXCancelFn cancel_after, NSXReplyFn reply,
                         NSXEventFn event, NSXActFn act, char **error);
void nsx_detach(uint64_t client);
void nsx_free(char *text);

// Null with *error set on a refusal; otherwise a JSON string to free.
char *nsx_call(uint64_t client, const char *request, char **error);
void nsx_later(uint64_t client, const char *request, uint64_t token);

// The module's UIView or NSView for a new instance, retained by the VM until
// nsx_view_destroy; null with *error set on a refusal.
void *nsx_view_create(uint64_t client, uint64_t view, const char *tag, const char *props, char **error);
void nsx_view_set_props(uint64_t client, uint64_t view, const char *props);
void nsx_view_destroy(uint64_t client, uint64_t view);
// The agent's input to a view (`type` in a drive): kind is "text" or "key"; phase is "", "down"
// or "up". 1 when the view took it; 0 with *error set when it refused or takes no input.
int nsx_view_input(uint64_t client, uint64_t view, const char *kind, const char *text, const char *phase, char **error);

// phase is "element" or "ended". info is JSON: word, id, isNew, data.
void nsx_element(uint64_t client, const char *phase, uint64_t element, const char *info, void *view, void *platform);

void nsx_tick(uint64_t client, uint64_t token, double now, double seq);
void nsx_fire_after(uint64_t client, uint64_t token);

// Re-evaluates the development bytecode when it changed on disk; 1 when it did.
int nsx_reload_if_changed(void);
const char *nsx_dev_bytecode_path(void);

#ifdef __cplusplus
}
#endif
