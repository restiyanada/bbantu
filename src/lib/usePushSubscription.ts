import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export type PushSubscriptionState = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";

// The VAPID public key from the browser's push-subscribe options must be raw
// bytes, but env vars can only carry text — this is the standard base64url
// (URL-safe, unpadded) decode for that one value.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type UsePushSubscriptionArgs =
  | { kind: "ADMIN" }
  | { kind: "CUSTOMER"; accessToken: string | undefined };

export function usePushSubscription(args: UsePushSubscriptionArgs) {
  const [state, setState] = useState<PushSubscriptionState>("loading");
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window;

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!supported || !vapidPublicKey) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        if (!cancelled) setState(existing ? "subscribed" : "unsubscribed");
      } catch (err) {
        console.error("Failed to check push subscription state:", err);
        if (!cancelled) setState("unsubscribed");
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [supported, vapidPublicKey]);

  const subscribe = useCallback(async () => {
    if (!supported || !vapidPublicKey) return;
    if (args.kind === "CUSTOMER" && !args.accessToken) return;

    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = subscription.toJSON();

      const body =
        args.kind === "ADMIN"
          ? { kind: "ADMIN", endpoint: json.endpoint, keys: json.keys }
          : { kind: "CUSTOMER", endpoint: json.endpoint, keys: json.keys, accessToken: args.accessToken };

      const { error } = await supabase.functions.invoke("push-subscribe", { body });
      if (error) throw error;
      setState("subscribed");
    } catch (err) {
      console.error("Failed to subscribe to push notifications:", err);
      setState("unsubscribed");
    }
  }, [supported, vapidPublicKey, args.kind, args.kind === "CUSTOMER" ? args.accessToken : undefined]);

  const unsubscribe = useCallback(async () => {
    setState("loading");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await supabase.functions.invoke("push-unsubscribe", { body: { endpoint } });
      }
    } catch (err) {
      console.error("Failed to unsubscribe from push notifications:", err);
    } finally {
      setState("unsubscribed");
    }
  }, []);

  return { state, subscribe, unsubscribe };
}
