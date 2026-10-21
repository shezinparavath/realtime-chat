/**
 * RTC-N2-02 push notifications, pure logic (no React, no native imports; the module is injected).
 * Contract: interface-contracts.md "Push notifications (RTC-N2-01 server / RTC-N2-02 mobile)".
 *   POST   /me/push-token { token }  (auth) after login / restore, once permission is granted
 *   DELETE /me/push-token { token }  (auth) on logout, best effort
 *   Android channel 'messages' at default importance; payload data { chatId }; tap -> /chat/<chatId>;
 *   foreground notifications are not shown (the in-app UI covers them).
 * Failure safety: every step is caught; nothing is retried at startup; nothing is shown to the user.
 */

export const PUSH_CHANNEL_ID = 'messages';
export const PUSH_CHANNEL_NAME = 'Messages';
// Same pattern the server validates (RTC-N2-01): ExponentPushToken[...] or the newer ExpoPushToken[...].
const TOKEN_RE = /^(?:ExponentPushToken|ExpoPushToken)\[[^[\]\s]+\]$/;

/** setNotificationHandler: never show, sound or badge while the app is in the foreground. */
export const FOREGROUND_BEHAVIOR = Object.freeze({
  shouldShowAlert: false,
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
});
export function installForegroundHandler(N) {
  if (typeof N?.setNotificationHandler !== 'function') return false;
  try {
    N.setNotificationHandler({ handleNotification: async () => FOREGROUND_BEHAVIOR });
    return true;
  } catch {
    return false;
  }
}

/** chatId from a notification response (data { chatId }); null unless it's a safe id string. */
export function chatIdFromResponse(response) {
  const id = response?.notification?.request?.content?.data?.chatId;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
const responseKey = (response) => response?.notification?.request?.identifier ?? null;

/**
 * Registration, at most once per signed-in user (restore + re-renders call register() repeatedly).
 *   deps: getModule() -> expo-notifications or null, platform, getProjectId(), post(token), del(token)
 *   register(userId) -> Promise<status>   ('registered' | 'skipped:*' | 'denied' | 'failed:*' | 'duplicate')
 *   unregister()     -> fire-and-forget DELETE of the registered token; returns the promise (never rejects)
 */
export function createPushRegistrar({ getModule, platform, getProjectId, post, del }) {
  let doneFor = null; // userId whose registration was attempted (success or not: no startup retries)
  let inflight = null;
  let token = null;

  async function run(N) {
    try {
      if (N.setNotificationChannelAsync) {
        await N.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
          name: PUSH_CHANNEL_NAME,
          importance: N.AndroidImportance?.DEFAULT ?? 3,
        });
      }
    } catch {
      // channel failure doesn't stop registration (the plugin's defaultChannel still applies)
    }
    let granted = false;
    try {
      const cur = await N.getPermissionsAsync();
      granted = !!cur?.granted;
      if (!granted && cur?.canAskAgain !== false) granted = !!(await N.requestPermissionsAsync())?.granted;
    } catch {
      return 'failed:permission';
    }
    if (!granted) return 'denied';
    let projectId = null;
    try {
      projectId = getProjectId();
    } catch {
      projectId = null;
    }
    if (typeof projectId !== 'string' || !projectId) return 'skipped:no-project-id';
    let t;
    try {
      t = (await N.getExpoPushTokenAsync({ projectId }))?.data;
    } catch {
      return 'failed:token';
    }
    if (typeof t !== 'string' || !TOKEN_RE.test(t)) return 'failed:token-shape';
    try {
      await post(t);
    } catch {
      return 'failed:post';
    }
    token = t;
    return 'registered';
  }

  return {
    register(userId) {
      if (!userId) return Promise.resolve('skipped:no-user');
      if (doneFor === userId) return inflight || Promise.resolve('duplicate');
      doneFor = userId;
      token = null;
      if (platform !== 'android') return (inflight = Promise.resolve('skipped:platform'));
      let N = null;
      try {
        N = getModule();
      } catch {
        N = null;
      }
      if (!N) return (inflight = Promise.resolve('skipped:no-module'));
      inflight = run(N).catch(() => 'failed:unexpected');
      return inflight;
    },
    /** Call BEFORE the session token is cleared: the DELETE captures the auth header synchronously. */
    unregister() {
      const t = token;
      token = null;
      doneFor = null;
      inflight = null;
      if (!t) return Promise.resolve('skipped:no-token');
      try {
        return Promise.resolve(del(t)).then(
          () => 'deleted',
          () => 'failed:delete',
        );
      } catch {
        return Promise.resolve('failed:delete');
      }
    },
    get token() {
      return token;
    },
  };
}

/**
 * Tap routing: cold start (last response) and warm taps (listener) both land here. Navigates only
 * once auth is ready; a tap that arrives earlier waits. Each notification opens at most once.
 */
export function createTapRouter({ navigate }) {
  const seen = new Set();
  let ready = false;
  let pending = null;
  const go = (id) => {
    try {
      navigate(id);
    } catch {
      // navigation failure: stay where we are
    }
  };
  return {
    handle(response) {
      const id = chatIdFromResponse(response);
      if (!id) return false;
      const key = responseKey(response);
      if (key) {
        if (seen.has(key)) return false;
        seen.add(key);
      }
      if (ready) go(id);
      else pending = id;
      return true;
    },
    setReady(v) {
      ready = !!v;
      if (ready && pending) {
        const id = pending;
        pending = null;
        go(id);
      }
    },
    get pending() {
      return pending;
    },
  };
}
