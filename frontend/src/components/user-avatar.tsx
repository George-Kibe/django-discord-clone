import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Props = {
  user: { username: string; display_name?: string; avatar_url?: string | null };
  className?: string;
  "data-testid"?: string;
};

export function UserAvatar({ user, className, ...rest }: Props) {
  const name = user.display_name || user.username;
  return (
    <Avatar className={cn("size-9", className)} {...rest}>
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
      <AvatarFallback className="bg-primary/20 text-[length:inherit] font-semibold text-brand">
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
