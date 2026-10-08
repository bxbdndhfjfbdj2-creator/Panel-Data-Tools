import type { ComponentProps } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  const { "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...rootProps } = props;
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-11 w-full touch-none items-center", className)}
      {...rootProps}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-border">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {/* This wrapper renders one thumb, so the root's accessible name belongs on that thumb. */}
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="block size-5 rounded-full bg-accent shadow-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </SliderPrimitive.Root>
  );
}
