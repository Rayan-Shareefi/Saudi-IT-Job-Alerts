/**
 * Minimal declaration for mammoth's browser build.
 *
 * The package ships types for its Node entrypoint only. The browser build is
 * the one that matters here: it works on an ArrayBuffer rather than a file
 * path, which is what a CV dropped into a file input gives us.
 */
declare module "mammoth/mammoth.browser" {
  export function extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: Array<{ type: string; message: string }>;
  }>;
}
