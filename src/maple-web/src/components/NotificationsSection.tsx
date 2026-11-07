import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { formatAbsolute } from "../lib/format";
import { currentSubscription, disableNotifications, enableNotifications, pushSupport, thisDevice } from "../lib/push";
import { queryKeys } from "../lib/queries";
import { useToast } from "./Toaster";
import { Button, ErrorMessage, Section } from "./ui";

/** Notifications for reminders: on or off for this device, a test, and the account's other devices. */
export function NotificationsSection() {
  const client = useQueryClient();
  const toast = useToast();
  const support = pushSupport();
  const devices = useQuery({ queryKey: queryKeys.pushDevices, queryFn: api.push.devices });
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void currentSubscription()
      .then((current) => live && setSubscription(current))
      .catch(() => live && setSubscription(null));
    return () => {
      live = false;
    };
  }, []);

  const mine = thisDevice(devices.data, subscription ?? null);
  const refresh = async () => {
    setSubscription(await currentSubscription().catch(() => null));
    await client.invalidateQueries({ queryKey: queryKeys.pushDevices });
  };

  const turnOn = useMutation({
    mutationFn: enableNotifications,
    onMutate: () => setError(null),
    onSuccess: async () => {
      await refresh();
      toast.info("Notifications are on for this device.");
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Notifications could not be turned on."),
  });
  const turnOff = useMutation({
    mutationFn: () => disableNotifications(mine),
    onSuccess: async () => {
      await refresh();
      toast.info("Notifications are off for this device.");
    },
    onError: () => setError("Notifications could not be turned off. Try again."),
  });
  const test = useMutation({
    mutationFn: (id: string) => api.push.test(id),
    onSuccess: () => toast.info("Test notification sent. It should appear in a few seconds."),
    onError: async (e) => {
      setError(e instanceof ApiError ? e.message : "The test notification could not be sent.");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.push.unsubscribe(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.pushDevices }),
  });

  const others = (devices.data ?? []).filter((device) => device.id !== mine?.id);
  const on = Boolean(mine);

  return (
    <Section
      title="Notifications"
      description="Reminders arrive as notifications, even when Maple Notes is closed. Turn them on for each device you want them on."
    >
      {support === "ios-home-screen" ? (
        <p className="text-sm text-stone-700 dark:text-stone-200">
          On iPhone and iPad, notifications work once Maple Notes is on your Home Screen: tap <strong>Share</strong>, then{" "}
          <strong>Add to Home Screen</strong>, open it from there and come back to this page (iOS 16.4 or later).
        </p>
      ) : support === "unsupported" ? (
        <p className="text-sm text-stone-700 dark:text-stone-200">
          This browser cannot receive notifications{window.isSecureContext ? "" : " on a page that is not served over HTTPS"}.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-medium">This device</p>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {subscription === undefined || devices.isPending
                ? "Checking…"
                : on
                  ? `On (${mine!.name})`
                  : typeof Notification !== "undefined" && Notification.permission === "denied"
                    ? "Blocked in the browser's site settings"
                    : "Off"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap gap-2">
            {on ? (
              <>
                <Button variant="secondary" busy={test.isPending} onClick={() => test.mutate(mine!.id)}>
                  Send a test
                </Button>
                <Button variant="secondary" busy={turnOff.isPending} onClick={() => turnOff.mutate()}>
                  Turn off
                </Button>
              </>
            ) : (
              <Button busy={turnOn.isPending} disabled={subscription === undefined} onClick={() => turnOn.mutate()}>
                Turn on
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-5">
          <p className="mb-1 text-sm font-medium">Other devices</p>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {others.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm">{device.name}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    <span className="whitespace-nowrap">Added {formatAbsolute(device.createdAtUtc)}</span>
                    {device.lastSentAtUtc && (
                      <>
                        {" "}
                        <span className="whitespace-nowrap">· last sent {formatAbsolute(device.lastSentAtUtc)}</span>
                      </>
                    )}
                  </p>
                </div>
                <Button variant="ghost" className="ml-auto shrink-0" busy={remove.isPending && remove.variables === device.id} onClick={() => remove.mutate(device.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
