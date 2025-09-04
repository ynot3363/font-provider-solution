import * as React from "react";

/** Simple map of common fallback stacks you can override per-usage. */
const DEFAULT_FALLBACK = `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

type Source =
  | string
  | {
      url: string;
      format?: "woff2" | "woff" | "opentype" | "truetype" | "svg";
    };

type FontStatus = "idle" | "loading" | "loaded" | "error";

export type FontProviderProps = {
  /** The font-family name to register and apply. */
  family: string;
  /** One or more sources; strings can be full `url(...) format("woff2")` parts or plain URLs. */
  sources: Source[] | Source;
  /** Optional native FontFace descriptors (subset typed to be safe across TS lib versions). */
  descriptors?: Partial<
    Pick<
      FontFaceDescriptors,
      | "style"
      | "weight"
      | "stretch"
      | "unicodeRange"
      | "display"
      | "featureSettings"
      | "ascentOverride"
      | "descentOverride"
      | "lineGapOverride"
    >
  >;
  /** Max time to wait before showing fallback (default 6000ms). */
  timeoutMs?: number;
  /** Fallback font stack when the custom font isn’t available. */
  fallbackStack?: string;
  /** Shown while loading instead of hiding (optional). */
  renderWhileLoading?: React.ReactNode;
  /** Called if the font cannot be loaded (after error or timeout). */
  onError?: (err: Error) => void;

  /** Children to render once loaded OR on error (with fallback). */
  children: React.ReactNode;

  /** Optional: extra className and style applied to the wrapper. */
  className?: string;
  style?: React.CSSProperties;
};

type Ctx = { status: FontStatus; family: string };
const FontStatusContext = React.createContext<Ctx | undefined>(undefined);

/** Hook for descendants to know whether the font is ready. */
export function useFontStatus(): Ctx {
  const ctx = React.useContext(FontStatusContext);
  if (!ctx)
    throw new Error("useFontStatus must be used within <FontProvider/>");
  return ctx;
}

function buildSrc(sources: Source[] | Source): string {
  const arr = Array.isArray(sources) ? sources : [sources];
  return arr
    .map((s): string => {
      if (typeof s === "string") {
        // If it already looks like url(...), pass through; otherwise wrap it.
        const trimmed = s.trim();
        if (/^url\(/i.test(trimmed)) return trimmed;
        return `url("${trimmed}")`;
      } else {
        const fmt = s.format ? ` format("${s.format}")` : "";
        return `url("${s.url}")${fmt}`;
      }
    })
    .join(", ");
}

/**
 * FontProvider
 * - Hides children until the font is LOADED or we ERROR/timeout.
 * - On ERROR/timeout, shows children with fallback font stack.
 */
export function FontProvider({
  family,
  sources,
  descriptors,
  timeoutMs = 6000,
  fallbackStack = DEFAULT_FALLBACK,
  renderWhileLoading,
  onError,
  children,
  className,
  style,
}: FontProviderProps): JSX.Element {
  const [status, setStatus] = React.useState<FontStatus>("idle");

  React.useEffect((): void | (() => void) => {
    let cancelled = false;

    // SSR / non-browser guard: render immediately with fallback
    if (typeof window === "undefined" || !("fonts" in document)) {
      setStatus("error");
      return;
    }

    async function load(): Promise<void> {
      try {
        setStatus("loading");

        // If the font is already available, short-circuit.
        if (document.fonts.check(`1em "${family}"`)) {
          if (!cancelled) setStatus("loaded");
          return;
        }

        const src = buildSrc(sources);
        const font = new FontFace(family, src, descriptors);

        const loadPromise: Promise<FontFace> = font.load();
        const timeoutPromise: Promise<never> = new Promise(
          (_resolve, reject): void => {
            setTimeout(() => reject(new Error("Font load timeout")), timeoutMs);
          }
        );

        await Promise.race([loadPromise, timeoutPromise]);

        // Add to the document and mark loaded.
        document.fonts.add(font);
        // A quick extra check makes Safari happier sometimes.
        await document.fonts.load(`1em "${family}"`);

        if (!cancelled) setStatus("loaded");
      } catch (err: unknown) {
        if (!cancelled) {
          setStatus("error");
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    load().catch(console.error);
    return (): void => {
      cancelled = true;
    };
  }, [
    family,
    JSON.stringify(sources),
    JSON.stringify(descriptors),
    timeoutMs,
    onError,
  ]);

  // We apply font only when actually loaded; otherwise we apply fallback.
  const effectiveFontFamily: string =
    status === "loaded" ? `"${family}", ${fallbackStack}` : fallbackStack;

  const hiddenWhileLoading: boolean =
    renderWhileLoading === undefined && status === "loading";

  const wrapperStyle: React.CSSProperties = {
    ...style,
    // Hide only while actively loading if no custom placeholder is provided.
    visibility: hiddenWhileLoading ? "hidden" : undefined,
    fontFamily: effectiveFontFamily,
  };

  return (
    <FontStatusContext.Provider value={{ status, family }}>
      <div className={className} style={wrapperStyle}>
        {status === "loading" && renderWhileLoading !== undefined
          ? renderWhileLoading
          : children}
      </div>
    </FontStatusContext.Provider>
  );
}
