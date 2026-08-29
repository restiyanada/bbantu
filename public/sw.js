self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Malformed payload — fall back to the defaults above rather than crash.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients[0];
      if (existing) {
        if ("navigate" in existing) {
          try {
            await existing.navigate(targetUrl);
          } catch {
            // Cross-origin or otherwise not navigable — just focus what's open.
          }
        }
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
