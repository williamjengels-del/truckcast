"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface EmbedWidgetSectionProps {
  userId: string;
  subscriptionTier: string;
}

export function EmbedWidgetSection({ userId, subscriptionTier }: EmbedWidgetSectionProps) {
  const [copiedIframe, setCopiedIframe] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  if (subscriptionTier === "starter") {
    return null;
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://yourapp.com");

  const iframeCode = `<iframe src="${baseUrl}/embed/${userId}" width="100%" height="600" frameborder="0"></iframe>`;
  const scriptCode = `<script src="${baseUrl}/embed/widget.js" data-truck-id="${userId}"></script>`;

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  }

  return (
    <Card className="max-w-2xl" id="embed-widget">
      <CardHeader>
        <CardTitle>Embed Schedule Widget</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Add your schedule to your website. Copy one of the embed codes below and paste it into your site&apos;s HTML.
        </p>

        <div className="space-y-2">
          <label className="text-sm font-medium">Iframe Embed</label>
          <div className="relative">
            <code className="text-xs bg-muted p-3 rounded block whitespace-pre-wrap break-all">
              {iframeCode}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => copyToClipboard(iframeCode, setCopiedIframe)}
            >
              {copiedIframe ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Script Embed</label>
          <div className="relative">
            <code className="text-xs bg-muted p-3 rounded block whitespace-pre-wrap break-all">
              {scriptCode}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => copyToClipboard(scriptCode, setCopiedScript)}
            >
              {copiedScript ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Preview</label>
          <div className="border rounded-lg overflow-hidden">
            <iframe
              src={`/embed/${userId}`}
              width="100%"
              height="400"
              style={{ border: "none" }}
              title="Schedule Widget Preview"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
