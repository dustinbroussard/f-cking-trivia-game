export interface SafeNotificationOptions extends NotificationOptions {
  onClickFocusWindow?: boolean;
}

function hasNotificationSupport() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermissionSafe(): Promise<NotificationPermission | null> {
  if (!hasNotificationSupport()) return null;

  try {
    if (Notification.permission === 'default') {
      return await Notification.requestPermission();
    }

    return Notification.permission;
  } catch {
    return null;
  }
}

export async function notifySafe(title: string, options: SafeNotificationOptions = {}): Promise<void> {
  if (!hasNotificationSupport()) return;

  const permission = await requestNotificationPermissionSafe();
  if (permission !== 'granted') return;

  const { onClickFocusWindow, ...notificationOptions } = options;

  try {
    const notification = new Notification(title, notificationOptions);
    if (onClickFocusWindow) {
      notification.onclick = () => {
        try {
          window.focus();
        } catch {
          // Ignore focus failures.
        }
      };
    }
    return;
  } catch {
    // Fall through to service worker notification.
  }

  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;

    await registration.showNotification(title, notificationOptions);
  } catch {
    // Intentionally ignore notification failures.
  }
}
