import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/lib/usePushSubscription";

type PushNotificationToggleProps =
  | { kind: "ADMIN"; showLabel?: boolean }
  | { kind: "CUSTOMER"; accessToken: string | undefined; showLabel?: boolean };

export function PushNotificationToggle(props: PushNotificationToggleProps) {
  const { state, subscribe, unsubscribe } =
    props.kind === "ADMIN"
      ? usePushSubscription({ kind: "ADMIN" })
      : usePushSubscription({ kind: "CUSTOMER", accessToken: props.accessToken });

  // Nothing to offer: no browser support (most notably iOS Safari outside an
  // installed PWA), or the VAPID key isn't configured yet.
  if (state === "unsupported") return null;

  if (state === "denied") {
    return (
      <span className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <BellOff className="size-4 shrink-0" />
        {props.showLabel && <span>Notifications blocked</span>}
      </span>
    );
  }

  const subscribed = state === "subscribed";
  const loading = state === "loading";

  return (
    <Button
      size="sm"
      variant="ghost"
      className={props.showLabel ? "w-full justify-start" : undefined}
      disabled={loading}
      onClick={() => void (subscribed ? unsubscribe() : subscribe())}
    >
      {subscribed ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {props.showLabel && <span>{subscribed ? "Notifications on" : "Get notified"}</span>}
    </Button>
  );
}
