"use client";

import { useState, useEffect } from "react";
import { useImpersonation } from "@/components/impersonation-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Bell } from "lucide-react";
import type { FollowSubscriber, Profile } from "@/lib/database.types";

// Reads via /api/dashboard/followers. The endpoint bundles profile +
// active subscribers into a single round-trip and gates the subscriber
// list on premium tier server-side — non-premium accounts never see
// the list.

export function FollowersTab() {
  // effectiveUserId flips on impersonation start/stop — used as the
  // fetch effect's dep so the tab reloads without a page refresh.
  const { effectiveUserId } = useImpersonation();
  const [subscribers, setSubscribers] = useState<FollowSubscriber[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/dashboard/followers");
        if (res.ok) {
          const data = (await res.json()) as {
            profile: Profile | null;
            followers: FollowSubscriber[];
          };
          setProfile(data.profile);
          setSubscribers(data.followers);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [effectiveUserId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (profile?.subscription_tier !== "premium") {
    return (
      <div className="space-y-6">
        <Card className="max-w-2xl">
          <CardContent className="py-8 text-center">
            <Bell className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Premium Feature</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Upgrade to Premium to let your customers subscribe to event
              notifications. They&apos;ll get an email whenever you post new events.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const followUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/follow/${profile.id}`
      : `/follow/${profile.id}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{subscribers.length}</p>
                <p className="text-sm text-muted-foreground">
                  Active Subscribers
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-2">
            <p className="text-sm font-medium">Your signup link</p>
            <code className="text-xs bg-muted p-2 rounded block break-all">
              {followUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(followUrl)}
              className="text-xs text-primary hover:underline"
            >
              Copy to clipboard
            </button>
          </CardContent>
        </Card>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Subscriber List</CardTitle>
        </CardHeader>
        <CardContent>
          {subscribers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No subscribers yet. Share your follow link to start building your
              audience!
            </p>
          ) : (
            <div className="divide-y">
              {subscribers.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between py-3 gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {sub.email}
                    </p>
                    {sub.name && (
                      <p className="text-xs text-muted-foreground truncate">
                        {sub.name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="secondary" className="text-xs">
                      {new Date(sub.subscribed_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
