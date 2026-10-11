"use client";

import { Separator } from "@/components/ui/separator";
import { AvatarEditor } from "@/features/profile/components/avatar-editor";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { useMe } from "@/lib/auth/session";

export function ProfileSettings() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <section className="grid gap-6" aria-labelledby="profile-heading">
      <div>
        <h1 id="profile-heading" className="text-xl font-semibold">
          Profile
        </h1>
        <p className="text-sm text-muted-foreground">How other people see you.</p>
      </div>
      <AvatarEditor me={me} />
      <Separator />
      <ProfileForm me={me} />
    </section>
  );
}
