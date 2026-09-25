"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useDeviceIdentity } from "@/hooks/useDeviceIdentity";
import { DeviceSetup } from "@/components/DeviceSetup";
import type { StoredDeviceIdentity } from "@/lib/device-storage";

export default function SetupPage() {
  const router = useRouter();
  const { device, updateIdentity } = useDeviceIdentity();

  return (
    <DeviceSetup
      currentDevice={device}
      onConfigured={(configuredIdentity: StoredDeviceIdentity) => {
        updateIdentity(configuredIdentity);
        router.push("/");
      }}
      onCancel={device ? () => router.push("/") : undefined}
    />
  );
}
