import { useBranding } from "../lib/branding";
import { Logo } from "./Logo";
import { cn } from "./ui";

/** The app's icon: the one administrators chose, or the maple leaf. */
export function BrandMark({ className = "size-9" }: { className?: string }) {
  const { iconUrl } = useBranding();
  return iconUrl ? <img src={iconUrl} alt="" className={cn(className, "rounded-lg object-contain")} /> : <Logo className={className} />;
}
